//! The input worker: one thread per media session holding the XTest
//! connection. The DataChannel callback validates a frame on the GStreamer
//! thread that received it and hands it over through a BOUNDED channel; a
//! full channel drops the frame (counted) rather than queueing latency.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use input::clipboard::Clipboard;
use input::x11::X11Input;
use input::{Controller, Outcome};
use media::StatusSender;
use protocol::input::{InputGate, InputMsg, HEARTBEAT_TIMEOUT_MS};
use protocol::status::{ClipMsg, ErrorMsg};
use tokio::sync::mpsc::UnboundedSender;

use crate::state::{lock, Runtime};

pub const QUEUE_DEPTH: usize = 256;

pub enum WorkerMsg {
    Input(InputMsg),
    /// The input channel closed: release everything.
    Closed,
}

pub struct InputWorker {
    tx: SyncSender<WorkerMsg>,
    gate: Arc<Mutex<InputGate>>,
    handle: Option<JoinHandle<()>>,
}

fn clipboard_for(rt: &Runtime, display: &str) -> Option<Arc<Clipboard>> {
    let mut g = lock(&rt.clipboard);
    if g.is_none() {
        match Clipboard::start(display) {
            Ok(c) => *g = Some(Arc::new(c)),
            Err(e) => tracing::warn!(error = %e, "clipboard owner could not start"),
        }
    }
    g.clone()
}

impl InputWorker {
    pub fn spawn(
        disp: String,
        rt: Arc<Runtime>,
        status: StatusSender,
        profile_requests: UnboundedSender<String>,
    ) -> InputWorker {
        let (tx, rx) = mpsc::sync_channel::<WorkerMsg>(QUEUE_DEPTH);
        let handle = std::thread::Builder::new()
            .name("input".into())
            .spawn(move || {
                let mut ctl = match X11Input::connect(&disp) {
                    Ok(b) => Some(Controller::new(b)),
                    Err(e) => {
                        tracing::error!(display = %disp, error = %e, "XTest connection failed; input disabled");
                        None
                    }
                };
                let mut last_seen = Instant::now();
                let hb = Duration::from_millis(HEARTBEAT_TIMEOUT_MS);
                let mut released_for_silence = false;
                loop {
                    let msg = match rx.recv_timeout(Duration::from_millis(500)) {
                        Ok(m) => m,
                        Err(RecvTimeoutError::Timeout) => {
                            if !released_for_silence && last_seen.elapsed() > hb {
                                if let Some(c) = ctl.as_mut() {
                                    match c.release_all() {
                                        Ok(n) if n > 0 => tracing::info!(released = n, "heartbeat lost: released held input"),
                                        Ok(_) => {}
                                        Err(e) => tracing::warn!(error = %e, "release after heartbeat loss"),
                                    }
                                }
                                released_for_silence = true;
                            }
                            continue;
                        }
                        Err(RecvTimeoutError::Disconnected) => WorkerMsg::Closed,
                    };
                    let m = match msg {
                        WorkerMsg::Closed => {
                            if let Some(c) = ctl.as_mut() {
                                match c.release_all() {
                                    Ok(n) => tracing::info!(released = n, "input closed: released held input"),
                                    Err(e) => tracing::warn!(error = %e, "release on close"),
                                }
                            }
                            return;
                        }
                        WorkerMsg::Input(m) => m,
                    };
                    last_seen = Instant::now();
                    released_for_silence = false;
                    let Some(c) = ctl.as_mut() else { continue };
                    match c.handle(&m.event) {
                        Ok(Outcome::SetClipboard(text)) => {
                            if let Some(cb) = clipboard_for(&rt, &disp) {
                                cb.set(text);
                            }
                        }
                        Ok(Outcome::PullClipboard) => {
                            let reply = match clipboard_for(&rt, &disp) {
                                Some(cb) => match cb.get(Duration::from_secs(1)) {
                                    Ok(t) => serde_json::to_string(&ClipMsg::new(t.unwrap_or_default())),
                                    Err(e) => serde_json::to_string(&ErrorMsg::new("clip/unavailable", e)),
                                },
                                None => serde_json::to_string(&ErrorMsg::new("clip/unavailable", "no clipboard owner")),
                            };
                            if let Ok(t) = reply {
                                status.send(&t);
                            }
                        }
                        Ok(Outcome::ChangeProfile(p)) => {
                            let _ = profile_requests.send(p);
                        }
                        Ok(_) => {}
                        Err(e) => tracing::warn!(error = %e, "input event failed"),
                    }
                }
            })
            .expect("spawn input thread");
        InputWorker {
            tx,
            gate: Arc::new(Mutex::new(InputGate::new(Instant::now()))),
            handle: Some(handle),
        }
    }

    /// The function the DataChannel callback calls, on a GStreamer thread.
    /// `may_drive` is false while the connection's sign-in is older than 30
    /// minutes: frames are then refused (the viewer gates this too; this is
    /// the server half, so the gate is not client-only).
    pub fn sink(
        &self,
        on_reject: Arc<dyn Fn() + Send + Sync>,
        may_drive: Arc<AtomicBool>,
    ) -> media::InputSink {
        let tx = self.tx.clone();
        let gate = self.gate.clone();
        Arc::new(move |frame| {
            if !may_drive.load(Ordering::Relaxed) {
                on_reject();
                return;
            }
            let now = Instant::now();
            let res = match frame {
                media::InputFrame::Text(t) => lock(&gate).admit_text(t, now),
                media::InputFrame::Binary(_) => Err(lock(&gate).reject_binary(now)),
            };
            match res {
                Ok(msg) => match tx.try_send(WorkerMsg::Input(msg)) {
                    Ok(()) => {}
                    Err(TrySendError::Full(_)) => {
                        on_reject();
                        tracing::debug!("input queue full; frame dropped");
                    }
                    Err(TrySendError::Disconnected(_)) => {}
                },
                Err(e) => {
                    on_reject();
                    tracing::debug!(code = e.code(), "input frame rejected");
                }
            }
        })
    }

    pub fn close(&self) {
        let _ = self.tx.try_send(WorkerMsg::Closed);
    }
}

impl Drop for InputWorker {
    fn drop(&mut self) {
        // A blocking send: Closed must arrive even if the queue was full, or
        // a held key could outlive the viewer.
        let _ = self.tx.send(WorkerMsg::Closed);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}
