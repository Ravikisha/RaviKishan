//! Capture backends.
//!
//! [`CaptureBackend`] is the seam Wayland (Milestone 2: wlr-screencopy or
//! PipeWire) drops into. Milestone 1 ships one implementation, [`X11Capture`]:
//! `ximagesrc` on the session's Xvfb display, which runs at the profile's own
//! resolution so the pipeline never scales.

pub mod xauth;

use std::path::Path;

#[derive(Debug, thiserror::Error)]
pub enum CaptureError {
    #[error("invalid display name {0:?}")]
    BadDisplay(String),
    #[error("GStreamer element {0} is unavailable: {1}")]
    Element(&'static str, String),
    #[error("X display {display} is not reachable: {detail}")]
    Unreachable { display: String, detail: String },
}

pub trait CaptureBackend: Send + Sync {
    /// Short name for logs and stats ("x11").
    fn kind(&self) -> &'static str;
    /// A live raw-video source element. Downstream caps fix the frame rate.
    fn make_source(&self) -> Result<gst::Element, CaptureError>;
    /// The geometry the source will produce, if the display is up.
    fn geometry(&self) -> Result<(u32, u32), CaptureError>;
}

/// Accepts only `:<digits>` (local displays). Nothing else reaches Xlib.
pub fn valid_display(d: &str) -> bool {
    d.len() >= 2 && d.len() <= 6 && d.starts_with(':') && d[1..].bytes().all(|b| b.is_ascii_digit())
}

pub struct X11Capture {
    display: String,
}

impl X11Capture {
    pub fn new(display: &str) -> Result<X11Capture, CaptureError> {
        if !valid_display(display) {
            return Err(CaptureError::BadDisplay(display.into()));
        }
        Ok(X11Capture {
            display: display.to_string(),
        })
    }

    pub fn display(&self) -> &str {
        &self.display
    }
}

impl CaptureBackend for X11Capture {
    fn kind(&self) -> &'static str {
        "x11"
    }

    fn make_source(&self) -> Result<gst::Element, CaptureError> {
        gst::ElementFactory::make("ximagesrc")
            .name("src")
            .property("display-name", &self.display)
            // XDamage-driven partial capture was measured no faster here and
            // is unreliable on Xvfb; capture whole frames.
            .property("use-damage", false)
            .property("show-pointer", true)
            .build()
            .map_err(|e| CaptureError::Element("ximagesrc", e.to_string()))
    }

    fn geometry(&self) -> Result<(u32, u32), CaptureError> {
        probe_display(&self.display)
    }
}

/// Connects to a display (auth from `$XAUTHORITY`) and returns the root
/// window's size. Used as the readiness probe for a new session.
pub fn probe_display(display: &str) -> Result<(u32, u32), CaptureError> {
    if !valid_display(display) {
        return Err(CaptureError::BadDisplay(display.into()));
    }
    let (conn, screen) = x11rb::connect(Some(display)).map_err(|e| CaptureError::Unreachable {
        display: display.into(),
        detail: e.to_string(),
    })?;
    let s = &x11rb::connection::Connection::setup(&conn).roots[screen];
    Ok((s.width_in_pixels as u32, s.height_in_pixels as u32))
}

/// Rebuilds the supervisor's own authority file from the per-session cookie
/// files: one FamilyWild entry per live display. Xlib (ximagesrc) and x11rb
/// both read `$XAUTHORITY` at connect time, so one process can hold
/// connections to several isolated displays.
pub fn rebuild_authority(
    target: &Path,
    sessions: &[(String, std::path::PathBuf)],
) -> std::io::Result<usize> {
    let mut entries = Vec::new();
    for (disp, cookie_file) in sessions {
        let number = disp.trim_start_matches(':').to_string();
        match std::fs::read(cookie_file) {
            Ok(bytes) => match xauth::parse(&bytes) {
                Ok(parsed) => {
                    if let Some(cookie) = xauth::cookie_for(&parsed, &number) {
                        entries.push(xauth::Entry::wild(&number, cookie));
                    }
                }
                Err(e) => tracing::warn!(display = %disp, error = %e, "unparseable X cookie file"),
            },
            Err(e) => {
                tracing::debug!(display = %disp, error = %e, "X cookie file not readable yet")
            }
        }
    }
    let n = entries.len();
    xauth::write_atomic(target, &entries)?;
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_names() {
        assert!(valid_display(":21"));
        assert!(valid_display(":1"));
        assert!(!valid_display("21"));
        assert!(!valid_display(":"));
        assert!(!valid_display("host:0"));
        assert!(!valid_display(":21 ! filesink location=/etc/x"));
        assert!(X11Capture::new("evil:0").is_err());
    }
}
