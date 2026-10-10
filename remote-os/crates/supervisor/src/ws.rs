//! Signalling WebSocket: `GET /api/v1/sessions/:id/signal`.
//!
//! Nothing here logs SDP, ICE candidates or tokens — only their sizes and the
//! state transitions they cause.

use std::borrow::Cow;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use auth::{AuthError, Principal};
use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::response::{IntoResponse, Response};
use capture::X11Capture;
use media::{MediaConfig, MediaEvent, MediaSession};
use protocol::signal::{
    parse_client_signal, ClientSignal, ServerSignal, CLOSE_AUTH, CLOSE_FORBIDDEN, CLOSE_NOT_FOUND,
    CLOSE_REPLACED, MAX_SIGNAL_BYTES,
};
use protocol::status::{ErrorMsg, ResMsg};
use protocol::SessionState;
use session::display_for_slot;
use tokio::sync::mpsc;

use crate::http::{authenticate_token, via_tunnel};
use crate::state::{lock, now_unix, AppState, Kick, Runtime, ViewerTicket};
use crate::worker::InputWorker;

pub const AUTH_TIMEOUT: Duration = Duration::from_secs(5);
/// A token may be refreshed with another `auth` message; past its expiry plus
/// this grace the socket is closed.
const EXPIRY_GRACE_SECS: u64 = 30;
/// One `res` per this interval; the rest are refused without work.
const PROFILE_CHANGE_MIN_INTERVAL: Duration = Duration::from_secs(3);

pub async fn signal(
    State(st): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    let via = via_tunnel(&headers);
    // CORS does not cover a WebSocket upgrade. A browser always sends Origin;
    // one from anywhere but the admin is refused. (No Origin = not a browser,
    // which cannot be driven cross-site; the token still decides.)
    if let Some(o) = headers.get(axum::http::header::ORIGIN) {
        let ok = o
            .to_str()
            .map(|o| st.cfg.allowed_origins.iter().any(|a| a == o))
            .unwrap_or(false);
        if !ok {
            tracing::info!("signalling upgrade refused: origin not allowed");
            return (
                axum::http::StatusCode::FORBIDDEN,
                axum::Json(protocol::rest::ApiError::new(
                    "auth/origin",
                    "Origin not allowed.",
                )),
            )
                .into_response();
        }
    }
    ws.max_message_size(MAX_SIGNAL_BYTES)
        .max_frame_size(MAX_SIGNAL_BYTES)
        .on_upgrade(move |sock| async move {
            let mut conn = Conn { sock, open: true };
            run(st, id, &mut conn, via).await;
            if conn.open {
                conn.close(1000, "bye").await;
            }
        })
}

struct Conn {
    sock: WebSocket,
    open: bool,
}

impl Conn {
    async fn send(&mut self, m: &ServerSignal) -> bool {
        if !self.open {
            return false;
        }
        let Ok(text) = serde_json::to_string(m) else {
            return false;
        };
        if self.sock.send(Message::Text(text)).await.is_err() {
            self.open = false;
        }
        self.open
    }

    async fn error(&mut self, code: &str, error: impl Into<String>) {
        self.send(&ServerSignal::Error {
            error: error.into(),
            code: code.into(),
        })
        .await;
    }

    async fn close(&mut self, code: u16, reason: &'static str) {
        if self.open {
            let _ = self
                .sock
                .send(Message::Close(Some(CloseFrame {
                    code,
                    reason: Cow::Borrowed(reason),
                })))
                .await;
            self.open = false;
        }
    }
}

fn auth_close_code(e: &AuthError) -> u16 {
    if e.http_status() == 403 {
        CLOSE_FORBIDDEN
    } else {
        CLOSE_AUTH
    }
}

async fn first_auth(st: &AppState, conn: &mut Conn, via: bool) -> Option<Principal> {
    let first = tokio::time::timeout(AUTH_TIMEOUT, conn.sock.recv()).await;
    let text = match first {
        Ok(Some(Ok(Message::Text(t)))) => t,
        Ok(_) => {
            conn.error(
                "auth/missing",
                "The first message must be {type:\"auth\", token}.",
            )
            .await;
            conn.close(CLOSE_AUTH, "auth required").await;
            return None;
        }
        Err(_) => {
            conn.error("auth/timeout", "No auth message within 5 s.")
                .await;
            conn.close(CLOSE_AUTH, "auth timeout").await;
            return None;
        }
    };
    let token = match parse_client_signal(&text) {
        Ok(ClientSignal::Auth { token }) => token,
        _ => {
            conn.error(
                "auth/missing",
                "The first message must be {type:\"auth\", token}.",
            )
            .await;
            conn.close(CLOSE_AUTH, "auth required").await;
            return None;
        }
    };
    match authenticate_token(st, &token, via).await {
        Ok(p) => Some(p),
        Err(e) => {
            tracing::info!(code = e.code(), "signalling auth refused");
            conn.error(e.code(), e.to_string()).await;
            conn.close(auth_close_code(&e), "auth failed").await;
            None
        }
    }
}

/// The live media of one negotiation. Field order is drop order: the
/// pipeline (and its DataChannel callbacks) goes before the input worker,
/// whose drop releases every held key.
struct Active {
    media: MediaSession,
    worker: InputWorker,
    generation: u64,
}

fn shutdown_active(a: Option<Active>) {
    if let Some(a) = a {
        // Setting a pipeline to NULL can block on streaming threads.
        tokio::task::spawn_blocking(move || drop(a));
    }
}

async fn run(st: Arc<AppState>, id: String, conn: &mut Conn, via: bool) {
    let Some(mut who) = first_auth(&st, conn, via).await else {
        return;
    };
    let m = st.manager.clone();
    let id2 = id.clone();
    let rec = match tokio::task::spawn_blocking(move || m.get(&id2)).await {
        Ok(Ok(r)) => r,
        _ => {
            conn.error("session/not-found", "No such session.").await;
            conn.close(CLOSE_NOT_FOUND, "no such session").await;
            return;
        }
    };
    if !rec.state.is_viewable() {
        conn.error(
            "session/state",
            format!("Session is {}; it cannot be viewed.", rec.state.as_str()),
        )
        .await;
        conn.close(CLOSE_NOT_FOUND, "not running").await;
        return;
    }
    let Some(slot) = rec.slot else {
        conn.close(CLOSE_NOT_FOUND, "no display").await;
        return;
    };
    let display = display_for_slot(slot);
    let rt = st.runtime(&id);
    let viewer_id = st.next_viewer_id();
    let (kick_tx, mut kick_rx) = mpsc::unbounded_channel::<Kick>();
    if let Some(old) = lock(&rt.viewer).replace(ViewerTicket {
        id: viewer_id,
        kick: kick_tx,
    }) {
        let _ = old.kick.send(Kick::Replaced);
        tracing::info!(session = %id, old = old.id, new = viewer_id, "viewer replaced");
    }
    let mut stopping = rt.stopping.subscribe();
    tracing::info!(session = %id, viewer = viewer_id, by = %who.email, bench = who.bench, "viewer attached");

    let ice = st.ice_servers(&id);
    if ice.is_empty() {
        conn.error(
            "turn/unavailable",
            "The TURN secret is not readable; media cannot be relayed.",
        )
        .await;
    }
    conn.send(&ServerSignal::IceServers {
        ice_servers: ice,
        policy: "relay".into(),
    })
    .await;

    let (ev_tx, mut ev_rx) = mpsc::unbounded_channel::<(u64, MediaEvent)>();
    let (prof_tx, mut prof_rx) = mpsc::unbounded_channel::<String>();
    let mut active: Option<Active> = None;
    let mut generation = 0u64;
    let mut last_profile_change: Option<Instant> = None;
    let mut tick = tokio::time::interval(Duration::from_secs(1));
    let mut ping_at = Instant::now();
    let may_drive = Arc::new(AtomicBool::new(recent_sign_in(&who)));
    let mut warned_stale = false;

    loop {
        tokio::select! {
            msg = conn.sock.recv() => {
                let text = match msg {
                    Some(Ok(Message::Text(t))) => t,
                    Some(Ok(Message::Binary(_))) => {
                        conn.error("signal/binary", "Signalling is JSON text.").await;
                        continue;
                    }
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                    Some(Ok(_)) => continue, // ping/pong
                };
                let sig = match parse_client_signal(&text) {
                    Ok(s) => s,
                    Err(e) => {
                        conn.error(e.code(), "Unrecognised signalling message.").await;
                        continue;
                    }
                };
                match sig {
                    ClientSignal::Auth { token } => match authenticate_token(&st, &token, via).await {
                        Ok(p) => {
                            who = p;
                            may_drive.store(recent_sign_in(&who), Ordering::Relaxed);
                        }
                        Err(e) => {
                            conn.error(e.code(), e.to_string()).await;
                            conn.close(auth_close_code(&e), "auth failed").await;
                            break;
                        }
                    },
                    ClientSignal::Ready => {
                        shutdown_active(active.take());
                        generation += 1;
                        let m = st.manager.clone();
                        let id2 = id.clone();
                        let profile = match tokio::task::spawn_blocking(move || m.get(&id2)).await {
                            Ok(Ok(r)) if r.state.is_viewable() => r.profile,
                            _ => {
                                conn.error("session/state", "Session is no longer viewable.").await;
                                conn.close(CLOSE_NOT_FOUND, "not running").await;
                                break;
                            }
                        };
                        let gen = generation;
                        let ev = ev_tx.clone();
                        let on_event: media::EventSink = Arc::new(move |e| { let _ = ev.send((gen, e)); });
                        let cfg = MediaConfig { profile, turn_server: st.webrtc_turn_uri(&id), vbv_ms: st.cfg.vbv_ms };
                        let (d, rt2, ptx, md) = (display.clone(), rt.clone(), prof_tx.clone(), may_drive.clone());
                        let built = tokio::task::spawn_blocking(move || -> Result<Active, String> {
                            let cap = X11Capture::new(&d).map_err(|e| e.to_string())?;
                            // The worker needs the status channel, which only
                            // exists once the pipeline does; the pipeline needs
                            // the worker's sink. A slot breaks the cycle.
                            let slot: Arc<std::sync::Mutex<Option<media::InputSink>>> = Arc::new(std::sync::Mutex::new(None));
                            let slot2 = slot.clone();
                            let on_input: media::InputSink = Arc::new(move |f| {
                                if let Some(s) = lock(&slot2).as_ref() { s(f) }
                            });
                            let media = MediaSession::start(&cap, cfg, on_event, on_input).map_err(|e| e.to_string())?;
                            let worker = InputWorker::spawn(d, rt2, media.status_sender(), ptx);
                            *lock(&slot) = Some(worker.sink(media.rejected_counter(), md));
                            Ok(Active { media, worker, generation: gen })
                        }).await;
                        match built {
                            Ok(Ok(a)) => {
                                tracing::info!(session = %id, viewer = viewer_id, generation = gen, profile = profile.id(), "pipeline started");
                                active = Some(a);
                                let m = st.manager.clone();
                                let id2 = id.clone();
                                let _ = tokio::task::spawn_blocking(move || {
                                    m.set_state(&id2, SessionState::Connected, None, Some("viewer ready"))
                                }).await;
                            }
                            Ok(Err(e)) => {
                                tracing::error!(session = %id, error = %e, "pipeline failed to start");
                                conn.error("media/failed", "The media pipeline could not start.").await;
                            }
                            Err(e) => {
                                tracing::error!(session = %id, error = %e, "pipeline task panicked");
                                conn.error("media/failed", "The media pipeline could not start.").await;
                            }
                        }
                    }
                    ClientSignal::Answer { sdp } => match &active {
                        Some(a) => {
                            tracing::debug!(session = %id, bytes = sdp.len(), "answer received");
                            if let Err(e) = a.media.set_answer(&sdp) {
                                tracing::info!(session = %id, error_kind = "sdp", "answer refused");
                                conn.error("signal/bad-answer", format!("Answer not usable: {}", short(&e.to_string()))).await;
                            }
                        }
                        None => conn.error("signal/no-offer", "Send {type:\"ready\"} first.").await,
                    },
                    ClientSignal::Ice { candidate, sdp_mline_index } => {
                        if let (Some(a), Some(c)) = (&active, candidate) {
                            if c.len() <= 1024 {
                                a.media.add_ice(sdp_mline_index.unwrap_or(0), &c);
                            }
                        }
                    }
                    ClientSignal::Bye => break,
                }
            }
            Some((gen, ev)) = ev_rx.recv() => {
                if active.as_ref().map(|a| a.generation) != Some(gen) {
                    continue; // from a pipeline already torn down
                }
                match ev {
                    MediaEvent::Offer(sdp) => {
                        tracing::debug!(session = %id, bytes = sdp.len(), "offer sent");
                        conn.send(&ServerSignal::Offer { sdp }).await;
                    }
                    MediaEvent::Ice { candidate, mline } => {
                        conn.send(&ServerSignal::Ice { candidate, sdp_mline_index: mline }).await;
                    }
                    MediaEvent::InputOpen => tracing::info!(session = %id, "input channel open"),
                    MediaEvent::InputClosed => {
                        tracing::info!(session = %id, "input channel closed");
                        if let Some(a) = &active { a.worker.close(); }
                    }
                    MediaEvent::IceState(s) => tracing::info!(session = %id, ice = %s, "ice state"),
                    MediaEvent::PeerState(s) => {
                        tracing::info!(session = %id, peer = %s, "peer state");
                        if s == "failed" {
                            conn.error("media/failed", "The peer connection failed (ICE/DTLS). Send ready to retry.").await;
                            shutdown_active(active.take());
                        }
                    }
                    MediaEvent::Error(e) => {
                        tracing::error!(session = %id, error = %short(&e), "media error");
                        conn.error("media/failed", "The media pipeline stopped. Send ready to retry.").await;
                        shutdown_active(active.take());
                    }
                }
            }
            Some(p) = prof_rx.recv() => {
                let (cur, status) = match &active {
                    Some(a) => (a.media.profile(), a.media.status_sender()),
                    None => continue,
                };
                let say = |t: Result<String, serde_json::Error>| { if let Ok(t) = t { status.send(&t); } };
                let refuse = |code: &str, e: String| say(serde_json::to_string(&ErrorMsg::new(code, e)));
                if last_profile_change.map(|t| t.elapsed() < PROFILE_CHANGE_MIN_INTERVAL).unwrap_or(false) {
                    refuse("profile/rate-limited", "One profile change per 3 s.".into());
                    continue;
                }
                last_profile_change = Some(Instant::now());
                let m = st.manager.clone();
                let id2 = id.clone();
                let p2 = p.clone();
                match tokio::task::spawn_blocking(move || m.change_profile(&id2, &p2)).await {
                    Ok(Ok(rec)) if rec.profile == cur => {
                        say(serde_json::to_string(&ResMsg::new(rec.profile)));
                    }
                    Ok(Ok(rec)) => {
                        say(serde_json::to_string(&ResMsg::new(rec.profile)));
                        tracing::info!(session = %id, profile = rec.profile.id(), "live profile change: renegotiating");
                        shutdown_active(active.take());
                        conn.send(&ServerSignal::Renegotiate {
                            profile: rec.profile.id().into(),
                            width: rec.profile.width(),
                            height: rec.profile.height(),
                            fps: rec.profile.fps(),
                        }).await;
                    }
                    Ok(Err(e)) => refuse(e.code(), e.to_string()),
                    Err(_) => refuse("internal", "Internal error.".into()),
                }
            }
            Some(k) = kick_rx.recv() => {
                match k {
                    Kick::Replaced => {
                        conn.send(&ServerSignal::Replaced).await;
                        conn.close(CLOSE_REPLACED, "replaced").await;
                    }
                    Kick::Stopped => {
                        conn.send(&ServerSignal::Bye { reason: "session stopped".into() }).await;
                        conn.close(1000, "session stopped").await;
                    }
                }
                break;
            }
            Ok(()) = stopping.changed() => {
                if *stopping.borrow() {
                    conn.send(&ServerSignal::Bye { reason: "session stopped".into() }).await;
                    conn.close(1000, "session stopped").await;
                    break;
                }
            }
            _ = tick.tick() => {
                if let Some(a) = &active {
                    *lock(&rt.stats) = Some(a.media.snapshot());
                }
                let fresh = recent_sign_in(&who);
                may_drive.store(fresh, Ordering::Relaxed);
                if !fresh && !warned_stale {
                    if let Some(a) = &active {
                        let m = ErrorMsg::new("auth/stale-sign-in", "Driving needs a sign-in from the last 30 minutes; input is being ignored. Sign in again.");
                        if let Ok(t) = serde_json::to_string(&m) {
                            warned_stale = a.media.status_sender().send(&t);
                        }
                    }
                } else if fresh {
                    warned_stale = false;
                }
                if now_unix() > who.exp + EXPIRY_GRACE_SECS {
                    conn.error("auth/expired", "Token expired; send a fresh {type:\"auth\"} before it does.").await;
                    conn.close(CLOSE_AUTH, "token expired").await;
                    break;
                }
                // Keep idle tunnels (Cloudflare ~100 s) from closing the socket.
                if ping_at.elapsed() > Duration::from_secs(20) {
                    ping_at = Instant::now();
                    if conn.sock.send(Message::Ping(Vec::new())).await.is_err() {
                        conn.open = false;
                        break;
                    }
                }
                if !conn.open { break; }
            }
        }
        if !conn.open {
            break;
        }
    }

    shutdown_active(active.take());
    finish(&st, &rt, &id, viewer_id).await;
}

async fn finish(st: &Arc<AppState>, rt: &Arc<Runtime>, id: &str, viewer_id: u64) {
    let still_mine = {
        let mut g = lock(&rt.viewer);
        if g.as_ref().map(|v| v.id) == Some(viewer_id) {
            g.take();
            true
        } else {
            false
        }
    };
    tracing::info!(session = %id, viewer = viewer_id, "viewer detached");
    if still_mine {
        lock(&rt.stats).take();
        let m = st.manager.clone();
        let id2 = id.to_string();
        let _ = tokio::task::spawn_blocking(move || {
            if let Ok(r) = m.get(&id2) {
                if r.state == SessionState::Connected {
                    let _ = m.set_state(&id2, SessionState::Idle, None, Some("viewer left"));
                }
            }
        })
        .await;
    }
}

/// Driving (input) needs a sign-in from the last 30 minutes: Firebase
/// `auth_time` does not move on a silent token refresh. Watching does not.
pub const DRIVE_SIGN_IN_MAX_AGE_SECS: u64 = 30 * 60;

fn recent_sign_in(p: &Principal) -> bool {
    if p.bench {
        return true;
    }
    match p.auth_time {
        Some(t) => now_unix().saturating_sub(t) <= DRIVE_SIGN_IN_MAX_AGE_SECS,
        None => false,
    }
}

fn short(s: &str) -> String {
    s.chars().take(120).collect()
}
