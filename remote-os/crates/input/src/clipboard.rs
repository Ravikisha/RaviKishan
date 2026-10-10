//! The remote CLIPBOARD selection, owned by a hidden window on its own
//! connection and thread.
//!
//! X has no clipboard *buffer*: whoever owns the selection must answer every
//! paste request while the paste happens. So setting the clipboard means
//! keeping a window alive that answers `SelectionRequest`s — one per session,
//! living as long as the session, not the viewer, so text sent from the
//! browser can still be pasted after the viewer disconnects.

use std::sync::mpsc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use x11rb::connection::Connection;
use x11rb::protocol::xproto::{
    self, AtomEnum, ConnectionExt as _, CreateWindowAux, EventMask, PropMode, SelectionNotifyEvent,
    WindowClass,
};
use x11rb::protocol::Event;
use x11rb::rust_connection::RustConnection;
use x11rb::wrapper::ConnectionExt as _;

use crate::InputError;

pub const MAX_CLIPBOARD_BYTES: usize = protocol::input::MAX_CLIP_TEXT_BYTES;

enum Cmd {
    Set(String),
    Get(mpsc::Sender<Result<Option<String>, String>>),
}

pub struct Clipboard {
    tx: Option<mpsc::Sender<Cmd>>,
    thread: Option<JoinHandle<()>>,
}

struct Atoms {
    clipboard: u32,
    targets: u32,
    utf8: u32,
    text: u32,
    incr: u32,
    prop: u32,
}

fn atom(c: &RustConnection, name: &[u8]) -> Result<u32, InputError> {
    Ok(c.intern_atom(false, name)
        .map_err(|e| InputError::Request(e.to_string()))?
        .reply()
        .map_err(|e| InputError::Request(e.to_string()))?
        .atom)
}

impl Clipboard {
    pub fn start(display: &str) -> Result<Clipboard, InputError> {
        let (conn, screen) =
            x11rb::connect(Some(display)).map_err(|e| InputError::Connection(e.to_string()))?;
        let root = conn.setup().roots[screen].root;
        let win = conn
            .generate_id()
            .map_err(|e| InputError::Request(e.to_string()))?;
        conn.create_window(
            x11rb::COPY_DEPTH_FROM_PARENT,
            win,
            root,
            0,
            0,
            1,
            1,
            0,
            WindowClass::INPUT_OUTPUT,
            0,
            &CreateWindowAux::new().event_mask(EventMask::PROPERTY_CHANGE),
        )
        .map_err(|e| InputError::Request(e.to_string()))?;
        let atoms = Atoms {
            clipboard: atom(&conn, b"CLIPBOARD")?,
            targets: atom(&conn, b"TARGETS")?,
            utf8: atom(&conn, b"UTF8_STRING")?,
            text: atom(&conn, b"TEXT")?,
            incr: atom(&conn, b"INCR")?,
            prop: atom(&conn, b"REMOTE_OS_CLIP")?,
        };
        conn.flush()
            .map_err(|e| InputError::Request(e.to_string()))?;
        let (tx, rx) = mpsc::channel();
        let thread = std::thread::Builder::new()
            .name("clipboard".into())
            .spawn(move || run(conn, win, atoms, rx))
            .map_err(|e| InputError::Connection(e.to_string()))?;
        Ok(Clipboard {
            tx: Some(tx),
            thread: Some(thread),
        })
    }

    pub fn set(&self, text: String) {
        if let Some(tx) = &self.tx {
            let _ = tx.send(Cmd::Set(text));
        }
    }

    /// Reads the current remote clipboard (UTF-8), waiting up to `timeout`
    /// for the owning application to answer.
    pub fn get(&self, timeout: Duration) -> Result<Option<String>, String> {
        let (rtx, rrx) = mpsc::channel();
        self.tx
            .as_ref()
            .ok_or("clipboard closed")?
            .send(Cmd::Get(rtx))
            .map_err(|_| "clipboard thread gone".to_string())?;
        rrx.recv_timeout(timeout + Duration::from_millis(200))
            .map_err(|_| "clipboard owner did not answer".to_string())?
    }
}

impl Drop for Clipboard {
    fn drop(&mut self) {
        self.tx.take();
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

struct Pending {
    reply: mpsc::Sender<Result<Option<String>, String>>,
    deadline: Instant,
}

fn run(conn: RustConnection, win: xproto::Window, a: Atoms, rx: mpsc::Receiver<Cmd>) {
    let mut owned: Option<String> = None;
    let mut pending: Option<Pending> = None;
    loop {
        match rx.recv_timeout(Duration::from_millis(15)) {
            Ok(Cmd::Set(text)) => {
                let _ = conn.set_selection_owner(win, a.clipboard, x11rb::CURRENT_TIME);
                let _ = conn.flush();
                owned = Some(text);
            }
            Ok(Cmd::Get(reply)) => {
                if let Some(t) = &owned {
                    let _ = reply.send(Ok(Some(t.clone())));
                } else {
                    let _ = conn.convert_selection(
                        win,
                        a.clipboard,
                        a.utf8,
                        a.prop,
                        x11rb::CURRENT_TIME,
                    );
                    let _ = conn.flush();
                    pending = Some(Pending {
                        reply,
                        deadline: Instant::now() + Duration::from_secs(1),
                    });
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
        }
        if let Some(p) = &pending {
            if Instant::now() > p.deadline {
                let _ = p.reply.send(Err("clipboard owner did not answer".into()));
                pending = None;
            }
        }
        loop {
            let ev = match conn.poll_for_event() {
                Ok(Some(ev)) => ev,
                Ok(None) => break,
                Err(e) => {
                    tracing::warn!(error = %e, "clipboard connection lost");
                    if let Some(p) = pending.take() {
                        let _ = p.reply.send(Err("X connection lost".into()));
                    }
                    return;
                }
            };
            match ev {
                Event::SelectionClear(e) if e.selection == a.clipboard => owned = None,
                Event::SelectionRequest(e) => serve(&conn, &a, owned.as_deref(), e),
                Event::SelectionNotify(e) if e.requestor == win => {
                    if let Some(p) = pending.take() {
                        let _ = p.reply.send(read_reply(&conn, win, &a, e.property));
                    }
                }
                _ => {}
            }
        }
    }
}

fn read_reply(
    conn: &RustConnection,
    win: xproto::Window,
    a: &Atoms,
    property: u32,
) -> Result<Option<String>, String> {
    if property == x11rb::NONE {
        return Ok(None);
    }
    let r = conn
        .get_property(
            true,
            win,
            property,
            AtomEnum::ANY,
            0,
            (MAX_CLIPBOARD_BYTES / 4 + 1) as u32,
        )
        .map_err(|e| e.to_string())?
        .reply()
        .map_err(|e| e.to_string())?;
    if r.type_ == a.incr {
        return Err("remote clipboard is larger than 64 KiB".into());
    }
    let mut bytes = r.value;
    bytes.truncate(MAX_CLIPBOARD_BYTES);
    Ok(Some(String::from_utf8_lossy(&bytes).into_owned()))
}

fn serve(conn: &RustConnection, a: &Atoms, owned: Option<&str>, e: xproto::SelectionRequestEvent) {
    // Obsolete clients send property None: use the target as the property.
    let prop = if e.property == x11rb::NONE {
        e.target
    } else {
        e.property
    };
    let mut answered = x11rb::NONE;
    if let Some(text) = owned {
        if e.target == a.targets {
            let list = [a.targets, a.utf8, u32::from(AtomEnum::STRING), a.text];
            if conn
                .change_property32(PropMode::REPLACE, e.requestor, prop, AtomEnum::ATOM, &list)
                .is_ok()
            {
                answered = prop;
            }
        } else if e.target == a.utf8
            || e.target == a.text
            || e.target == u32::from(AtomEnum::STRING)
        {
            let ty = if e.target == u32::from(AtomEnum::STRING) {
                u32::from(AtomEnum::STRING)
            } else {
                a.utf8
            };
            if conn
                .change_property8(PropMode::REPLACE, e.requestor, prop, ty, text.as_bytes())
                .is_ok()
            {
                answered = prop;
            }
        }
    }
    let ev = SelectionNotifyEvent {
        response_type: xproto::SELECTION_NOTIFY_EVENT,
        sequence: 0,
        time: e.time,
        requestor: e.requestor,
        selection: e.selection,
        target: e.target,
        property: answered,
    };
    let _ = conn.send_event(false, e.requestor, EventMask::NO_EVENT, ev);
    let _ = conn.flush();
}
