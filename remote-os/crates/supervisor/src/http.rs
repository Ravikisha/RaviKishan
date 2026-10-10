//! REST: `/api/v1`. JSON in, JSON out, errors `{error, code}`.

use std::sync::Arc;
use std::time::Duration;

use auth::{AuthError, Principal};
use axum::extract::rejection::JsonRejection;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use protocol::rest::{ApiError, CreateSessionRequest};
use serde_json::json;
use session::SessionError;

use crate::display;
use crate::state::{lock, AppState, Kick};

#[derive(Debug)]
pub struct ApiErr(pub StatusCode, pub ApiError);

impl IntoResponse for ApiErr {
    fn into_response(self) -> Response {
        (self.0, Json(self.1)).into_response()
    }
}

impl From<AuthError> for ApiErr {
    fn from(e: AuthError) -> ApiErr {
        ApiErr(
            StatusCode::from_u16(e.http_status()).unwrap_or(StatusCode::UNAUTHORIZED),
            ApiError::new(e.code(), e.to_string()),
        )
    }
}

impl From<SessionError> for ApiErr {
    fn from(e: SessionError) -> ApiErr {
        if matches!(e, SessionError::Store(_) | SessionError::Unit(_)) {
            tracing::error!(error = %e, "session operation failed");
        }
        ApiErr(
            StatusCode::from_u16(e.http_status()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
            ApiError::new(e.code(), e.to_string()),
        )
    }
}

/// The contract's Session shape plus `viewer` (is one attached right now).
fn view(st: &AppState, rec: &session::SessionRecord) -> protocol::rest::SessionView {
    let mut v = rec.view();
    let viewer = lock(&st.runtimes)
        .get(&rec.id)
        .map(|rt| lock(&rt.viewer).is_some())
        .unwrap_or(false);
    v.viewer = Some(viewer);
    v
}

fn internal(e: impl std::fmt::Display) -> ApiErr {
    tracing::error!(error = %e, "internal error");
    ApiErr(
        StatusCode::INTERNAL_SERVER_ERROR,
        ApiError::new("internal", "Internal error."),
    )
}

/// cloudflared adds both headers to every request it forwards; a request
/// made on the box itself to 127.0.0.1:7780 carries neither (unless forged
/// by a local user, which the bench token alone does not help them with).
pub fn via_tunnel(h: &HeaderMap) -> bool {
    h.contains_key("cf-ray") && h.contains_key("cf-connecting-ip")
}

pub async fn authenticate_token(
    st: &AppState,
    token: &str,
    via: bool,
) -> Result<Principal, AuthError> {
    if st.bench.enabled() {
        if let Some(p) = st.bench.check(token, via) {
            tracing::warn!("request authenticated with the BENCH token");
            return Ok(p);
        }
    }
    st.verifier.verify(token).await
}

async fn authenticate(st: &AppState, h: &HeaderMap) -> Result<Principal, ApiErr> {
    let token = h
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or(AuthError::Missing)?;
    Ok(authenticate_token(st, token, via_tunnel(h)).await?)
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, ApiErr> {
    tokio::task::spawn_blocking(f).await.map_err(internal)
}

pub async fn health(State(st): State<Arc<AppState>>) -> impl IntoResponse {
    let m = st.manager.clone();
    let live = blocking(move || m.live().map(|l| l.len()).unwrap_or(0))
        .await
        .unwrap_or(0);
    Json(json!({
        "ok": true,
        "service": "remote-os-supervisor",
        "version": env!("CARGO_PKG_VERSION"),
        "gstreamer": st.gst_version,
        "display": "x11",
        "sessions": live,
        "maxSessions": st.cfg.max_sessions,
        "turn": st.turn.is_some(),
    }))
}

pub async fn list_sessions(
    State(st): State<Arc<AppState>>,
    h: HeaderMap,
) -> Result<impl IntoResponse, ApiErr> {
    authenticate(&st, &h).await?;
    let m = st.manager.clone();
    let list = blocking(move || m.list()).await??;
    Ok(Json(
        json!({ "sessions": list.iter().map(|s| view(&st, s)).collect::<Vec<_>>() }),
    ))
}

fn idempotency_key(h: &HeaderMap) -> Result<Option<String>, ApiErr> {
    let Some(v) = h.get("idempotency-key") else {
        return Ok(None);
    };
    let s = v.to_str().unwrap_or("");
    if s.is_empty() || s.len() > 128 || !s.bytes().all(|b| (0x21..0x7f).contains(&b)) {
        return Err(ApiErr(
            StatusCode::BAD_REQUEST,
            ApiError::new(
                "request/invalid",
                "Idempotency-Key must be 1-128 visible ASCII characters.",
            ),
        ));
    }
    Ok(Some(s.to_string()))
}

pub async fn create_session(
    State(st): State<Arc<AppState>>,
    h: HeaderMap,
    body: Result<Json<CreateSessionRequest>, JsonRejection>,
) -> Result<impl IntoResponse, ApiErr> {
    let who = authenticate(&st, &h).await?;
    let Json(req) = body.map_err(|e| {
        ApiErr(
            StatusCode::BAD_REQUEST,
            ApiError::new(
                "request/invalid",
                format!("Body must be {{name, profile}}: {}", e.body_text()),
            ),
        )
    })?;
    let key = idempotency_key(&h)?;
    let m = st.manager.clone();
    let owner = who.email.clone();
    let (rec, created) =
        blocking(move || m.create(&owner, &req.name, &req.profile, key.as_deref())).await??;
    if created {
        tracing::info!(session = %rec.id, profile = rec.profile.id(), by = %who.email, "session created");
        // Wait for the display, but not forever: a slow start returns
        // CREATING and the probe carries on in the background.
        let (m, x, id) = (
            st.manager.clone(),
            st.cfg.xauthority.clone(),
            rec.id.clone(),
        );
        let probe = tokio::task::spawn_blocking(move || {
            display::await_ready(&m, &x, &id, Duration::from_secs(30))
        });
        let _ = tokio::time::timeout(Duration::from_secs(15), probe).await;
    }
    let m = st.manager.clone();
    let id = rec.id.clone();
    let rec = blocking(move || m.get(&id)).await??;
    let code = if created {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok((code, Json(view(&st, &rec))))
}

pub async fn get_session(
    State(st): State<Arc<AppState>>,
    Path(id): Path<String>,
    h: HeaderMap,
) -> Result<impl IntoResponse, ApiErr> {
    authenticate(&st, &h).await?;
    let m = st.manager.clone();
    let rec = blocking(move || m.get(&id)).await??;
    Ok(Json(view(&st, &rec)))
}

pub async fn stop_session(
    State(st): State<Arc<AppState>>,
    Path(id): Path<String>,
    h: HeaderMap,
) -> Result<impl IntoResponse, ApiErr> {
    let who = authenticate(&st, &h).await?;
    let m = st.manager.clone();
    let id2 = id.clone();
    // Refuse unknown ids before touching any runtime.
    blocking(move || m.get(&id2)).await??;
    if let Some(rt) = st.drop_runtime(&id) {
        let _ = rt.stopping.send(true);
        if let Some(v) = lock(&rt.viewer).take() {
            let _ = v.kick.send(Kick::Stopped);
        }
        lock(&rt.clipboard).take();
    }
    let (m, x) = (st.manager.clone(), st.cfg.xauthority.clone());
    let id2 = id.clone();
    let rec = blocking(move || {
        let r = m.stop(&id2);
        display::rebuild_authority(&m, &x);
        r
    })
    .await??;
    tracing::info!(session = %id, by = %who.email, state = rec.state.as_str(), "session stopped");
    Ok(Json(rec.view()))
}

pub async fn session_stats(
    State(st): State<Arc<AppState>>,
    Path(id): Path<String>,
    h: HeaderMap,
) -> Result<impl IntoResponse, ApiErr> {
    authenticate(&st, &h).await?;
    let m = st.manager.clone();
    let id2 = id.clone();
    let rec = blocking(move || m.get(&id2)).await??;
    let rt = lock(&st.runtimes).get(&id).cloned();
    let (stream, viewer) = match rt {
        Some(rt) => (lock(&rt.stats).clone(), lock(&rt.viewer).is_some()),
        None => (None, false),
    };
    Ok(Json(json!({
        "session": view(&st, &rec),
        "viewer": viewer,
        "stream": stream,
    })))
}

pub async fn capacity(
    State(st): State<Arc<AppState>>,
    h: HeaderMap,
) -> Result<impl IntoResponse, ApiErr> {
    authenticate(&st, &h).await?;
    let m = st.manager.clone();
    Ok(Json(blocking(move || m.capacity()).await??))
}

pub async fn not_found() -> ApiErr {
    ApiErr(
        StatusCode::NOT_FOUND,
        ApiError::new("route/not-found", "No such route."),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tunnel_detection_needs_both_headers() {
        let mut h = HeaderMap::new();
        assert!(!via_tunnel(&h));
        h.insert("cf-ray", "x".parse().unwrap());
        assert!(!via_tunnel(&h));
        h.insert("cf-connecting-ip", "1.2.3.4".parse().unwrap());
        assert!(via_tunnel(&h));
    }

    #[test]
    fn idempotency_key_validation() {
        let mut h = HeaderMap::new();
        assert!(idempotency_key(&h).unwrap().is_none());
        h.insert("idempotency-key", "abc-123".parse().unwrap());
        assert_eq!(idempotency_key(&h).unwrap().as_deref(), Some("abc-123"));
        h.insert("idempotency-key", "a b".parse().unwrap());
        assert!(idempotency_key(&h).is_err());
        h.insert("idempotency-key", "x".repeat(129).parse().unwrap());
        assert!(idempotency_key(&h).is_err());
    }
}
