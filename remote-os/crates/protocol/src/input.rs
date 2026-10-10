//! The `input` DataChannel: client → server, JSON, `v:1`, strictly increasing
//! `seq`, ≤ 512 bytes (a `clip` message has its own 64 KiB limit), ≤ 400
//! messages per second.
//!
//! The parser is total: every byte sequence produces either an event or an
//! [`InputError`] with a stable code. Nothing here can panic on client input,
//! which is what the "malformed/oversized messages are rejected without
//! crashing" requirement rests on.

use std::time::Instant;

use serde::Deserialize;

pub const PROTOCOL_VERSION: u32 = 1;
pub const MAX_INPUT_BYTES: usize = 512;
/// Decoded clipboard text limit.
pub const MAX_CLIP_TEXT_BYTES: usize = 64 * 1024;
/// A clip message is the text plus its envelope; JSON escaping can at most
/// sextuple a byte (`\u00XX`), but a client sending that is not our problem —
/// the text limit is what matters, this only bounds the work.
pub const MAX_CLIP_MESSAGE_BYTES: usize = MAX_CLIP_TEXT_BYTES + 1024;
pub const MAX_MSGS_PER_SEC: f64 = 400.0;
/// Heartbeats come every 2 s; three missed means the viewer is gone.
pub const HEARTBEAT_TIMEOUT_MS: u64 = 6_000;
/// Wheel notches per message are clamped to this.
pub const MAX_WHEEL_NOTCHES: i32 = 10;

#[derive(Debug, Clone, PartialEq)]
pub enum InputEvent {
    PointerMove {
        x: f64,
        y: f64,
    },
    PointerDown {
        button: u8,
        x: f64,
        y: f64,
    },
    PointerUp {
        button: u8,
        x: f64,
        y: f64,
    },
    Wheel {
        dx: i32,
        dy: i32,
    },
    KeyDown {
        code: String,
        key: String,
    },
    KeyUp {
        code: String,
        key: String,
    },
    ReleaseAll,
    Heartbeat,
    /// Set the remote clipboard.
    Clip {
        text: String,
    },
    /// Owner-initiated pull of the remote clipboard (`{t:"clip?"}`).
    ClipPull,
    /// Request a profile change.
    Resolution {
        profile: String,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct InputMsg {
    pub seq: u64,
    pub event: InputEvent,
}

#[derive(Debug, Clone, PartialEq)]
pub enum InputError {
    TooLarge(usize),
    Malformed,
    Version(u64),
    UnknownType,
    Missing(&'static str),
    OutOfRange(&'static str),
    Replayed { seq: u64, last: u64 },
    RateLimited,
    Binary,
}

impl InputError {
    pub fn code(&self) -> &'static str {
        match self {
            InputError::TooLarge(_) => "input/too-large",
            InputError::Malformed => "input/malformed",
            InputError::Version(_) => "input/version",
            InputError::UnknownType => "input/unknown-type",
            InputError::Missing(_) => "input/missing-field",
            InputError::OutOfRange(_) => "input/out-of-range",
            InputError::Replayed { .. } => "input/replayed",
            InputError::RateLimited => "input/rate-limited",
            InputError::Binary => "input/binary",
        }
    }
}

#[derive(Deserialize)]
struct Raw {
    v: Option<u64>,
    seq: Option<u64>,
    t: Option<String>,
    x: Option<f64>,
    y: Option<f64>,
    b: Option<u64>,
    dx: Option<f64>,
    dy: Option<f64>,
    code: Option<String>,
    key: Option<String>,
    text: Option<String>,
    profile: Option<String>,
}

fn coord(v: Option<f64>, name: &'static str) -> Result<f64, InputError> {
    let v = v.ok_or(InputError::Missing(name))?;
    if !v.is_finite() {
        return Err(InputError::OutOfRange(name));
    }
    // A pointer dragged slightly past the edge of the video is normal; a
    // coordinate of 1e9 is not.
    if !(-0.5..=1.5).contains(&v) {
        return Err(InputError::OutOfRange(name));
    }
    Ok(v.clamp(0.0, 1.0))
}

fn notches(v: Option<f64>, name: &'static str) -> Result<i32, InputError> {
    let v = v.unwrap_or(0.0);
    if !v.is_finite() || v.abs() > 1000.0 {
        return Err(InputError::OutOfRange(name));
    }
    Ok((v.round() as i32).clamp(-MAX_WHEEL_NOTCHES, MAX_WHEEL_NOTCHES))
}

fn button(v: Option<u64>) -> Result<u8, InputError> {
    match v {
        Some(b @ 1..=3) => Ok(b as u8),
        Some(_) => Err(InputError::OutOfRange("b")),
        None => Err(InputError::Missing("b")),
    }
}

fn key_code(v: Option<String>) -> Result<String, InputError> {
    let c = v.ok_or(InputError::Missing("code"))?;
    // KeyboardEvent.code values are ASCII identifiers ("KeyA", "ArrowLeft").
    // An empty code is legal in browsers for some IME/virtual keys; the
    // server then falls back to `key`.
    if c.len() > 40 || !c.chars().all(|ch| ch.is_ascii_alphanumeric()) {
        return Err(InputError::OutOfRange("code"));
    }
    Ok(c)
}

fn key_value(v: Option<String>) -> Result<String, InputError> {
    let k = v.unwrap_or_default();
    if k.len() > 32 || k.chars().any(|c| c.is_control()) {
        return Err(InputError::OutOfRange("key"));
    }
    Ok(k)
}

/// Parses one text message. Size is checked before any JSON work.
pub fn parse_input(text: &str) -> Result<InputMsg, InputError> {
    if text.len() > MAX_CLIP_MESSAGE_BYTES {
        return Err(InputError::TooLarge(text.len()));
    }
    let raw: Raw = serde_json::from_str(text).map_err(|_| InputError::Malformed)?;
    let v = raw.v.ok_or(InputError::Missing("v"))?;
    if v != PROTOCOL_VERSION as u64 {
        return Err(InputError::Version(v));
    }
    let seq = raw.seq.ok_or(InputError::Missing("seq"))?;
    let t = raw.t.ok_or(InputError::Missing("t"))?;
    // Only a clip message may exceed the general limit.
    if text.len() > MAX_INPUT_BYTES && t != "clip" {
        return Err(InputError::TooLarge(text.len()));
    }
    let event = match t.as_str() {
        "pm" => InputEvent::PointerMove {
            x: coord(raw.x, "x")?,
            y: coord(raw.y, "y")?,
        },
        "pd" | "pu" => {
            let button = button(raw.b)?;
            let x = coord(raw.x, "x")?;
            let y = coord(raw.y, "y")?;
            if t == "pd" {
                InputEvent::PointerDown { button, x, y }
            } else {
                InputEvent::PointerUp { button, x, y }
            }
        }
        "wh" => InputEvent::Wheel {
            dx: notches(raw.dx, "dx")?,
            dy: notches(raw.dy, "dy")?,
        },
        "kd" | "ku" => {
            let code = key_code(raw.code)?;
            let key = key_value(raw.key)?;
            if code.is_empty() && key.is_empty() {
                return Err(InputError::Missing("code"));
            }
            if t == "kd" {
                InputEvent::KeyDown { code, key }
            } else {
                InputEvent::KeyUp { code, key }
            }
        }
        "rel" => InputEvent::ReleaseAll,
        "hb" => InputEvent::Heartbeat,
        "clip" => {
            let text = raw.text.ok_or(InputError::Missing("text"))?;
            if text.len() > MAX_CLIP_TEXT_BYTES {
                return Err(InputError::TooLarge(text.len()));
            }
            InputEvent::Clip { text }
        }
        "clip?" => InputEvent::ClipPull,
        "res" => {
            let profile = raw.profile.ok_or(InputError::Missing("profile"))?;
            if profile.len() > 16 {
                return Err(InputError::OutOfRange("profile"));
            }
            InputEvent::Resolution { profile }
        }
        _ => return Err(InputError::UnknownType),
    };
    Ok(InputMsg { seq, event })
}

/// Token bucket: `capacity` messages of burst, refilled at `rate` per second.
#[derive(Debug, Clone)]
pub struct TokenBucket {
    capacity: f64,
    rate: f64,
    tokens: f64,
    last: Instant,
}

impl TokenBucket {
    pub fn new(capacity: f64, rate: f64, now: Instant) -> TokenBucket {
        TokenBucket {
            capacity,
            rate,
            tokens: capacity,
            last: now,
        }
    }

    pub fn take(&mut self, now: Instant) -> bool {
        let dt = now.saturating_duration_since(self.last).as_secs_f64();
        self.last = now;
        self.tokens = (self.tokens + dt * self.rate).min(self.capacity);
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

/// Per-channel admission: rate limit (every message counts, valid or not, so
/// a flood of garbage is as bounded as a flood of moves), then parse, then
/// sequence check.
#[derive(Debug)]
pub struct InputGate {
    bucket: TokenBucket,
    last_seq: Option<u64>,
    pub accepted: u64,
    pub rejected: u64,
}

impl InputGate {
    pub fn new(now: Instant) -> InputGate {
        InputGate {
            bucket: TokenBucket::new(MAX_MSGS_PER_SEC, MAX_MSGS_PER_SEC, now),
            last_seq: None,
            accepted: 0,
            rejected: 0,
        }
    }

    pub fn admit_text(&mut self, text: &str, now: Instant) -> Result<InputMsg, InputError> {
        let r = self.admit_inner(text, now);
        match r {
            Ok(_) => self.accepted += 1,
            Err(_) => self.rejected += 1,
        }
        r
    }

    /// Binary frames are never valid on `input`.
    pub fn reject_binary(&mut self, now: Instant) -> InputError {
        let _ = self.bucket.take(now);
        self.rejected += 1;
        InputError::Binary
    }

    fn admit_inner(&mut self, text: &str, now: Instant) -> Result<InputMsg, InputError> {
        if !self.bucket.take(now) {
            return Err(InputError::RateLimited);
        }
        let msg = parse_input(text)?;
        if let Some(last) = self.last_seq {
            if msg.seq <= last {
                return Err(InputError::Replayed { seq: msg.seq, last });
            }
        }
        self.last_seq = Some(msg.seq);
        Ok(msg)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn ok(s: &str) -> InputEvent {
        parse_input(s).unwrap().event
    }

    #[test]
    fn every_message_type_parses() {
        assert_eq!(
            ok(r#"{"v":1,"seq":1,"t":"pm","x":0.5,"y":0.25}"#),
            InputEvent::PointerMove { x: 0.5, y: 0.25 }
        );
        assert_eq!(
            ok(r#"{"v":1,"seq":1,"t":"pd","b":1,"x":0,"y":1}"#),
            InputEvent::PointerDown {
                button: 1,
                x: 0.0,
                y: 1.0
            }
        );
        assert_eq!(
            ok(r#"{"v":1,"seq":1,"t":"pu","b":3,"x":0.1,"y":0.1}"#),
            InputEvent::PointerUp {
                button: 3,
                x: 0.1,
                y: 0.1
            }
        );
        assert_eq!(
            ok(r#"{"v":1,"seq":1,"t":"wh","dx":0,"dy":-2}"#),
            InputEvent::Wheel { dx: 0, dy: -2 }
        );
        assert_eq!(
            ok(r#"{"v":1,"seq":1,"t":"kd","code":"KeyA","key":"a"}"#),
            InputEvent::KeyDown {
                code: "KeyA".into(),
                key: "a".into()
            }
        );
        assert_eq!(
            ok(r#"{"v":1,"seq":1,"t":"ku","code":"ShiftLeft","key":"Shift"}"#),
            InputEvent::KeyUp {
                code: "ShiftLeft".into(),
                key: "Shift".into()
            }
        );
        assert_eq!(ok(r#"{"v":1,"seq":1,"t":"rel"}"#), InputEvent::ReleaseAll);
        assert_eq!(ok(r#"{"v":1,"seq":1,"t":"hb"}"#), InputEvent::Heartbeat);
        assert_eq!(
            ok(r#"{"v":1,"seq":1,"t":"clip","text":"héllo"}"#),
            InputEvent::Clip {
                text: "héllo".into()
            }
        );
        assert_eq!(ok(r#"{"v":1,"seq":1,"t":"clip?"}"#), InputEvent::ClipPull);
        assert_eq!(
            ok(r#"{"v":1,"seq":1,"t":"res","profile":"1080p30"}"#),
            InputEvent::Resolution {
                profile: "1080p30".into()
            }
        );
    }

    #[test]
    fn coordinates_are_clamped_or_refused() {
        assert_eq!(
            ok(r#"{"v":1,"seq":1,"t":"pm","x":1.2,"y":-0.1}"#),
            InputEvent::PointerMove { x: 1.0, y: 0.0 }
        );
        assert_eq!(
            parse_input(r#"{"v":1,"seq":1,"t":"pm","x":1e9,"y":0}"#),
            Err(InputError::OutOfRange("x"))
        );
        assert_eq!(
            parse_input(r#"{"v":1,"seq":1,"t":"pm","x":0.5}"#),
            Err(InputError::Missing("y"))
        );
        // JSON has no NaN literal; a string is a type error.
        assert_eq!(
            parse_input(r#"{"v":1,"seq":1,"t":"pm","x":"NaN","y":0}"#),
            Err(InputError::Malformed)
        );
    }

    #[test]
    fn wheel_is_clamped() {
        assert_eq!(
            ok(r#"{"v":1,"seq":1,"t":"wh","dx":99,"dy":-99}"#),
            InputEvent::Wheel { dx: 10, dy: -10 }
        );
        assert_eq!(
            parse_input(r#"{"v":1,"seq":1,"t":"wh","dy":1e300}"#),
            Err(InputError::OutOfRange("dy"))
        );
    }

    #[test]
    fn malformed_messages_are_refused_not_panicked_on() {
        let cases = [
            "",
            "null",
            "[]",
            "{",
            "\u{0}",
            r#"{"v":1}"#,
            r#"{"seq":1,"t":"hb"}"#,
            r#"{"v":2,"seq":1,"t":"hb"}"#,
            r#"{"v":1,"seq":-1,"t":"hb"}"#,
            r#"{"v":1,"seq":1,"t":"exec","cmd":"id"}"#,
            r#"{"v":1,"seq":1,"t":"pd","b":4,"x":0,"y":0}"#,
            r#"{"v":1,"seq":1,"t":"pd","b":0,"x":0,"y":0}"#,
            r#"{"v":1,"seq":1,"t":"kd","code":"Key A","key":"a"}"#,
            r#"{"v":1,"seq":1,"t":"kd","code":"","key":""}"#,
            r#"{"v":1,"seq":1,"t":"kd","code":"KeyA","key":"\u0007"}"#,
            r#"{"v":1,"seq":1,"t":"res","profile":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}"#,
            r#"{"v":1,"seq":18446744073709551616,"t":"hb"}"#,
        ];
        for c in cases {
            assert!(parse_input(c).is_err(), "should refuse {c:?}");
        }
    }

    #[test]
    fn size_limits() {
        let pad = "a".repeat(600);
        let big_move = format!(r#"{{"v":1,"seq":1,"t":"pm","x":0,"y":0,"pad":"{pad}"}}"#);
        assert!(matches!(
            parse_input(&big_move),
            Err(InputError::TooLarge(_))
        ));
        // Clip may exceed 512 bytes...
        let clip = format!(
            r#"{{"v":1,"seq":1,"t":"clip","text":"{}"}}"#,
            "b".repeat(10_000)
        );
        assert!(parse_input(&clip).is_ok());
        // ...but not 64 KiB of text.
        let huge = format!(
            r#"{{"v":1,"seq":1,"t":"clip","text":"{}"}}"#,
            "b".repeat(MAX_CLIP_TEXT_BYTES + 1)
        );
        assert!(matches!(parse_input(&huge), Err(InputError::TooLarge(_))));
        // And nothing beyond the envelope is even parsed.
        let absurd = "x".repeat(MAX_CLIP_MESSAGE_BYTES + 1);
        assert!(matches!(parse_input(&absurd), Err(InputError::TooLarge(_))));
    }

    #[test]
    fn gate_enforces_monotonic_seq() {
        let now = Instant::now();
        let mut g = InputGate::new(now);
        assert!(g.admit_text(r#"{"v":1,"seq":5,"t":"hb"}"#, now).is_ok());
        assert_eq!(
            g.admit_text(r#"{"v":1,"seq":5,"t":"hb"}"#, now),
            Err(InputError::Replayed { seq: 5, last: 5 })
        );
        assert!(g.admit_text(r#"{"v":1,"seq":4,"t":"hb"}"#, now).is_err());
        assert!(g.admit_text(r#"{"v":1,"seq":9,"t":"hb"}"#, now).is_ok());
        assert_eq!((g.accepted, g.rejected), (2, 2));
    }

    #[test]
    fn gate_enforces_rate() {
        let t0 = Instant::now();
        let mut g = InputGate::new(t0);
        let mut ok = 0;
        for i in 0..1000u64 {
            let m = format!(r#"{{"v":1,"seq":{},"t":"hb"}}"#, i + 1);
            if g.admit_text(&m, t0).is_ok() {
                ok += 1;
            }
        }
        assert_eq!(ok, 400, "burst is capped at 400");
        // After a second the bucket has refilled.
        let t1 = t0 + Duration::from_secs(1);
        assert!(g.admit_text(r#"{"v":1,"seq":5000,"t":"hb"}"#, t1).is_ok());
        // Garbage counts against the budget too.
        let mut g = InputGate::new(t0);
        for _ in 0..400 {
            let _ = g.admit_text("garbage", t0);
        }
        assert_eq!(
            g.admit_text(r#"{"v":1,"seq":1,"t":"hb"}"#, t0),
            Err(InputError::RateLimited)
        );
    }

    #[test]
    fn every_error_has_a_code() {
        for e in [
            InputError::TooLarge(1),
            InputError::Malformed,
            InputError::Version(2),
            InputError::UnknownType,
            InputError::Missing("x"),
            InputError::OutOfRange("x"),
            InputError::Replayed { seq: 1, last: 1 },
            InputError::RateLimited,
            InputError::Binary,
        ] {
            assert!(e.code().starts_with("input/"));
        }
    }
}
