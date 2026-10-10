//! remote-os supervisor.
//!
//! Binds 127.0.0.1:7780 (the Cloudflare tunnel's target for
//! desk.ravikishan.me), serves the Milestone 1 REST + signalling contract,
//! and runs one GStreamer webrtcbin pipeline per connected viewer.

mod config;
mod cors;
mod display;
mod http;
mod state;
mod worker;
mod ws;

use std::collections::HashMap;
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::extract::DefaultBodyLimit;
use axum::routing::{get, post};
use axum::Router;
use tracing_subscriber::EnvFilter;

use crate::config::Config;
use crate::state::AppState;

fn router(st: Arc<AppState>) -> Router {
    Router::new()
        .route("/api/v1/health", get(http::health))
        .route(
            "/api/v1/sessions",
            get(http::list_sessions).post(http::create_session),
        )
        .route("/api/v1/sessions/:id", get(http::get_session))
        .route("/api/v1/sessions/:id/stop", post(http::stop_session))
        .route("/api/v1/sessions/:id/stats", get(http::session_stats))
        .route("/api/v1/sessions/:id/signal", get(ws::signal))
        .route("/api/v1/capacity", get(http::capacity))
        .fallback(http::not_found)
        .layer(DefaultBodyLimit::max(16 * 1024))
        .layer(axum::middleware::from_fn(log_request))
        .layer(axum::middleware::from_fn_with_state(st.clone(), cors::cors))
        .with_state(st)
}

/// Method, path, status, latency. Never headers (they carry the token) and
/// never query strings.
async fn log_request(
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    let t0 = std::time::Instant::now();
    let res = next.run(req).await;
    let status = res.status().as_u16();
    if path != "/api/v1/health" || status != 200 {
        tracing::info!(%method, %path, status, ms = t0.elapsed().as_millis() as u64, "http");
    }
    res
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .json()
        .with_current_span(false)
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let cfg = match Config::from_env() {
        Ok(c) => c,
        Err(e) => {
            tracing::error!(error = %e, "bad configuration");
            std::process::exit(2);
        }
    };
    let gst_version = match media::init() {
        Ok(v) => v,
        Err(e) => {
            tracing::error!(error = %e, "GStreamer is not usable");
            std::process::exit(3);
        }
    };
    let auth_cfg = auth::AuthConfig::from_env();
    if auth_cfg.allowed_emails.is_empty() {
        tracing::error!("AGENT_ADMIN_EMAILS is empty: nobody can drive this server");
    }
    let bench = auth::BenchToken::from_env();
    if bench.enabled() {
        tracing::warn!("BENCH token is ENABLED (tunnel-only). Disable it after the benchmark.");
    }
    let turn = match turn::TurnSecret::from_file(&cfg.turn_secret_file) {
        Ok(s) => Some(s),
        Err(e) => {
            tracing::error!(error = %e, "TURN secret unreadable: viewers will get no relay");
            None
        }
    };
    let units = Arc::new(session::SystemctlUnits::new(
        cfg.max_sessions,
        cfg.run_dir.clone(),
    ));
    let manager = match session::Manager::open(
        &cfg.db_path,
        units,
        session::ManagerConfig {
            max_sessions: cfg.max_sessions,
        },
    ) {
        Ok(m) => Arc::new(m),
        Err(e) => {
            tracing::error!(error = %e, path = %cfg.db_path.display(), "cannot open session store");
            std::process::exit(4);
        }
    };

    // Sessions whose units survived a supervisor restart are re-probed; the
    // rest are marked STOPPED.
    {
        let (m, x) = (manager.clone(), cfg.xauthority.clone());
        let alive = tokio::task::spawn_blocking(move || {
            let alive = m.reconcile().unwrap_or_default();
            display::rebuild_authority(&m, &x);
            alive
        })
        .await
        .unwrap_or_default();
        for rec in alive {
            tracing::info!(session = %rec.id, state = rec.state.as_str(), "session survived restart");
            if rec.state == protocol::SessionState::Creating {
                let (m, x, id) = (manager.clone(), cfg.xauthority.clone(), rec.id.clone());
                tokio::task::spawn_blocking(move || {
                    display::await_ready(&m, &x, &id, Duration::from_secs(30))
                });
            }
        }
    }

    let bind = cfg.bind;
    let st = Arc::new(AppState {
        verifier: Arc::new(auth::Verifier::new(auth_cfg)),
        cfg,
        manager,
        bench,
        turn,
        runtimes: Mutex::new(HashMap::new()),
        viewer_seq: AtomicU64::new(0),
        gst_version,
    });
    // Reap sessions whose desktop unit died underneath us, every 5 s.
    {
        let st = st.clone();
        tokio::spawn(async move {
            let mut every = tokio::time::interval(Duration::from_secs(5));
            loop {
                every.tick().await;
                let (m, x) = (st.manager.clone(), st.cfg.xauthority.clone());
                let reaped = tokio::task::spawn_blocking(move || {
                    let r = m.reap_dead().unwrap_or_default();
                    if !r.is_empty() {
                        display::rebuild_authority(&m, &x);
                    }
                    r
                })
                .await
                .unwrap_or_default();
                for id in reaped {
                    tracing::warn!(session = %id, "desktop unit exited; session stopped");
                    if let Some(rt) = st.drop_runtime(&id) {
                        let _ = rt.stopping.send(true);
                        if let Some(v) = state::lock(&rt.viewer).take() {
                            let _ = v.kick.send(state::Kick::Stopped);
                        }
                    }
                }
            }
        });
    }
    let listener = match tokio::net::TcpListener::bind(bind).await {
        Ok(l) => l,
        Err(e) => {
            tracing::error!(error = %e, %bind, "bind failed");
            std::process::exit(5);
        }
    };
    tracing::info!(%bind, "remote-os supervisor listening");
    let shutdown = async {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("SIGTERM handler");
        tokio::select! {
            _ = term.recv() => {},
            _ = tokio::signal::ctrl_c() => {},
        }
        tracing::info!("shutting down");
    };
    if let Err(e) = axum::serve(listener, router(st))
        .with_graceful_shutdown(shutdown)
        .await
    {
        tracing::error!(error = %e, "server error");
    }
}
