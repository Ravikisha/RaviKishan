//! Shared state: the session manager (durable) plus per-session runtime
//! (viewer, latest stats, clipboard owner) that dies with the process.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use auth::{BenchToken, Verifier};
use input::clipboard::Clipboard;
use protocol::signal::IceServer;
use protocol::status::StatsMsg;
use session::Manager;
use tokio::sync::{mpsc, watch};
use turn::TurnSecret;

use crate::config::Config;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kick {
    Replaced,
    Stopped,
}

pub struct ViewerTicket {
    pub id: u64,
    pub kick: mpsc::UnboundedSender<Kick>,
}

pub struct Runtime {
    pub viewer: Mutex<Option<ViewerTicket>>,
    pub stats: Mutex<Option<StatsMsg>>,
    pub clipboard: Mutex<Option<Arc<Clipboard>>>,
    pub stopping: watch::Sender<bool>,
}

impl Runtime {
    fn new() -> Runtime {
        Runtime {
            viewer: Mutex::new(None),
            stats: Mutex::new(None),
            clipboard: Mutex::new(None),
            stopping: watch::channel(false).0,
        }
    }
}

pub struct AppState {
    pub cfg: Config,
    pub manager: Arc<Manager>,
    pub verifier: Arc<Verifier>,
    pub bench: BenchToken,
    pub turn: Option<TurnSecret>,
    pub runtimes: Mutex<HashMap<String, Arc<Runtime>>>,
    pub viewer_seq: AtomicU64,
    pub gst_version: String,
}

pub fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

pub fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

impl AppState {
    pub fn runtime(&self, id: &str) -> Arc<Runtime> {
        lock(&self.runtimes)
            .entry(id.to_string())
            .or_insert_with(|| Arc::new(Runtime::new()))
            .clone()
    }

    pub fn drop_runtime(&self, id: &str) -> Option<Arc<Runtime>> {
        lock(&self.runtimes).remove(id)
    }

    pub fn next_viewer_id(&self) -> u64 {
        self.viewer_seq.fetch_add(1, Ordering::Relaxed) + 1
    }

    /// TURN credentials minted for this connection. Without a readable secret
    /// the list is empty, and the client cannot reach media at all — which is
    /// reported, not papered over with a public STUN server.
    pub fn ice_servers(&self, label: &str) -> Vec<IceServer> {
        let Some(secret) = &self.turn else {
            return Vec::new();
        };
        let c = turn::credentials(secret, label, now_unix(), self.cfg.turn_ttl_secs);
        vec![IceServer {
            urls: self.cfg.turn_urls.clone(),
            username: c.username,
            credential: c.credential,
        }]
    }

    /// webrtcbin's own `turn-server` URI, when enabled.
    pub fn webrtc_turn_uri(&self, label: &str) -> Option<String> {
        if !self.cfg.webrtc_turn {
            return None;
        }
        let secret = self.turn.as_ref()?;
        let c = turn::credentials(secret, label, now_unix(), self.cfg.turn_ttl_secs);
        // turn://user:pass@host:port — the username contains ':' and the
        // credential base64, so both are percent-encoded.
        let enc = |s: &str| -> String {
            s.bytes()
                .map(|b| match b {
                    b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                        (b as char).to_string()
                    }
                    _ => format!("%{b:02X}"),
                })
                .collect()
        };
        let url = self.cfg.turn_urls.first()?;
        let hostport = url
            .trim_start_matches("turn:")
            .split('?')
            .next()
            .unwrap_or_default();
        Some(format!(
            "turn://{}:{}@{}?transport=tcp",
            enc(&c.username),
            enc(&c.credential),
            hostport
        ))
    }
}
