//! Input: the [`InputBackend`] seam, and a [`Controller`] that turns
//! validated protocol events into backend calls while tracking every key and
//! button held down, so a viewer that vanishes mid-drag (channel close,
//! heartbeat loss, `rel`) never leaves Ctrl or a mouse button stuck on the
//! remote desktop.

pub mod clipboard;
pub mod keymap;
pub mod x11;

use std::collections::{BTreeSet, HashMap};

use protocol::input::InputEvent;

use keymap::KeyTarget;

#[derive(Debug, thiserror::Error)]
pub enum InputError {
    #[error("X connection: {0}")]
    Connection(String),
    #[error("X request: {0}")]
    Request(String),
    #[error("XTest extension missing on this display")]
    NoXTest,
    #[error("no keycode available for keysym {0:#x}")]
    NoKeycode(u32),
}

/// What a backend can do. Coordinates are in screen pixels.
pub trait InputBackend: Send {
    fn screen_size(&self) -> (u32, u32);
    fn motion(&mut self, x: u32, y: u32) -> Result<(), InputError>;
    fn button(&mut self, button: u8, down: bool) -> Result<(), InputError>;
    /// Resolves a keysym to a keycode (possibly assigning a scratch keycode).
    fn keycode(&mut self, target: KeyTarget) -> Result<u8, InputError>;
    fn key(&mut self, keycode: u8, down: bool) -> Result<(), InputError>;
    fn flush(&mut self) -> Result<(), InputError>;
}

/// Events the controller does not apply itself.
#[derive(Debug, Clone, PartialEq)]
pub enum Outcome {
    Applied,
    Ignored,
    SetClipboard(String),
    PullClipboard,
    ChangeProfile(String),
}

pub struct Controller<B: InputBackend> {
    backend: B,
    /// Key id (`code`, or `key:<key>` when code is empty) → keycode pressed,
    /// so a release always lifts the keycode that went down even if the
    /// mapping changed in between.
    held_keys: HashMap<String, u8>,
    held_buttons: BTreeSet<u8>,
    pub applied: u64,
}

fn to_px(v: f64, size: u32) -> u32 {
    let max = size.saturating_sub(1) as f64;
    (v.clamp(0.0, 1.0) * max).round() as u32
}

fn key_id(code: &str, key: &str) -> String {
    if code.is_empty() {
        format!("key:{key}")
    } else {
        code.to_string()
    }
}

impl<B: InputBackend> Controller<B> {
    pub fn new(backend: B) -> Controller<B> {
        Controller {
            backend,
            held_keys: HashMap::new(),
            held_buttons: BTreeSet::new(),
            applied: 0,
        }
    }

    pub fn backend(&self) -> &B {
        &self.backend
    }

    pub fn held(&self) -> (usize, usize) {
        (self.held_keys.len(), self.held_buttons.len())
    }

    fn point(&mut self, x: f64, y: f64) -> Result<(), InputError> {
        let (w, h) = self.backend.screen_size();
        self.backend.motion(to_px(x, w), to_px(y, h))
    }

    pub fn handle(&mut self, ev: &InputEvent) -> Result<Outcome, InputError> {
        let out = match ev {
            InputEvent::PointerMove { x, y } => {
                self.point(*x, *y)?;
                Outcome::Applied
            }
            InputEvent::PointerDown { button, x, y } => {
                self.point(*x, *y)?;
                self.backend.button(*button, true)?;
                self.held_buttons.insert(*button);
                Outcome::Applied
            }
            InputEvent::PointerUp { button, x, y } => {
                self.point(*x, *y)?;
                self.backend.button(*button, false)?;
                self.held_buttons.remove(button);
                Outcome::Applied
            }
            InputEvent::Wheel { dx, dy } => {
                // X wheel = buttons 4 (up) 5 (down) 6 (left) 7 (right), one
                // press+release per notch.
                let (vb, vn) = if *dy < 0 { (4, -dy) } else { (5, *dy) };
                let (hb, hn) = if *dx < 0 { (6, -dx) } else { (7, *dx) };
                for _ in 0..vn {
                    self.backend.button(vb, true)?;
                    self.backend.button(vb, false)?;
                }
                for _ in 0..hn {
                    self.backend.button(hb, true)?;
                    self.backend.button(hb, false)?;
                }
                Outcome::Applied
            }
            InputEvent::KeyDown { code, key } => match keymap::resolve(code, key) {
                Some(target) => {
                    let id = key_id(code, key);
                    let kc = match self.held_keys.get(&id) {
                        // Browser auto-repeat: press the same keycode again
                        // (the session runs with server auto-repeat off).
                        Some(kc) => *kc,
                        None => self.backend.keycode(target)?,
                    };
                    self.backend.key(kc, true)?;
                    self.held_keys.insert(id, kc);
                    Outcome::Applied
                }
                None => Outcome::Ignored,
            },
            InputEvent::KeyUp { code, key } => {
                let id = key_id(code, key);
                match self.held_keys.remove(&id) {
                    Some(kc) => {
                        self.backend.key(kc, false)?;
                        Outcome::Applied
                    }
                    // A release for a key we never pressed (focus moved into
                    // the video with the key already down) is dropped: lifting
                    // a key that is not down is at best noise.
                    None => Outcome::Ignored,
                }
            }
            InputEvent::ReleaseAll => {
                self.release_all()?;
                Outcome::Applied
            }
            InputEvent::Heartbeat => Outcome::Ignored,
            InputEvent::Clip { text } => Outcome::SetClipboard(text.clone()),
            InputEvent::ClipPull => Outcome::PullClipboard,
            InputEvent::Resolution { profile } => Outcome::ChangeProfile(profile.clone()),
        };
        if out == Outcome::Applied {
            self.applied += 1;
            self.backend.flush()?;
        }
        Ok(out)
    }

    /// Lifts every held key and button. Returns how many were lifted.
    pub fn release_all(&mut self) -> Result<usize, InputError> {
        let keys: Vec<u8> = self.held_keys.drain().map(|(_, kc)| kc).collect();
        let buttons: Vec<u8> = std::mem::take(&mut self.held_buttons).into_iter().collect();
        let n = keys.len() + buttons.len();
        let mut first_err = None;
        for kc in keys {
            if let Err(e) = self.backend.key(kc, false) {
                first_err.get_or_insert(e);
            }
        }
        for b in buttons {
            if let Err(e) = self.backend.button(b, false) {
                first_err.get_or_insert(e);
            }
        }
        let _ = self.backend.flush();
        match first_err {
            Some(e) => Err(e),
            None => Ok(n),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct Rec {
        log: Vec<String>,
    }

    impl InputBackend for Rec {
        fn screen_size(&self) -> (u32, u32) {
            (1280, 720)
        }
        fn motion(&mut self, x: u32, y: u32) -> Result<(), InputError> {
            self.log.push(format!("m{x},{y}"));
            Ok(())
        }
        fn button(&mut self, b: u8, down: bool) -> Result<(), InputError> {
            self.log
                .push(format!("b{b}{}", if down { 'd' } else { 'u' }));
            Ok(())
        }
        fn keycode(&mut self, t: KeyTarget) -> Result<u8, InputError> {
            Ok((t.keysym() & 0x7f) as u8 + 8)
        }
        fn key(&mut self, kc: u8, down: bool) -> Result<(), InputError> {
            self.log
                .push(format!("k{kc}{}", if down { 'd' } else { 'u' }));
            Ok(())
        }
        fn flush(&mut self) -> Result<(), InputError> {
            Ok(())
        }
    }

    fn kd(code: &str, key: &str) -> InputEvent {
        InputEvent::KeyDown {
            code: code.into(),
            key: key.into(),
        }
    }

    #[test]
    fn pointer_maps_normalised_to_pixels() {
        let mut c = Controller::new(Rec::default());
        c.handle(&InputEvent::PointerMove { x: 0.0, y: 0.0 })
            .unwrap();
        c.handle(&InputEvent::PointerMove { x: 1.0, y: 1.0 })
            .unwrap();
        c.handle(&InputEvent::PointerMove { x: 0.5, y: 0.5 })
            .unwrap();
        assert_eq!(c.backend().log, ["m0,0", "m1279,719", "m640,360"]);
    }

    #[test]
    fn release_all_lifts_everything_held() {
        let mut c = Controller::new(Rec::default());
        c.handle(&kd("ControlLeft", "Control")).unwrap();
        c.handle(&kd("KeyC", "c")).unwrap();
        c.handle(&InputEvent::PointerDown {
            button: 1,
            x: 0.1,
            y: 0.1,
        })
        .unwrap();
        assert_eq!(c.held(), (2, 1));
        assert_eq!(c.release_all().unwrap(), 3);
        assert_eq!(c.held(), (0, 0));
        let log = &c.backend().log;
        assert!(log.iter().any(|l| l == "b1u"));
        assert_eq!(log.iter().filter(|l| l.ends_with('u')).count(), 3);
        // Nothing left to release.
        assert_eq!(c.release_all().unwrap(), 0);
    }

    #[test]
    fn repeat_reuses_keycode_and_unknown_up_is_ignored() {
        let mut c = Controller::new(Rec::default());
        c.handle(&kd("KeyA", "a")).unwrap();
        c.handle(&kd("KeyA", "a")).unwrap();
        assert_eq!(c.held(), (1, 0));
        let up = InputEvent::KeyUp {
            code: "KeyA".into(),
            key: "a".into(),
        };
        assert_eq!(c.handle(&up).unwrap(), Outcome::Applied);
        assert_eq!(c.handle(&up).unwrap(), Outcome::Ignored);
        assert_eq!(c.handle(&kd("", "Dead")).unwrap(), Outcome::Ignored);
    }

    #[test]
    fn wheel_is_button_clicks() {
        let mut c = Controller::new(Rec::default());
        c.handle(&InputEvent::Wheel { dx: 0, dy: 2 }).unwrap();
        c.handle(&InputEvent::Wheel { dx: -1, dy: -1 }).unwrap();
        assert_eq!(
            c.backend().log,
            ["b5d", "b5u", "b5d", "b5u", "b4d", "b4u", "b6d", "b6u"]
        );
    }

    #[test]
    fn passthrough_outcomes() {
        let mut c = Controller::new(Rec::default());
        assert_eq!(
            c.handle(&InputEvent::Clip { text: "x".into() }).unwrap(),
            Outcome::SetClipboard("x".into())
        );
        assert_eq!(
            c.handle(&InputEvent::ClipPull).unwrap(),
            Outcome::PullClipboard
        );
        assert_eq!(
            c.handle(&InputEvent::Resolution {
                profile: "1080p60".into()
            })
            .unwrap(),
            Outcome::ChangeProfile("1080p60".into())
        );
        assert_eq!(c.handle(&InputEvent::Heartbeat).unwrap(), Outcome::Ignored);
    }
}
