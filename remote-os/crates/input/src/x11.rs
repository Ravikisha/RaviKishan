//! XTest input over one long-lived x11rb connection per viewer. Each event is
//! one `FakeInput` request on an open socket — the MJPEG view spawned an
//! `xdotool` process per action.

use std::collections::HashMap;

use x11rb::connection::Connection;
use x11rb::protocol::xproto::{self, ConnectionExt as _};
use x11rb::protocol::xtest::ConnectionExt as _;
use x11rb::rust_connection::RustConnection;

use crate::keymap::KeyTarget;
use crate::{InputBackend, InputError};

const KEY_PRESS: u8 = 2;
const KEY_RELEASE: u8 = 3;
const BUTTON_PRESS: u8 = 4;
const BUTTON_RELEASE: u8 = 5;
const MOTION_NOTIFY: u8 = 6;

fn req<E: std::fmt::Display>(e: E) -> InputError {
    InputError::Request(e.to_string())
}

pub struct X11Input {
    conn: RustConnection,
    root: xproto::Window,
    width: u32,
    height: u32,
    min_kc: u8,
    per: usize,
    /// keysyms[(kc - min_kc) * per + col]
    syms: Vec<u32>,
    /// Keycodes with no symbols at all, usable as scratch for characters the
    /// keymap cannot type unshifted.
    scratch: Vec<u8>,
    scratch_next: usize,
    scratch_assigned: HashMap<u32, u8>,
}

impl X11Input {
    /// Connects to `display` (auth from `$XAUTHORITY`).
    pub fn connect(display: &str) -> Result<X11Input, InputError> {
        let (conn, screen) =
            x11rb::connect(Some(display)).map_err(|e| InputError::Connection(e.to_string()))?;
        let s = &conn.setup().roots[screen];
        let (root, width, height) = (s.root, s.width_in_pixels as u32, s.height_in_pixels as u32);
        conn.xtest_get_version(2, 2)
            .map_err(req)?
            .reply()
            .map_err(|_| InputError::NoXTest)?;
        let mut me = X11Input {
            root,
            width,
            height,
            min_kc: conn.setup().min_keycode,
            per: 0,
            syms: Vec::new(),
            scratch: Vec::new(),
            scratch_next: 0,
            scratch_assigned: HashMap::new(),
            conn,
        };
        me.load_mapping()?;
        Ok(me)
    }

    fn load_mapping(&mut self) -> Result<(), InputError> {
        let setup = self.conn.setup();
        let (min, max) = (setup.min_keycode, setup.max_keycode);
        let r = self
            .conn
            .get_keyboard_mapping(min, max - min + 1)
            .map_err(req)?
            .reply()
            .map_err(req)?;
        self.min_kc = min;
        self.per = r.keysyms_per_keycode as usize;
        self.syms = r.keysyms;
        self.scratch = (min..=max)
            .filter(|kc| {
                let i = (*kc - min) as usize * self.per;
                self.syms[i..i + self.per].iter().all(|s| *s == 0)
            })
            .rev()
            .take(8)
            .collect();
        Ok(())
    }

    fn find(&self, keysym: u32, any_column: bool) -> Option<u8> {
        if self.per == 0 {
            return None;
        }
        // Column 0 first: the unshifted symbol of a key is the best match.
        let cols: &[usize] = if any_column { &[0, 1, 2, 3] } else { &[0] };
        for &col in cols {
            if col >= self.per {
                continue;
            }
            for (i, chunk) in self.syms.chunks(self.per).enumerate() {
                if chunk[col] == keysym {
                    return Some(self.min_kc + i as u8);
                }
            }
        }
        None
    }

    fn assign_scratch(&mut self, keysym: u32) -> Result<u8, InputError> {
        if let Some(kc) = self.scratch_assigned.get(&keysym) {
            return Ok(*kc);
        }
        if self.scratch.is_empty() {
            return Err(InputError::NoKeycode(keysym));
        }
        let kc = self.scratch[self.scratch_next % self.scratch.len()];
        self.scratch_next += 1;
        self.scratch_assigned.retain(|_, v| *v != kc);
        let mut row = vec![0u32; self.per.max(2)];
        row[0] = keysym;
        row[1] = keysym;
        self.conn
            .change_keyboard_mapping(1, kc, row.len() as u8, &row)
            .map_err(req)?
            .check()
            .map_err(req)?;
        self.scratch_assigned.insert(keysym, kc);
        Ok(kc)
    }
}

impl InputBackend for X11Input {
    fn screen_size(&self) -> (u32, u32) {
        (self.width, self.height)
    }

    fn motion(&mut self, x: u32, y: u32) -> Result<(), InputError> {
        let x = x.min(self.width.saturating_sub(1)) as i16;
        let y = y.min(self.height.saturating_sub(1)) as i16;
        self.conn
            .xtest_fake_input(MOTION_NOTIFY, 0, 0, self.root, x, y, 0)
            .map_err(req)?;
        Ok(())
    }

    fn button(&mut self, button: u8, down: bool) -> Result<(), InputError> {
        let t = if down { BUTTON_PRESS } else { BUTTON_RELEASE };
        self.conn
            .xtest_fake_input(t, button, 0, x11rb::NONE, 0, 0, 0)
            .map_err(req)?;
        Ok(())
    }

    fn keycode(&mut self, target: KeyTarget) -> Result<u8, InputError> {
        match target {
            KeyTarget::Physical(ks) => self
                .find(ks, true)
                .map(Ok)
                .unwrap_or_else(|| self.assign_scratch(ks)),
            KeyTarget::Character(ks) => self
                .find(ks, false)
                .map(Ok)
                .unwrap_or_else(|| self.assign_scratch(ks)),
        }
    }

    fn key(&mut self, keycode: u8, down: bool) -> Result<(), InputError> {
        let t = if down { KEY_PRESS } else { KEY_RELEASE };
        self.conn
            .xtest_fake_input(t, keycode, 0, x11rb::NONE, 0, 0, 0)
            .map_err(req)?;
        Ok(())
    }

    fn flush(&mut self) -> Result<(), InputError> {
        self.conn.flush().map_err(req)
    }
}
