//! The three streaming profiles. A session's Xvfb runs AT the profile's
//! resolution, so a profile is a property of the display, not just the encoder
//! (the spike measured in-pipeline scaling at ~45% of a core).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Profile {
    #[serde(rename = "720p30")]
    P720p30,
    #[serde(rename = "1080p30")]
    P1080p30,
    #[serde(rename = "1080p60")]
    P1080p60,
}

impl Profile {
    pub const ALL: [Profile; 3] = [Profile::P720p30, Profile::P1080p30, Profile::P1080p60];

    pub fn id(self) -> &'static str {
        match self {
            Profile::P720p30 => "720p30",
            Profile::P1080p30 => "1080p30",
            Profile::P1080p60 => "1080p60",
        }
    }

    pub fn parse(s: &str) -> Option<Profile> {
        Profile::ALL.into_iter().find(|p| p.id() == s)
    }

    pub fn width(self) -> u32 {
        match self {
            Profile::P720p30 => 1280,
            _ => 1920,
        }
    }

    pub fn height(self) -> u32 {
        match self {
            Profile::P720p30 => 720,
            _ => 1080,
        }
    }

    pub fn fps(self) -> u32 {
        match self {
            Profile::P1080p60 => 60,
            _ => 30,
        }
    }

    /// The VBV cap x264 runs under in quality mode, kbit/s. The adaptive
    /// controller never goes above this.
    pub fn bitrate_cap_kbps(self) -> u32 {
        match self {
            Profile::P720p30 => 2500,
            Profile::P1080p30 => 4500,
            Profile::P1080p60 => 7000,
        }
    }

    /// The floor the adaptive controller backs off to under loss.
    pub fn bitrate_floor_kbps(self) -> u32 {
        self.bitrate_cap_kbps() * 3 / 10
    }

    /// H.264 level x264 is told to signal, so `profile-level-id` in the SDP is
    /// pinned rather than left to whatever x264 picks (1080p60 needs 4.2).
    pub fn h264_level(self) -> &'static str {
        match self {
            Profile::P720p30 => "3.1",
            Profile::P1080p30 => "4",
            Profile::P1080p60 => "4.2",
        }
    }

    /// constrained-baseline (42 c0) + level.
    pub fn profile_level_id(self) -> &'static str {
        match self {
            Profile::P720p30 => "42c01f",
            Profile::P1080p30 => "42c028",
            Profile::P1080p60 => "42c02a",
        }
    }

    /// Keyframe interval in frames: 4 seconds. Keyframes otherwise come on
    /// PLI/FIR from the receiver.
    pub fn key_int_max(self) -> u32 {
        self.fps() * 4
    }

    /// 1080p60 takes about half the box on its own; it runs only alone.
    pub fn exclusive(self) -> bool {
        matches!(self, Profile::P1080p60)
    }

    pub fn videoconvert_threads(self) -> u32 {
        match self {
            Profile::P720p30 => 1,
            Profile::P1080p30 => 2,
            Profile::P1080p60 => 4,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_round_trip() {
        for p in Profile::ALL {
            assert_eq!(Profile::parse(p.id()), Some(p));
            let json = serde_json::to_string(&p).unwrap();
            assert_eq!(json, format!("\"{}\"", p.id()));
            assert_eq!(serde_json::from_str::<Profile>(&json).unwrap(), p);
        }
        assert_eq!(Profile::parse("4k120"), None);
        assert_eq!(Profile::parse(""), None);
    }

    #[test]
    fn geometry_and_levels() {
        assert_eq!(
            (Profile::P720p30.width(), Profile::P720p30.height()),
            (1280, 720)
        );
        assert_eq!(Profile::P1080p60.fps(), 60);
        assert_eq!(Profile::P1080p60.profile_level_id(), "42c02a");
        assert_eq!(Profile::P1080p60.key_int_max(), 240);
        assert!(Profile::P1080p60.exclusive());
        assert!(!Profile::P720p30.exclusive());
        for p in Profile::ALL {
            assert!(p.bitrate_floor_kbps() < p.bitrate_cap_kbps());
        }
    }
}
