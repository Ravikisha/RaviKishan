//! The `status` DataChannel: server → client, unordered, no retransmits.

use serde::{Deserialize, Serialize};

/// Sent every second.
///
/// - `fps`: frames encoded in the last second.
/// - `bitrate`: encoder output over the last second, **bit/s**.
/// - `encodeMs`: mean x264 time per frame over the last second.
/// - `captured` / `encoded` / `dropped`: cumulative since the pipeline
///   started (dropped = frames the leaky queue discarded before x264).
/// - Extra fields beyond the contract are additive and optional for clients.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct StatsMsg {
    pub t: String,
    pub fps: f64,
    pub bitrate: u64,
    pub encode_ms: f64,
    pub width: u32,
    pub height: u32,
    pub captured: u64,
    pub encoded: u64,
    pub dropped: u64,
    /// Current adaptive VBV cap, kbit/s.
    pub bitrate_cap_kbps: u32,
    /// Keyframes forced on PLI/FIR since start.
    pub keyframes: u64,
    /// Input messages refused (size, rate, seq, shape) since the channel opened.
    pub rejected: u64,
    /// From the receiver's RTCP report, when there is one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rtt_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loss: Option<f64>,
    pub profile: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ClipMsg {
    pub t: &'static str,
    pub text: String,
}

impl ClipMsg {
    pub fn new(text: String) -> ClipMsg {
        ClipMsg { t: "clip", text }
    }
}

/// `{t:"res",profile,width,height,fps}` after a profile change is applied.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ResMsg {
    pub t: &'static str,
    pub profile: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
}

impl ResMsg {
    pub fn new(p: crate::Profile) -> ResMsg {
        ResMsg {
            t: "res",
            profile: p.id().into(),
            width: p.width(),
            height: p.height(),
            fps: p.fps(),
        }
    }
}

/// `{t:"error",code,error}`: a refused `res`/`clip?`/input, shown verbatim
/// by the viewer.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ErrorMsg {
    pub t: &'static str,
    pub code: String,
    pub error: String,
}

impl ErrorMsg {
    pub fn new(code: &str, error: impl Into<String>) -> ErrorMsg {
        ErrorMsg {
            t: "error",
            code: code.into(),
            error: error.into(),
        }
    }
}

/// Generic ack (kept for completeness; the contract uses ResMsg/ErrorMsg).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AckMsg {
    pub t: &'static str,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl AckMsg {
    pub fn ok(t: &'static str, profile: Option<String>) -> AckMsg {
        AckMsg {
            t,
            ok: true,
            profile,
            code: None,
            error: None,
        }
    }
    pub fn err(t: &'static str, code: &str, error: impl Into<String>) -> AckMsg {
        AckMsg {
            t,
            ok: false,
            profile: None,
            code: Some(code.into()),
            error: Some(error.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stats_keys_match_contract() {
        let s = StatsMsg {
            t: "stats".into(),
            fps: 30.0,
            bitrate: 1_000_000,
            encode_ms: 3.2,
            width: 1280,
            height: 720,
            captured: 10,
            encoded: 9,
            dropped: 1,
            ..Default::default()
        };
        let v = serde_json::to_value(&s).unwrap();
        for k in [
            "t", "fps", "bitrate", "encodeMs", "width", "height", "captured", "encoded", "dropped",
        ] {
            assert!(v.get(k).is_some(), "missing {k}");
        }
        assert!(v.get("rttMs").is_none());
    }

    #[test]
    fn clip_and_ack() {
        assert_eq!(
            serde_json::to_string(&ClipMsg::new("x".into())).unwrap(),
            r#"{"t":"clip","text":"x"}"#
        );
        let r = serde_json::to_value(ResMsg::new(crate::Profile::P1080p60)).unwrap();
        assert_eq!(r["t"], "res");
        assert_eq!(r["fps"], 60);
        let e = serde_json::to_value(ErrorMsg::new("profile/unknown", "no")).unwrap();
        assert_eq!(e["t"], "error");
        assert_eq!(e["code"], "profile/unknown");
        let a = serde_json::to_value(AckMsg::err("res", "profile/unknown", "no")).unwrap();
        assert_eq!(a["ok"], false);
        assert_eq!(a["code"], "profile/unknown");
    }
}
