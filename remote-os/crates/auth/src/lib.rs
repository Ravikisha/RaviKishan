//! Who may drive the supervisor: a Firebase ID token for an allow-listed,
//! verified e-mail — the same rule agentd applies (`agent/src/auth.js`), and
//! deliberately not a service account.
//!
//! Keys come from Google's published key set for `securetoken@system`, as
//! JWKs (the same keys Google also publishes as x509 certificates), cached for
//! as long as Google's `Cache-Control: max-age` says, and refetched early —
//! at most every 30 s — when a token names a key id the cache has not seen
//! (Google rotates keys; the new one appears before tokens use it, but a cache
//! can still be stale).

use std::collections::HashMap;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use subtle::ConstantTimeEq;
use tokio::sync::{Mutex, RwLock};

pub const DEFAULT_PROJECT: &str = "myportifilio-3ab5f";
pub const GOOGLE_JWKS_URL: &str =
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const MIN_REFETCH: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum AuthError {
    #[error("No token.")]
    Missing,
    #[error("That token is not a Firebase ID token.")]
    Malformed,
    #[error("That token was signed by a key Google does not publish.")]
    UnknownKey,
    #[error("That token did not verify ({0}).")]
    Invalid(String),
    #[error("That token has expired.")]
    Expired,
    #[error("That account's e-mail is not verified.")]
    Unverified,
    #[error("{0} is not allowed to drive this server.")]
    Forbidden(String),
    #[error("Could not fetch Google signing keys ({0}).")]
    KeysUnavailable(String),
}

impl AuthError {
    pub fn code(&self) -> &'static str {
        match self {
            AuthError::Missing => "auth/missing",
            AuthError::Malformed => "auth/malformed",
            AuthError::UnknownKey => "auth/unknown-key",
            AuthError::Invalid(_) => "auth/invalid",
            AuthError::Expired => "auth/expired",
            AuthError::Unverified => "auth/unverified-email",
            AuthError::Forbidden(_) => "auth/forbidden",
            AuthError::KeysUnavailable(_) => "auth/keys-unavailable",
        }
    }

    pub fn http_status(&self) -> u16 {
        match self {
            AuthError::Unverified | AuthError::Forbidden(_) => 403,
            AuthError::KeysUnavailable(_) => 503,
            _ => 401,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Principal {
    pub email: String,
    pub sub: String,
    /// Token expiry (unix seconds). A WebSocket that outlives it must re-auth.
    pub exp: u64,
    pub auth_time: Option<u64>,
    /// True only for the supervisor-local benchmark token.
    pub bench: bool,
}

#[derive(Debug, Deserialize)]
struct FirebaseClaims {
    sub: String,
    exp: u64,
    #[serde(default)]
    auth_time: Option<u64>,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    email_verified: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct AuthConfig {
    pub project_id: String,
    pub allowed_emails: Vec<String>,
    pub jwks_url: String,
}

/// Parses `AGENT_ADMIN_EMAILS` the way agentd does: comma separated,
/// trimmed, lower-cased, empties dropped.
pub fn parse_allow_list(s: &str) -> Vec<String> {
    s.split(',')
        .map(|e| e.trim().to_lowercase())
        .filter(|e| !e.is_empty())
        .collect()
}

impl AuthConfig {
    /// An unset or empty allow-list admits NOBODY (fail closed); the
    /// supervisor logs that at startup.
    pub fn from_env() -> AuthConfig {
        AuthConfig {
            project_id: std::env::var("FIREBASE_PROJECT_ID")
                .unwrap_or_else(|_| DEFAULT_PROJECT.to_string()),
            allowed_emails: parse_allow_list(
                &std::env::var("AGENT_ADMIN_EMAILS").unwrap_or_default(),
            ),
            jwks_url: GOOGLE_JWKS_URL.to_string(),
        }
    }
}

struct KeyCache {
    keys: HashMap<String, DecodingKey>,
    fresh_until: Instant,
    fetched_at: Option<Instant>,
}

pub struct Verifier {
    cfg: AuthConfig,
    cache: RwLock<KeyCache>,
    fetch_lock: Mutex<()>,
    http: Option<reqwest::Client>,
}

#[derive(Deserialize)]
struct Jwk {
    kid: String,
    n: String,
    e: String,
    #[serde(default)]
    kty: Option<String>,
}

#[derive(Deserialize)]
struct JwkSet {
    keys: Vec<Jwk>,
}

/// `Cache-Control: public, max-age=19045, must-revalidate, no-transform` →
/// 19045 s, clamped to [60 s, 1 day]; absent → 1 hour.
pub fn max_age(cache_control: Option<&str>) -> Duration {
    let secs = cache_control
        .and_then(|h| {
            h.split(',').find_map(|part| {
                let p = part.trim();
                p.strip_prefix("max-age=")
                    .and_then(|v| v.trim().parse::<u64>().ok())
            })
        })
        .unwrap_or(3600);
    Duration::from_secs(secs.clamp(60, 86_400))
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

impl Verifier {
    pub fn new(cfg: AuthConfig) -> Verifier {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .ok();
        Verifier {
            cfg,
            cache: RwLock::new(KeyCache {
                keys: HashMap::new(),
                fresh_until: Instant::now(),
                fetched_at: None,
            }),
            fetch_lock: Mutex::new(()),
            http,
        }
    }

    /// For tests: a fixed key set that never refreshes.
    pub fn with_static_keys(cfg: AuthConfig, keys: HashMap<String, DecodingKey>) -> Verifier {
        Verifier {
            cfg,
            cache: RwLock::new(KeyCache {
                keys,
                fresh_until: Instant::now() + Duration::from_secs(86_400 * 365),
                fetched_at: Some(Instant::now()),
            }),
            fetch_lock: Mutex::new(()),
            http: None,
        }
    }

    pub fn allow_list(&self) -> &[String] {
        &self.cfg.allowed_emails
    }

    async fn refresh(&self, force: bool) -> Result<(), AuthError> {
        let Some(http) = &self.http else {
            return Ok(());
        };
        let _g = self.fetch_lock.lock().await;
        {
            let c = self.cache.read().await;
            let fresh = Instant::now() < c.fresh_until;
            let recently = c
                .fetched_at
                .map(|t| t.elapsed() < MIN_REFETCH)
                .unwrap_or(false);
            if (fresh && !force) || (force && recently) {
                return Ok(());
            }
        }
        let res = http
            .get(&self.cfg.jwks_url)
            .send()
            .await
            .map_err(|e| AuthError::KeysUnavailable(e.without_url().to_string()))?;
        if !res.status().is_success() {
            return Err(AuthError::KeysUnavailable(res.status().to_string()));
        }
        let ttl = max_age(
            res.headers()
                .get(reqwest::header::CACHE_CONTROL)
                .and_then(|v| v.to_str().ok()),
        );
        let set: JwkSet = res
            .json()
            .await
            .map_err(|e| AuthError::KeysUnavailable(e.without_url().to_string()))?;
        let mut keys = HashMap::new();
        for k in set.keys {
            if k.kty.as_deref().unwrap_or("RSA") != "RSA" {
                continue;
            }
            if let Ok(dk) = DecodingKey::from_rsa_components(&k.n, &k.e) {
                keys.insert(k.kid, dk);
            }
        }
        if keys.is_empty() {
            return Err(AuthError::KeysUnavailable("empty key set".into()));
        }
        tracing::info!(
            keys = keys.len(),
            ttl_secs = ttl.as_secs(),
            "google signing keys refreshed"
        );
        let mut c = self.cache.write().await;
        *c = KeyCache {
            keys,
            fresh_until: Instant::now() + ttl,
            fetched_at: Some(Instant::now()),
        };
        Ok(())
    }

    async fn key_for(&self, kid: &str) -> Result<DecodingKey, AuthError> {
        self.refresh(false).await?;
        if let Some(k) = self.cache.read().await.keys.get(kid) {
            return Ok(k.clone());
        }
        self.refresh(true).await?;
        self.cache
            .read()
            .await
            .keys
            .get(kid)
            .cloned()
            .ok_or(AuthError::UnknownKey)
    }

    /// Every property checked here is one a forged or borrowed token fails.
    pub async fn verify(&self, token: &str) -> Result<Principal, AuthError> {
        let token = token.trim();
        if token.is_empty() {
            return Err(AuthError::Missing);
        }
        if token.len() > 8192 {
            return Err(AuthError::Malformed);
        }
        let header = decode_header(token).map_err(|_| AuthError::Malformed)?;
        if header.alg != Algorithm::RS256 {
            return Err(AuthError::Malformed);
        }
        let kid = header.kid.ok_or(AuthError::Malformed)?;
        let key = self.key_for(&kid).await?;

        let mut v = Validation::new(Algorithm::RS256);
        v.set_audience(&[&self.cfg.project_id]);
        v.set_issuer(&[format!(
            "https://securetoken.google.com/{}",
            self.cfg.project_id
        )]);
        v.set_required_spec_claims(&["exp", "aud", "iss", "sub"]);
        v.leeway = 30;
        let data = decode::<FirebaseClaims>(token, &key, &v).map_err(|e| {
            use jsonwebtoken::errors::ErrorKind;
            match e.kind() {
                ErrorKind::ExpiredSignature => AuthError::Expired,
                _ => AuthError::Invalid(e.to_string()),
            }
        })?;
        let c = data.claims;
        if c.sub.is_empty() || c.sub.len() > 128 {
            return Err(AuthError::Invalid("bad subject".into()));
        }
        if let Some(at) = c.auth_time {
            if at > now_unix() + 300 {
                return Err(AuthError::Invalid("auth_time in the future".into()));
            }
        }
        let email = c.email.unwrap_or_default().to_lowercase();
        if c.email_verified != Some(true) {
            return Err(AuthError::Unverified);
        }
        if email.is_empty() || !self.cfg.allowed_emails.iter().any(|a| a == &email) {
            return Err(AuthError::Forbidden(if email.is_empty() {
                "that account".into()
            } else {
                email
            }));
        }
        Ok(Principal {
            email,
            sub: c.sub,
            exp: c.exp,
            auth_time: c.auth_time,
            bench: false,
        })
    }
}

/// A supervisor-local token for the benchmark harness. Disabled unless
/// `REMOTE_OS_BENCH_TOKEN` is set (≥ 32 chars); accepted only together with
/// proof the request came through the Cloudflare tunnel; compared in constant
/// time. Never a substitute for the Firebase path in normal operation.
#[derive(Clone, Default)]
pub struct BenchToken(Option<Vec<u8>>);

impl std::fmt::Debug for BenchToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "BenchToken({})",
            if self.0.is_some() {
                "enabled"
            } else {
                "disabled"
            }
        )
    }
}

pub const BENCH_TOKEN_TTL_SECS: u64 = 3600;

impl BenchToken {
    pub fn from_value(v: Option<String>) -> BenchToken {
        BenchToken(v.map(|s| s.trim().to_string()).and_then(|s| {
            if s.len() >= 32 {
                Some(s.into_bytes())
            } else {
                None
            }
        }))
    }

    pub fn from_env() -> BenchToken {
        BenchToken::from_value(std::env::var("REMOTE_OS_BENCH_TOKEN").ok())
    }

    pub fn enabled(&self) -> bool {
        self.0.is_some()
    }

    pub fn check(&self, presented: &str, via_tunnel: bool) -> Option<Principal> {
        let want = self.0.as_ref()?;
        if !via_tunnel {
            return None;
        }
        let got = presented.trim().as_bytes();
        if got.len() != want.len() || !bool::from(got.ct_eq(want)) {
            return None;
        }
        Some(Principal {
            email: "bench@remote-os.local".into(),
            sub: "bench".into(),
            exp: now_unix() + BENCH_TOKEN_TTL_SECS,
            auth_time: None,
            bench: true,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{encode, EncodingKey, Header};
    use serde_json::json;

    const PRIV: &[u8] = include_bytes!("../testdata/test-key.pem");
    const PUBK: &[u8] = include_bytes!("../testdata/test-pub.pem");
    const ATTACKER: &[u8] = include_bytes!("../testdata/attacker-key.pem");
    const PROJECT: &str = "myportifilio-3ab5f";

    fn verifier(allowed: &str) -> Verifier {
        let mut keys = HashMap::new();
        keys.insert("k1".to_string(), DecodingKey::from_rsa_pem(PUBK).unwrap());
        Verifier::with_static_keys(
            AuthConfig {
                project_id: PROJECT.into(),
                allowed_emails: parse_allow_list(allowed),
                jwks_url: String::new(),
            },
            keys,
        )
    }

    fn claims() -> serde_json::Value {
        let now = now_unix();
        json!({
            "iss": format!("https://securetoken.google.com/{PROJECT}"),
            "aud": PROJECT,
            "sub": "uid-1",
            "iat": now - 10,
            "exp": now + 3000,
            "auth_time": now - 100,
            "email": "Owner@Example.com",
            "email_verified": true,
        })
    }

    fn sign(c: &serde_json::Value, key: &[u8], kid: &str) -> String {
        let mut h = Header::new(Algorithm::RS256);
        h.kid = Some(kid.into());
        encode(&h, c, &EncodingKey::from_rsa_pem(key).unwrap()).unwrap()
    }

    #[tokio::test]
    async fn accepts_a_valid_token_case_insensitively() {
        let v = verifier("owner@example.com, other@x.y");
        let p = v.verify(&sign(&claims(), PRIV, "k1")).await.unwrap();
        assert_eq!(p.email, "owner@example.com");
        assert!(!p.bench);
    }

    #[tokio::test]
    async fn refuses_every_forgery() {
        let v = verifier("owner@example.com");
        let mut c = claims();
        c["aud"] = json!("other-project");
        assert!(matches!(
            v.verify(&sign(&c, PRIV, "k1")).await,
            Err(AuthError::Invalid(_))
        ));
        let mut c = claims();
        c["iss"] = json!("https://evil.example");
        assert!(matches!(
            v.verify(&sign(&c, PRIV, "k1")).await,
            Err(AuthError::Invalid(_))
        ));
        let mut c = claims();
        c["exp"] = json!(now_unix() - 3600);
        assert_eq!(
            v.verify(&sign(&c, PRIV, "k1")).await,
            Err(AuthError::Expired)
        );
        let mut c = claims();
        c["email_verified"] = json!(false);
        assert_eq!(
            v.verify(&sign(&c, PRIV, "k1")).await,
            Err(AuthError::Unverified)
        );
        let mut c = claims();
        c["email"] = json!("intruder@example.com");
        assert!(matches!(
            v.verify(&sign(&c, PRIV, "k1")).await,
            Err(AuthError::Forbidden(_))
        ));
        // Right kid, wrong key.
        assert!(matches!(
            v.verify(&sign(&claims(), ATTACKER, "k1")).await,
            Err(AuthError::Invalid(_))
        ));
        // Unknown kid (static set never refreshes).
        assert_eq!(
            v.verify(&sign(&claims(), PRIV, "k9")).await,
            Err(AuthError::UnknownKey)
        );
        // alg:none.
        let none = format!(
            "{}.{}.",
            b64(r#"{"alg":"none","kid":"k1"}"#),
            b64(&claims().to_string())
        );
        assert_eq!(v.verify(&none).await, Err(AuthError::Malformed));
        // HS256 with the public key as the HMAC secret (alg confusion).
        let mut h = Header::new(Algorithm::HS256);
        h.kid = Some("k1".into());
        let hs = encode(&h, &claims(), &EncodingKey::from_secret(PUBK)).unwrap();
        assert_eq!(v.verify(&hs).await, Err(AuthError::Malformed));
        assert_eq!(v.verify("").await, Err(AuthError::Missing));
        assert_eq!(v.verify("a.b.c").await, Err(AuthError::Malformed));
    }

    #[tokio::test]
    async fn empty_allow_list_admits_nobody() {
        let v = verifier("");
        assert!(matches!(
            v.verify(&sign(&claims(), PRIV, "k1")).await,
            Err(AuthError::Forbidden(_))
        ));
    }

    fn b64(s: &str) -> String {
        use std::fmt::Write;
        // Minimal base64url without padding, enough for the alg:none test.
        const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        let b = s.as_bytes();
        let mut out = String::new();
        for chunk in b.chunks(3) {
            let n = match chunk.len() {
                3 => (chunk[0] as u32) << 16 | (chunk[1] as u32) << 8 | chunk[2] as u32,
                2 => (chunk[0] as u32) << 16 | (chunk[1] as u32) << 8,
                _ => (chunk[0] as u32) << 16,
            };
            let chars = chunk.len() + 1;
            for i in 0..chars {
                let idx = (n >> (18 - 6 * i)) & 63;
                out.write_char(T[idx as usize] as char).unwrap();
            }
        }
        out
    }

    #[test]
    fn cache_control_parsing() {
        assert_eq!(
            max_age(Some("public, max-age=19045, must-revalidate")),
            Duration::from_secs(19045)
        );
        assert_eq!(max_age(None), Duration::from_secs(3600));
        assert_eq!(max_age(Some("max-age=1")), Duration::from_secs(60));
        assert_eq!(
            max_age(Some("max-age=99999999")),
            Duration::from_secs(86_400)
        );
        assert_eq!(max_age(Some("no-cache")), Duration::from_secs(3600));
    }

    #[test]
    fn bench_token_needs_both_halves() {
        let t = BenchToken::from_value(Some("x".repeat(40)));
        assert!(t.enabled());
        assert!(t.check(&"x".repeat(40), true).is_some());
        assert!(t.check(&"x".repeat(40), false).is_none(), "not via tunnel");
        assert!(t.check(&"y".repeat(40), true).is_none());
        assert!(t.check("", true).is_none());
        assert!(!BenchToken::from_value(Some("short".into())).enabled());
        assert!(!BenchToken::from_value(None).enabled());
        assert!(BenchToken::default().check("anything", true).is_none());
        assert_eq!(format!("{t:?}"), "BenchToken(enabled)");
    }
}
