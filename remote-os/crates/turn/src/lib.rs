//! Short-lived TURN credentials for coturn's `use-auth-secret` mode.
//!
//! username = `<unix-expiry>:<session-id>`,
//! credential = `base64(HMAC-SHA1(secret, username))`. coturn recomputes the
//! HMAC and refuses the allocation once the expiry has passed, so nothing is
//! stored and a leaked credential dies on its own within the TTL.

use std::path::Path;

use base64::Engine;
use hmac::{Hmac, Mac};
use sha1::Sha1;

pub const DEFAULT_TTL_SECS: u64 = 600;

#[derive(Debug, thiserror::Error)]
pub enum TurnError {
    #[error("TURN secret could not be read: {0}")]
    Read(#[from] std::io::Error),
    #[error("TURN secret is empty")]
    Empty,
}

#[derive(Clone)]
pub struct TurnSecret(Vec<u8>);

impl std::fmt::Debug for TurnSecret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("TurnSecret(«redacted»)")
    }
}

impl TurnSecret {
    pub fn new(bytes: impl Into<Vec<u8>>) -> Result<TurnSecret, TurnError> {
        let b: Vec<u8> = bytes.into();
        if b.is_empty() {
            return Err(TurnError::Empty);
        }
        Ok(TurnSecret(b))
    }

    /// Reads the secret file. A trailing newline is NOT part of the secret
    /// (coturn's `static-auth-secret=` line has none), so it is trimmed.
    pub fn from_file(path: &Path) -> Result<TurnSecret, TurnError> {
        let raw = std::fs::read(path)?;
        let trimmed: &[u8] = {
            let mut end = raw.len();
            while end > 0 && (raw[end - 1] == b'\n' || raw[end - 1] == b'\r') {
                end -= 1;
            }
            &raw[..end]
        };
        TurnSecret::new(trimmed.to_vec())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TurnCredentials {
    pub username: String,
    pub credential: String,
    pub expires_at: u64,
}

/// `label` should identify the connection (the session id); it is visible to
/// coturn's logs and nowhere else. A `:` in it is harmless to coturn, which
/// splits on the FIRST colon, but is replaced anyway to keep the username
/// shape unambiguous.
pub fn credentials(secret: &TurnSecret, label: &str, now_unix: u64, ttl: u64) -> TurnCredentials {
    let expires_at = now_unix + ttl;
    let label: String = label
        .chars()
        .map(|c| if c == ':' { '_' } else { c })
        .collect();
    let username = format!("{expires_at}:{label}");
    let mut mac = Hmac::<Sha1>::new_from_slice(&secret.0).expect("HMAC takes any key length");
    mac.update(username.as_bytes());
    let credential = base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes());
    TurnCredentials {
        username,
        credential,
        expires_at,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_openssl_vector() {
        // printf '%s' "1760000600:sess-1" | openssl dgst -sha1 -hmac test-secret -binary | base64
        let s = TurnSecret::new("test-secret").unwrap();
        let c = credentials(&s, "sess-1", 1_760_000_000, 600);
        assert_eq!(c.username, "1760000600:sess-1");
        assert_eq!(c.credential, "b+IAGVuGGq7+ML+al2+x3mjUl7Q=");
        assert_eq!(c.expires_at, 1_760_000_600);
    }

    #[test]
    fn colon_in_label_is_neutralised() {
        let s = TurnSecret::new("k").unwrap();
        let c = credentials(&s, "a:b", 0, 10);
        assert_eq!(c.username, "10:a_b");
    }

    #[test]
    fn file_trims_newline_and_refuses_empty() {
        let dir = std::env::temp_dir().join(format!("turn-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("s");
        std::fs::write(&p, "test-secret\n").unwrap();
        let s = TurnSecret::from_file(&p).unwrap();
        assert_eq!(
            credentials(&s, "sess-1", 1_760_000_000, 600).credential,
            "b+IAGVuGGq7+ML+al2+x3mjUl7Q="
        );
        std::fs::write(&p, "\n").unwrap();
        assert!(matches!(TurnSecret::from_file(&p), Err(TurnError::Empty)));
        assert_eq!(format!("{s:?}"), "TurnSecret(«redacted»)");
        std::fs::remove_dir_all(&dir).ok();
    }
}
