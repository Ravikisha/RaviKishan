//! REST shapes (`/api/v1`). Errors are always `{error, code}`.

use serde::{Deserialize, Serialize};

use crate::Profile;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SessionState {
    Creating,
    Ready,
    Connected,
    Idle,
    Stopping,
    Stopped,
    Failed,
}

impl SessionState {
    pub const ALL: [SessionState; 7] = [
        SessionState::Creating,
        SessionState::Ready,
        SessionState::Connected,
        SessionState::Idle,
        SessionState::Stopping,
        SessionState::Stopped,
        SessionState::Failed,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            SessionState::Creating => "CREATING",
            SessionState::Ready => "READY",
            SessionState::Connected => "CONNECTED",
            SessionState::Idle => "IDLE",
            SessionState::Stopping => "STOPPING",
            SessionState::Stopped => "STOPPED",
            SessionState::Failed => "FAILED",
        }
    }

    pub fn parse(s: &str) -> Option<SessionState> {
        SessionState::ALL.into_iter().find(|x| x.as_str() == s)
    }

    /// A session in a terminal state holds no slot and no display.
    pub fn is_terminal(self) -> bool {
        matches!(self, SessionState::Stopped | SessionState::Failed)
    }

    /// A viewer may attach only to a desktop that is up.
    pub fn is_viewable(self) -> bool {
        matches!(
            self,
            SessionState::Ready | SessionState::Connected | SessionState::Idle
        )
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateSessionRequest {
    pub name: String,
    pub profile: String,
}

pub const MAX_SESSION_NAME: usize = 64;

/// Validates a session name: 1..=64 chars, printable, no control characters.
pub fn valid_session_name(name: &str) -> bool {
    let n = name.trim();
    !n.is_empty() && n.chars().count() <= MAX_SESSION_NAME && !n.chars().any(char::is_control)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    pub id: String,
    pub name: String,
    pub profile: Profile,
    pub state: SessionState,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    /// RFC 3339.
    pub created_at: String,
    /// Last state change, RFC 3339.
    pub last_active_at: String,
    /// Whether a viewer is attached (filled in by the supervisor).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub viewer: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ProfileAllowance {
    pub allowed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// `GET /capacity` → `{max, running, profiles:{"720p30":{allowed, reason?}, ...}}`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CapacityView {
    pub max: u32,
    /// Sessions not STOPPED/FAILED.
    pub running: u32,
    /// Whether a NEW session of each profile would be admitted right now
    /// (1080p60 runs only alone), with the reason when not.
    pub profiles: std::collections::BTreeMap<String, ProfileAllowance>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ApiError {
    pub error: String,
    pub code: String,
}

impl ApiError {
    pub fn new(code: &str, error: impl Into<String>) -> ApiError {
        ApiError {
            error: error.into(),
            code: code.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn states_serialise_as_contract() {
        for s in SessionState::ALL {
            let j = serde_json::to_string(&s).unwrap();
            assert_eq!(j, format!("\"{}\"", s.as_str()));
            assert_eq!(SessionState::parse(s.as_str()), Some(s));
        }
    }

    #[test]
    fn session_view_is_camel_case() {
        let v = SessionView {
            id: "a".into(),
            name: "n".into(),
            profile: Profile::P720p30,
            state: SessionState::Ready,
            width: 1280,
            height: 720,
            fps: 30,
            created_at: "2026-10-11T00:00:00Z".into(),
            last_active_at: "2026-10-11T00:00:00Z".into(),
            viewer: None,
            error: None,
        };
        let j = serde_json::to_value(&v).unwrap();
        assert_eq!(j["createdAt"], "2026-10-11T00:00:00Z");
        assert_eq!(j["profile"], "720p30");
        assert_eq!(j["state"], "READY");
        assert!(j.get("error").is_none());
        assert_eq!(j["lastActiveAt"], "2026-10-11T00:00:00Z");
        assert!(j.get("viewer").is_none());
    }

    #[test]
    fn names() {
        assert!(valid_session_name("work"));
        assert!(!valid_session_name("   "));
        assert!(!valid_session_name("a\nb"));
        assert!(!valid_session_name(&"x".repeat(65)));
        assert!(valid_session_name(&"x".repeat(64)));
    }
}
