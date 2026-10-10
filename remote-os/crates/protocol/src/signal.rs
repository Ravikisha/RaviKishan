//! Signalling over the WebSocket `GET /api/v1/sessions/:id/signal`.
//!
//! Sequence: client `auth` (within 5 s, else close 4401) → server
//! `ice-servers` → client `ready` → server `offer` → client `answer` → both
//! trickle `ice` → `bye` either way. A second viewer replaces the first, which
//! is sent `replaced`.

use serde::{Deserialize, Serialize};

/// Largest signalling frame accepted from a client. An SDP answer is a few KB.
pub const MAX_SIGNAL_BYTES: usize = 64 * 1024;

/// WebSocket close codes.
pub const CLOSE_AUTH: u16 = 4401;
pub const CLOSE_FORBIDDEN: u16 = 4403;
pub const CLOSE_NOT_FOUND: u16 = 4404;
pub const CLOSE_REPLACED: u16 = 4409;
pub const CLOSE_PROTOCOL: u16 = 4400;
pub const CLOSE_STOPPED: u16 = 4410;

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ClientSignal {
    /// First message; may be repeated later with a fresh token to extend a
    /// long viewing session past the first token's expiry.
    Auth {
        token: String,
    },
    Ready,
    Answer {
        sdp: String,
    },
    Ice {
        #[serde(default)]
        candidate: Option<String>,
        #[serde(rename = "sdpMLineIndex", default)]
        sdp_mline_index: Option<u32>,
    },
    Bye,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct IceServer {
    pub urls: Vec<String>,
    pub username: String,
    pub credential: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ServerSignal {
    IceServers {
        #[serde(rename = "iceServers")]
        ice_servers: Vec<IceServer>,
        policy: String,
    },
    Offer {
        sdp: String,
    },
    Ice {
        candidate: String,
        #[serde(rename = "sdpMLineIndex")]
        sdp_mline_index: u32,
    },
    Bye {
        reason: String,
    },
    Replaced,
    /// The server is about to send a NEW offer from a new pipeline (a live
    /// profile change). The client discards its RTCPeerConnection, makes a new
    /// one and sends `ready` again.
    Renegotiate {
        profile: String,
        width: u32,
        height: u32,
        fps: u32,
    },
    Error {
        error: String,
        code: String,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub enum SignalError {
    TooLarge(usize),
    Malformed,
}

impl SignalError {
    pub fn code(&self) -> &'static str {
        match self {
            SignalError::TooLarge(_) => "signal/too-large",
            SignalError::Malformed => "signal/malformed",
        }
    }
}

pub fn parse_client_signal(text: &str) -> Result<ClientSignal, SignalError> {
    if text.len() > MAX_SIGNAL_BYTES {
        return Err(SignalError::TooLarge(text.len()));
    }
    serde_json::from_str(text).map_err(|_| SignalError::Malformed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_every_client_message() {
        assert_eq!(
            parse_client_signal(r#"{"type":"auth","token":"t"}"#).unwrap(),
            ClientSignal::Auth { token: "t".into() }
        );
        assert_eq!(
            parse_client_signal(r#"{"type":"ready"}"#).unwrap(),
            ClientSignal::Ready
        );
        assert_eq!(
            parse_client_signal(r#"{"type":"answer","sdp":"v=0"}"#).unwrap(),
            ClientSignal::Answer { sdp: "v=0".into() }
        );
        assert_eq!(
            parse_client_signal(r#"{"type":"ice","candidate":"candidate:1","sdpMLineIndex":0}"#)
                .unwrap(),
            ClientSignal::Ice {
                candidate: Some("candidate:1".into()),
                sdp_mline_index: Some(0)
            }
        );
        assert_eq!(
            parse_client_signal(r#"{"type":"ice","candidate":null}"#).unwrap(),
            ClientSignal::Ice {
                candidate: None,
                sdp_mline_index: None
            }
        );
        assert_eq!(
            parse_client_signal(r#"{"type":"bye"}"#).unwrap(),
            ClientSignal::Bye
        );
    }

    #[test]
    fn refuses_garbage() {
        assert_eq!(parse_client_signal("nope"), Err(SignalError::Malformed));
        assert_eq!(
            parse_client_signal(r#"{"type":"shell","cmd":"rm"}"#),
            Err(SignalError::Malformed)
        );
        assert_eq!(
            parse_client_signal(r#"{"type":"answer"}"#),
            Err(SignalError::Malformed)
        );
        let big = format!(
            r#"{{"type":"answer","sdp":"{}"}}"#,
            "a".repeat(MAX_SIGNAL_BYTES)
        );
        assert!(matches!(
            parse_client_signal(&big),
            Err(SignalError::TooLarge(_))
        ));
    }

    #[test]
    fn server_messages_match_contract() {
        let s = serde_json::to_value(ServerSignal::IceServers {
            ice_servers: vec![IceServer {
                urls: vec!["turn:h:443?transport=tcp".into()],
                username: "1:abc".into(),
                credential: "c".into(),
            }],
            policy: "relay".into(),
        })
        .unwrap();
        assert_eq!(s["type"], "ice-servers");
        assert_eq!(s["iceServers"][0]["urls"][0], "turn:h:443?transport=tcp");
        assert_eq!(s["policy"], "relay");
        let o = serde_json::to_value(ServerSignal::Ice {
            candidate: "c".into(),
            sdp_mline_index: 0,
        })
        .unwrap();
        assert_eq!(o["sdpMLineIndex"], 0);
        assert_eq!(
            serde_json::to_string(&ServerSignal::Replaced).unwrap(),
            r#"{"type":"replaced"}"#
        );
    }
}
