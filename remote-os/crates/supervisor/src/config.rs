//! Configuration, from the environment the systemd unit sets.

use std::net::SocketAddr;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct Config {
    pub bind: SocketAddr,
    pub db_path: PathBuf,
    pub run_dir: PathBuf,
    pub xauthority: PathBuf,
    pub turn_secret_file: PathBuf,
    pub turn_urls: Vec<String>,
    pub turn_ttl_secs: u64,
    pub max_sessions: u8,
    /// Give webrtcbin a TURN server of its own (off: coturn reaches the host
    /// candidate on 10.0.0.118 directly, verified in the e2e run).
    pub webrtc_turn: bool,
    pub allowed_origins: Vec<String>,
    pub vbv_ms: u32,
}

fn env_or(k: &str, d: &str) -> String {
    std::env::var(k)
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| d.to_string())
}

impl Config {
    pub fn from_env() -> Result<Config, String> {
        let state_dir = env_or("STATE_DIRECTORY", "/var/lib/remote-os");
        let run_dir = env_or("RUNTIME_DIRECTORY", "/run/remote-os");
        let bind = env_or("REMOTE_OS_BIND", "127.0.0.1:7780")
            .parse()
            .map_err(|e| format!("REMOTE_OS_BIND: {e}"))?;
        let max_sessions: u8 = env_or("REMOTE_OS_MAX_SESSIONS", "3")
            .parse()
            .map_err(|e| format!("REMOTE_OS_MAX_SESSIONS: {e}"))?;
        if !(1..=9).contains(&max_sessions) {
            return Err("REMOTE_OS_MAX_SESSIONS must be 1..=9 (display :2N is one digit)".into());
        }
        let csv = |s: String| -> Vec<String> {
            s.split(',')
                .map(|x| x.trim().to_string())
                .filter(|x| !x.is_empty())
                .collect()
        };
        Ok(Config {
            bind,
            db_path: PathBuf::from(state_dir.split(':').next().unwrap_or(&state_dir))
                .join("sessions.db"),
            run_dir: PathBuf::from(run_dir.split(':').next().unwrap_or(&run_dir)),
            xauthority: PathBuf::from(env_or("XAUTHORITY", "/run/remote-os/xauthority")),
            turn_secret_file: PathBuf::from(env_or(
                "REMOTE_OS_TURN_SECRET_FILE",
                "/etc/remote-os/turn.secret",
            )),
            turn_urls: csv(env_or(
                "REMOTE_OS_TURN_URLS",
                "turn:92.4.83.196:443?transport=tcp",
            )),
            turn_ttl_secs: 600,
            max_sessions,
            webrtc_turn: env_or("REMOTE_OS_WEBRTC_TURN", "0") == "1",
            vbv_ms: env_or("REMOTE_OS_VBV_MS", "150").parse().unwrap_or(150),
            allowed_origins: csv(env_or(
                "REMOTE_OS_ALLOWED_ORIGINS",
                "https://www.ravikishan.me,https://ravikishan.me,http://localhost:3000",
            )),
        })
    }
}
