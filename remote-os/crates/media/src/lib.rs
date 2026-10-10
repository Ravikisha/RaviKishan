//! One viewer's media path.
//!
//! ```text
//! ximagesrc :2N ! video/x-raw,framerate=F/1 ! videoconvert ! I420
//!   ! queue leaky=downstream max-size-buffers=2
//!   ! x264enc tune=zerolatency speed-preset=ultrafast bframes=0
//!             key-int-max=4F pass=qual quantizer=23 bitrate=<cap> qpmin=20
//!   ! video/x-h264,profile=constrained-baseline,level=<pinned>
//!   ! h264parse ! rtph264pay config-interval=-1 aggregate-mode=zero-latency
//!   ! application/x-rtp,...,payload=96 ! webrtcbin bundle-policy=max-bundle
//! ```
//!
//! The only queue is the leaky two-buffer one in front of the encoder: if x264
//! falls behind, frames are dropped there (and counted) instead of piling up
//! latency. Keyframes come every 4 s and on PLI/FIR (rtpsession turns those
//! into an upstream force-key-unit event; a probe rate-limits them to one per
//! 300 ms so a lossy link cannot make every frame an I-frame).

pub mod abr;

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use capture::CaptureBackend;
use gst::prelude::*;
use protocol::status::StatsMsg;
use protocol::Profile;

pub use abr::Abr;

#[derive(Debug, thiserror::Error)]
pub enum MediaError {
    #[error("GStreamer: {0}")]
    Gst(String),
    #[error("capture: {0}")]
    Capture(#[from] capture::CaptureError),
    #[error("SDP: {0}")]
    Sdp(String),
}

fn gerr<E: std::fmt::Display>(e: E) -> MediaError {
    MediaError::Gst(e.to_string())
}

/// What the pipeline tells its owner. Never contains credentials; SDP and
/// candidates are passed through to the signalling socket and must not be
/// logged by the receiver.
#[derive(Debug, Clone)]
pub enum MediaEvent {
    Offer(String),
    Ice { candidate: String, mline: u32 },
    InputOpen,
    InputClosed,
    IceState(String),
    PeerState(String),
    Error(String),
}

/// A frame from the `input` channel, handed over on the GStreamer thread that
/// received it (so the caller can validate and queue it without a hop).
pub enum InputFrame<'a> {
    Text(&'a str),
    Binary(usize),
}

pub type EventSink = Arc<dyn Fn(MediaEvent) + Send + Sync>;
pub type InputSink = Arc<dyn Fn(InputFrame<'_>) + Send + Sync>;

#[derive(Debug, Clone)]
pub struct MediaConfig {
    pub profile: Profile,
    /// `turn(s)://user:pass@host:port` for webrtcbin's own allocation, or
    /// None to rely on host candidates (coturn relays to this host).
    pub turn_server: Option<String>,
    /// x264 VBV buffer in ms of the cap. It bounds the largest frame (a
    /// keyframe), which matters because a keyframe is a burst of packets that
    /// coturn must push down one TCP connection.
    pub vbv_ms: u32,
}

#[derive(Default)]
struct Counters {
    captured: AtomicU64,
    enc_in: AtomicU64,
    encoded: AtomicU64,
    bytes: AtomicU64,
    enc_ns: AtomicU64,
    enc_samples: AtomicU64,
    keyframes: AtomicU64,
    kf_suppressed: AtomicU64,
    rejected: AtomicU64,
}

/// Cloneable handle for sending on the `status` channel.
#[derive(Clone)]
pub struct StatusSender {
    dc: Arc<Mutex<Option<gst_webrtc::WebRTCDataChannel>>>,
}

impl StatusSender {
    pub fn send(&self, text: &str) -> bool {
        let g = self.dc.lock().unwrap_or_else(|p| p.into_inner());
        match g.as_ref() {
            Some(dc)
                if dc.property::<gst_webrtc::WebRTCDataChannelState>("ready-state")
                    == gst_webrtc::WebRTCDataChannelState::Open =>
            {
                dc.send_string(Some(text));
                true
            }
            _ => false,
        }
    }
}

pub struct MediaSession {
    pipeline: gst::Pipeline,
    webrtc: gst::Element,
    enc: gst::Element,
    input_dc: gst_webrtc::WebRTCDataChannel,
    status: StatusSender,
    counters: Arc<Counters>,
    snapshot: Arc<Mutex<StatsMsg>>,
    stop: Arc<AtomicBool>,
    threads: Vec<JoinHandle<()>>,
    profile: Profile,
}

/// Initialises GStreamer once and checks every element the pipeline needs, so
/// a missing plugin (GST_PLUGIN_PATH not set in the unit) fails at startup
/// rather than at the first viewer.
pub fn init() -> Result<String, MediaError> {
    gst::init().map_err(gerr)?;
    let need = [
        "ximagesrc",
        "videoconvert",
        "queue",
        "x264enc",
        "h264parse",
        "rtph264pay",
        "webrtcbin",
        "nicesrc",
        "dtlssrtpenc",
        "sctpenc",
    ];
    let missing: Vec<&str> = need
        .iter()
        .copied()
        .filter(|n| gst::ElementFactory::find(n).is_none())
        .collect();
    if !missing.is_empty() {
        return Err(MediaError::Gst(format!(
            "missing GStreamer elements: {} (is GST_PLUGIN_PATH=/usr/local/lib64/gstreamer-1.0 set?)",
            missing.join(", ")
        )));
    }
    Ok(gst::version_string().to_string())
}

fn make(factory: &str, name: &str) -> Result<gst::Element, MediaError> {
    gst::ElementFactory::make(factory)
        .name(name)
        .build()
        .map_err(|e| MediaError::Gst(format!("{factory}: {e}")))
}

fn capsfilter(name: &str, caps: gst::Caps) -> Result<gst::Element, MediaError> {
    gst::ElementFactory::make("capsfilter")
        .name(name)
        .property("caps", caps)
        .build()
        .map_err(gerr)
}

impl MediaSession {
    pub fn start(
        capture: &dyn CaptureBackend,
        cfg: MediaConfig,
        on_event: EventSink,
        on_input: InputSink,
    ) -> Result<MediaSession, MediaError> {
        let p = cfg.profile;
        let pipeline = gst::Pipeline::with_name("remote-os");
        let src = capture.make_source()?;
        let rate = capsfilter(
            "rate",
            gst::Caps::builder("video/x-raw")
                .field("framerate", gst::Fraction::new(p.fps() as i32, 1))
                .build(),
        )?;
        let conv = make("videoconvert", "conv")?;
        conv.set_property("n-threads", p.videoconvert_threads());
        let i420 = capsfilter(
            "i420",
            gst::Caps::builder("video/x-raw")
                .field("format", "I420")
                .build(),
        )?;
        let queue = make("queue", "q")?;
        queue.set_property_from_str("leaky", "downstream");
        queue.set_property("max-size-buffers", 2u32);
        queue.set_property("max-size-bytes", 0u32);
        queue.set_property("max-size-time", 0u64);
        let enc = make("x264enc", "enc")?;
        enc.set_property_from_str("tune", "zerolatency");
        enc.set_property_from_str("speed-preset", "ultrafast");
        enc.set_property("bframes", 0u32);
        enc.set_property("key-int-max", p.key_int_max());
        enc.set_property_from_str("pass", "qual");
        enc.set_property("quantizer", 23u32);
        enc.set_property("bitrate", p.bitrate_cap_kbps());
        // Bound the largest frame to ~90 KB whatever the profile: a keyframe is
        // one burst that coturn pushes down a single TCP connection, and at
        // 1080p60 a 150 ms buffer (131 KB) measurably lost packets.
        let vbv_ms = cfg
            .vbv_ms
            .min(720_000 / p.bitrate_cap_kbps())
            .clamp(50, 2000);
        enc.set_property("vbv-buf-capacity", vbv_ms);
        enc.set_property("option-string", "qpmin=20");
        let h264caps = capsfilter(
            "h264caps",
            gst::Caps::builder("video/x-h264")
                .field("profile", "constrained-baseline")
                .field("level", p.h264_level())
                .build(),
        )?;
        let parse = make("h264parse", "parse")?;
        let pay = make("rtph264pay", "pay")?;
        pay.set_property("config-interval", -1i32);
        pay.set_property_from_str("aggregate-mode", "zero-latency");
        let rtpcaps = capsfilter(
            "rtpcaps",
            gst::Caps::builder("application/x-rtp")
                .field("media", "video")
                .field("encoding-name", "H264")
                .field("payload", 96i32)
                .field("clock-rate", 90000i32)
                .build(),
        )?;
        let webrtc = make("webrtcbin", "webrtc")?;
        webrtc.set_property_from_str("bundle-policy", "max-bundle");
        if let Some(t) = &cfg.turn_server {
            webrtc.set_property("turn-server", t);
        }
        let chain = [
            &src, &rate, &conv, &i420, &queue, &enc, &h264caps, &parse, &pay, &rtpcaps, &webrtc,
        ];
        pipeline.add_many(chain).map_err(gerr)?;
        gst::Element::link_many(chain).map_err(gerr)?;

        // The only m-line is ours to send.
        if let Some(t) = webrtc
            .emit_by_name::<Option<gst_webrtc::WebRTCRTPTransceiver>>("get-transceiver", &[&0i32])
        {
            t.set_property(
                "direction",
                gst_webrtc::WebRTCRTPTransceiverDirection::Sendonly,
            );
            // RTX: answer the receiver's NACKs with retransmissions, so a
            // packet coturn dropped on a congested TCP leg is repaired in one
            // RTT instead of costing a PLI and a frozen picture until the next
            // keyframe.
            t.set_property("do-nack", true);
        }

        let counters = Arc::new(Counters::default());
        let enc_times: Arc<Mutex<VecDeque<Instant>>> = Arc::new(Mutex::new(VecDeque::new()));
        install_probes(&src, &enc, &counters, &enc_times)?;

        // Signals: negotiation, candidates, states.
        {
            let ev = on_event.clone();
            webrtc.connect("on-negotiation-needed", false, move |values| {
                let w = match values[0].get::<gst::Element>() {
                    Ok(w) => w,
                    Err(_) => return None,
                };
                let ev = ev.clone();
                let w2 = w.clone();
                let promise = gst::Promise::with_change_func(move |reply| {
                    let offer = match reply {
                        Ok(Some(s)) => s.get::<gst_webrtc::WebRTCSessionDescription>("offer"),
                        _ => {
                            ev(MediaEvent::Error("create-offer failed".into()));
                            return;
                        }
                    };
                    match offer {
                        Ok(offer) => {
                            w2.emit_by_name::<()>(
                                "set-local-description",
                                &[&offer, &None::<gst::Promise>],
                            );
                            match offer.sdp().as_text() {
                                Ok(sdp) => ev(MediaEvent::Offer(sdp.to_string())),
                                Err(e) => ev(MediaEvent::Error(format!("offer SDP: {e}"))),
                            }
                        }
                        Err(e) => ev(MediaEvent::Error(format!("offer: {e}"))),
                    }
                });
                w.emit_by_name::<()>("create-offer", &[&None::<gst::Structure>, &promise]);
                None
            });
        }
        {
            let ev = on_event.clone();
            webrtc.connect("on-ice-candidate", false, move |values| {
                let mline = values[1].get::<u32>().unwrap_or(0);
                if let Ok(candidate) = values[2].get::<String>() {
                    ev(MediaEvent::Ice { candidate, mline });
                }
                None
            });
        }
        {
            let ev = on_event.clone();
            webrtc.connect_notify(Some("ice-connection-state"), move |w, _| {
                let s = w.property::<gst_webrtc::WebRTCICEConnectionState>("ice-connection-state");
                ev(MediaEvent::IceState(format!("{s:?}").to_lowercase()));
            });
        }
        {
            let ev = on_event.clone();
            webrtc.connect_notify(Some("connection-state"), move |w, _| {
                let s = w.property::<gst_webrtc::WebRTCPeerConnectionState>("connection-state");
                ev(MediaEvent::PeerState(format!("{s:?}").to_lowercase()));
            });
        }

        // Data channels must exist before the offer, and webrtcbin needs to
        // be at least READY to create them.
        pipeline.set_state(gst::State::Ready).map_err(gerr)?;
        let input_dc = webrtc
            .emit_by_name::<Option<gst_webrtc::WebRTCDataChannel>>(
                "create-data-channel",
                &[
                    &"input",
                    &Some(
                        gst::Structure::builder("config")
                            .field("ordered", true)
                            .build(),
                    ),
                ],
            )
            .ok_or_else(|| MediaError::Gst("could not create the input data channel".into()))?;
        let status_dc = webrtc
            .emit_by_name::<Option<gst_webrtc::WebRTCDataChannel>>(
                "create-data-channel",
                &[
                    &"status",
                    &Some(
                        gst::Structure::builder("config")
                            .field("ordered", false)
                            .field("max-retransmits", 0i32)
                            .build(),
                    ),
                ],
            )
            .ok_or_else(|| MediaError::Gst("could not create the status data channel".into()))?;
        {
            let inp = on_input.clone();
            input_dc.connect_on_message_string(move |_dc, msg| {
                if let Some(m) = msg {
                    inp(InputFrame::Text(m));
                }
            });
            let inp = on_input.clone();
            input_dc.connect_on_message_data(move |_dc, data| {
                inp(InputFrame::Binary(data.map(|d| d.len()).unwrap_or(0)));
            });
            let ev = on_event.clone();
            input_dc.connect_on_open(move |_| ev(MediaEvent::InputOpen));
            let ev = on_event.clone();
            input_dc.connect_on_close(move |_| ev(MediaEvent::InputClosed));
        }
        let status = StatusSender {
            dc: Arc::new(Mutex::new(Some(status_dc))),
        };

        pipeline.set_state(gst::State::Playing).map_err(gerr)?;

        let stop = Arc::new(AtomicBool::new(false));
        let snapshot = Arc::new(Mutex::new(StatsMsg {
            t: "stats".into(),
            width: p.width(),
            height: p.height(),
            bitrate_cap_kbps: p.bitrate_cap_kbps(),
            profile: p.id().into(),
            ..Default::default()
        }));
        let threads = vec![
            spawn_bus_watch(&pipeline, stop.clone(), on_event.clone())?,
            spawn_stats(StatsCtx {
                webrtc: webrtc.clone(),
                enc: enc.clone(),
                queue,
                counters: counters.clone(),
                snapshot: snapshot.clone(),
                status: status.clone(),
                stop: stop.clone(),
                profile: p,
            })?,
        ];

        Ok(MediaSession {
            pipeline,
            webrtc,
            enc,
            input_dc,
            status,
            counters,
            snapshot,
            stop,
            threads,
            profile: p,
        })
    }

    pub fn profile(&self) -> Profile {
        self.profile
    }

    pub fn set_answer(&self, sdp: &str) -> Result<(), MediaError> {
        let msg = gst_sdp::SDPMessage::parse_buffer(sdp.as_bytes())
            .map_err(|e| MediaError::Sdp(e.to_string()))?;
        let answer =
            gst_webrtc::WebRTCSessionDescription::new(gst_webrtc::WebRTCSDPType::Answer, msg);
        self.webrtc
            .emit_by_name::<()>("set-remote-description", &[&answer, &None::<gst::Promise>]);
        Ok(())
    }

    pub fn add_ice(&self, mline: u32, candidate: &str) {
        if candidate.is_empty() {
            return; // end-of-candidates
        }
        self.webrtc
            .emit_by_name::<()>("add-ice-candidate", &[&mline, &candidate]);
    }

    pub fn status_sender(&self) -> StatusSender {
        self.status.clone()
    }

    pub fn note_rejected(&self) {
        self.counters.rejected.fetch_add(1, Ordering::Relaxed);
    }

    pub fn rejected_counter(&self) -> Arc<dyn Fn() + Send + Sync> {
        let c = self.counters.clone();
        Arc::new(move || {
            c.rejected.fetch_add(1, Ordering::Relaxed);
        })
    }

    pub fn snapshot(&self) -> StatsMsg {
        self.snapshot
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }

    pub fn request_keyframe(&self) {
        if let Some(pad) = self.enc.static_pad("src") {
            let ev = gst_video::UpstreamForceKeyUnitEvent::builder()
                .all_headers(true)
                .build();
            pad.send_event(ev);
        }
    }

    pub fn stop(mut self) {
        self.shutdown();
    }

    fn shutdown(&mut self) {
        if self.stop.swap(true, Ordering::SeqCst) {
            return;
        }
        self.status
            .dc
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .take();
        self.input_dc.close();
        let _ = self.pipeline.set_state(gst::State::Null);
        for t in self.threads.drain(..) {
            let _ = t.join();
        }
    }
}

impl Drop for MediaSession {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn install_probes(
    src: &gst::Element,
    enc: &gst::Element,
    counters: &Arc<Counters>,
    enc_times: &Arc<Mutex<VecDeque<Instant>>>,
) -> Result<(), MediaError> {
    let pad = |e: &gst::Element, n: &str| {
        e.static_pad(n)
            .ok_or_else(|| MediaError::Gst(format!("{} has no {n} pad", e.name())))
    };
    let c = counters.clone();
    pad(src, "src")?.add_probe(gst::PadProbeType::BUFFER, move |_, _| {
        c.captured.fetch_add(1, Ordering::Relaxed);
        gst::PadProbeReturn::Ok
    });
    let c = counters.clone();
    let t = enc_times.clone();
    pad(enc, "sink")?.add_probe(gst::PadProbeType::BUFFER, move |_, _| {
        c.enc_in.fetch_add(1, Ordering::Relaxed);
        let mut q = t.lock().unwrap_or_else(|p| p.into_inner());
        q.push_back(Instant::now());
        while q.len() > 64 {
            q.pop_front();
        }
        gst::PadProbeReturn::Ok
    });
    let c = counters.clone();
    let t = enc_times.clone();
    let enc_src = pad(enc, "src")?;
    enc_src.add_probe(gst::PadProbeType::BUFFER, move |_, info| {
        if let Some(gst::PadProbeData::Buffer(b)) = &info.data {
            c.bytes.fetch_add(b.size() as u64, Ordering::Relaxed);
        }
        c.encoded.fetch_add(1, Ordering::Relaxed);
        // x264 zerolatency without B-frames is one frame in, one frame out,
        // in order, so FIFO pairing gives per-frame encode time (PTS cannot
        // be used: x264enc rebases it).
        if let Some(t0) = t.lock().unwrap_or_else(|p| p.into_inner()).pop_front() {
            c.enc_ns
                .fetch_add(t0.elapsed().as_nanos() as u64, Ordering::Relaxed);
            c.enc_samples.fetch_add(1, Ordering::Relaxed);
        }
        gst::PadProbeReturn::Ok
    });
    // PLI/FIR → GstForceKeyUnit arrives here going upstream. Count it, and
    // let at most one through per 300 ms.
    let c = counters.clone();
    let last: Arc<Mutex<Option<Instant>>> = Arc::new(Mutex::new(None));
    enc_src.add_probe(gst::PadProbeType::EVENT_UPSTREAM, move |_, info| {
        if let Some(gst::PadProbeData::Event(ev)) = &info.data {
            let is_fku = ev
                .structure()
                .map(|s| s.name() == "GstForceKeyUnit")
                .unwrap_or(false);
            if is_fku {
                let mut l = last.lock().unwrap_or_else(|p| p.into_inner());
                if l.map(|t| t.elapsed() < Duration::from_millis(300))
                    .unwrap_or(false)
                {
                    c.kf_suppressed.fetch_add(1, Ordering::Relaxed);
                    return gst::PadProbeReturn::Drop;
                }
                *l = Some(Instant::now());
                c.keyframes.fetch_add(1, Ordering::Relaxed);
            }
        }
        gst::PadProbeReturn::Ok
    });
    Ok(())
}

fn spawn_bus_watch(
    pipeline: &gst::Pipeline,
    stop: Arc<AtomicBool>,
    on_event: EventSink,
) -> Result<JoinHandle<()>, MediaError> {
    let bus = pipeline
        .bus()
        .ok_or_else(|| MediaError::Gst("pipeline has no bus".into()))?;
    std::thread::Builder::new()
        .name("media-bus".into())
        .spawn(move || {
            while !stop.load(Ordering::SeqCst) {
                let Some(msg) = bus.timed_pop_filtered(
                    gst::ClockTime::from_mseconds(200),
                    &[gst::MessageType::Error, gst::MessageType::Warning],
                ) else {
                    continue;
                };
                match msg.view() {
                    gst::MessageView::Error(e) => {
                        let src = msg.src().map(|s| s.name().to_string()).unwrap_or_default();
                        tracing::error!(element = %src, error = %e.error(), "pipeline error");
                        on_event(MediaEvent::Error(format!("{src}: {}", e.error())));
                    }
                    gst::MessageView::Warning(w) => {
                        let src = msg.src().map(|s| s.name().to_string()).unwrap_or_default();
                        tracing::warn!(element = %src, warning = %w.error(), "pipeline warning");
                    }
                    _ => {}
                }
            }
        })
        .map_err(gerr)
}

struct StatsCtx {
    webrtc: gst::Element,
    enc: gst::Element,
    queue: gst::Element,
    counters: Arc<Counters>,
    snapshot: Arc<Mutex<StatsMsg>>,
    status: StatusSender,
    stop: Arc<AtomicBool>,
    profile: Profile,
}

/// Receiver-side numbers from webrtcbin's stats: (loss fraction, RTT ms).
fn remote_inbound(webrtc: &gst::Element) -> (Option<f64>, Option<f64>) {
    let (tx, rx) = mpsc::channel();
    let promise = gst::Promise::with_change_func(move |reply| {
        let mut out = (None, None);
        if let Ok(Some(s)) = reply {
            for (_, v) in s.iter() {
                let Ok(sub) = v.get::<gst::Structure>() else {
                    continue;
                };
                let is_rin = sub
                    .get::<gst_webrtc::WebRTCStatsType>("type")
                    .map(|t| t == gst_webrtc::WebRTCStatsType::RemoteInboundRtp)
                    .unwrap_or(false);
                if is_rin {
                    out.0 = sub.get::<f64>("fraction-lost").ok();
                    out.1 = sub.get::<f64>("round-trip-time").ok().map(|s| s * 1000.0);
                }
            }
        }
        let _ = tx.send(out);
    });
    webrtc.emit_by_name::<()>("get-stats", &[&None::<gst::Pad>, &promise]);
    rx.recv_timeout(Duration::from_millis(500))
        .unwrap_or((None, None))
}

fn spawn_stats(ctx: StatsCtx) -> Result<JoinHandle<()>, MediaError> {
    std::thread::Builder::new()
        .name("media-stats".into())
        .spawn(move || {
            let p = ctx.profile;
            let mut abr = Abr::new(p.bitrate_floor_kbps(), p.bitrate_cap_kbps());
            let c = &ctx.counters;
            let mut last = (0u64, 0u64, 0u64, 0u64, Instant::now());
            while !ctx.stop.load(Ordering::SeqCst) {
                // Sleep in short steps so stop() is prompt.
                for _ in 0..10 {
                    if ctx.stop.load(Ordering::SeqCst) {
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                let enc = c.encoded.load(Ordering::Relaxed);
                let bytes = c.bytes.load(Ordering::Relaxed);
                let ens = c.enc_ns.load(Ordering::Relaxed);
                let esm = c.enc_samples.load(Ordering::Relaxed);
                let dt = last.4.elapsed().as_secs_f64().max(0.001);
                let fps = (enc - last.0) as f64 / dt;
                let bitrate = ((bytes - last.1) as f64 * 8.0 / dt) as u64;
                let encode_ms = if esm > last.3 {
                    (ens - last.2) as f64 / (esm - last.3) as f64 / 1e6
                } else {
                    0.0
                };
                last = (enc, bytes, ens, esm, Instant::now());
                let captured = c.captured.load(Ordering::Relaxed);
                let enc_in = c.enc_in.load(Ordering::Relaxed);
                let level = ctx.queue.property::<u32>("current-level-buffers") as u64;
                let dropped = captured.saturating_sub(enc_in).saturating_sub(level);
                let (loss, rtt) = remote_inbound(&ctx.webrtc);
                if let Some(cap) = abr.observe(loss, rtt) {
                    ctx.enc.set_property("bitrate", cap);
                    tracing::info!(cap_kbps = cap, loss = ?loss, rtt_ms = ?rtt, "adaptive bitrate");
                }
                let msg = StatsMsg {
                    t: "stats".into(),
                    fps: (fps * 10.0).round() / 10.0,
                    bitrate,
                    encode_ms: (encode_ms * 100.0).round() / 100.0,
                    width: p.width(),
                    height: p.height(),
                    captured,
                    encoded: enc,
                    dropped,
                    bitrate_cap_kbps: abr.cap(),
                    keyframes: c.keyframes.load(Ordering::Relaxed),
                    rejected: c.rejected.load(Ordering::Relaxed),
                    rtt_ms: rtt.map(|r| (r * 10.0).round() / 10.0),
                    loss,
                    profile: p.id().into(),
                };
                if let Ok(text) = serde_json::to_string(&msg) {
                    ctx.status.send(&text);
                }
                *ctx.snapshot.lock().unwrap_or_else(|p| p.into_inner()) = msg;
            }
        })
        .map_err(gerr)
}
