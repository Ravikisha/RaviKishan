//! CORS, per the contract's "Browser access" section. Hand-written rather
//! than tower-http's layer because the contract pins details that layer does
//! differently: a preflight answers 204 WITHOUT auth, and every response —
//! including 401/404/409/5xx — carries the headers, or the browser reports a
//! refusal as an opaque network failure.
//!
//! The Origin is echoed only when it is exactly on the allow-list; never `*`,
//! never credentials (no cookies are used).

use std::sync::Arc;

use axum::extract::{Request, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use crate::state::AppState;

pub const ALLOW_METHODS: &str = "GET, POST, OPTIONS";
pub const ALLOW_HEADERS: &str = "Authorization, Content-Type, Idempotency-Key";
pub const MAX_AGE: &str = "600";

pub fn allowed_origin(allowed: &[String], h: &HeaderMap) -> Option<HeaderValue> {
    let o = h.get(header::ORIGIN)?;
    let s = o.to_str().ok()?;
    allowed.iter().any(|a| a == s).then(|| o.clone())
}

fn decorate(res: &mut Response, origin: Option<HeaderValue>, preflight: bool) {
    let h = res.headers_mut();
    h.append(header::VARY, HeaderValue::from_static("Origin"));
    if let Some(o) = origin {
        h.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, o);
        if preflight {
            h.insert(
                header::ACCESS_CONTROL_ALLOW_METHODS,
                HeaderValue::from_static(ALLOW_METHODS),
            );
            h.insert(
                header::ACCESS_CONTROL_ALLOW_HEADERS,
                HeaderValue::from_static(ALLOW_HEADERS),
            );
            h.insert(
                header::ACCESS_CONTROL_MAX_AGE,
                HeaderValue::from_static(MAX_AGE),
            );
        }
    }
}

pub async fn cors(State(st): State<Arc<AppState>>, req: Request, next: Next) -> Response {
    let origin = allowed_origin(&st.cfg.allowed_origins, req.headers());
    if req.method() == Method::OPTIONS {
        let mut res = StatusCode::NO_CONTENT.into_response();
        decorate(&mut res, origin, true);
        return res;
    }
    let mut res = next.run(req).await;
    decorate(&mut res, origin, false);
    res
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_match_only() {
        let allowed = vec![
            "https://www.ravikishan.me".to_string(),
            "http://localhost:3000".to_string(),
        ];
        let mut h = HeaderMap::new();
        assert!(allowed_origin(&allowed, &h).is_none());
        h.insert(header::ORIGIN, "https://www.ravikishan.me".parse().unwrap());
        assert!(allowed_origin(&allowed, &h).is_some());
        for bad in [
            "https://www.ravikishan.me.evil.com",
            "https://evil.com",
            "null",
            "http://www.ravikishan.me",
            "https://www.ravikishan.me/",
        ] {
            h.insert(header::ORIGIN, bad.parse().unwrap());
            assert!(allowed_origin(&allowed, &h).is_none(), "{bad}");
        }
    }

    #[test]
    fn preflight_headers() {
        let mut r = StatusCode::NO_CONTENT.into_response();
        decorate(
            &mut r,
            Some(HeaderValue::from_static("http://localhost:3000")),
            true,
        );
        let h = r.headers();
        assert_eq!(
            h[header::ACCESS_CONTROL_ALLOW_ORIGIN],
            "http://localhost:3000"
        );
        assert_eq!(h[header::ACCESS_CONTROL_ALLOW_METHODS], ALLOW_METHODS);
        assert_eq!(h[header::VARY], "Origin");
        assert!(h.get(header::ACCESS_CONTROL_ALLOW_CREDENTIALS).is_none());
        let mut r = StatusCode::UNAUTHORIZED.into_response();
        decorate(&mut r, None, false);
        assert!(r
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_none());
        assert_eq!(r.headers()[header::VARY], "Origin");
    }
}
