# Media spike: x264 + webrtcbin on the agent box (11 Oct 2026)

Spike for `docs/superpowers/specs/2026-10-11-remote-os-design.md`. Box: `jarvis`, Oracle Linux 9.8 aarch64, 4× Neoverse-N1, 22 GB RAM, no GPU, GStreamer 1.22.12.
Raw numbers: `2026-10-11-encode-spike/results.jsonl` (48 runs). The scripts that produced them sit beside it and are also on the box under `/opt/remote-os/bench/`.

## Verdict

- **All three profiles hold their target frame rate on this box, for one session, even under full-screen motion and with `superfast`.**
  - 720p30 uses 0.33–0.79 of one core.
  - 1080p30 uses 0.71–1.05 cores.
  - 1080p60 uses 1.41–2.01 cores.
  - x264 adds 2.5–12 ms of latency per frame at p50 (≤17 ms at p95).
- **Most of the CPU goes to scaling and colour conversion, not x264.** For 1600x900 → 720p30, the `videoscale ! videoconvert` step alone costs **45% of a core**, ximagesrc costs about 1%, and x264 `ultrafast` adds only about 17–22%. If the session's Xvfb runs at the profile's own resolution, there is nothing to scale, and 720p30 `ultrafast` drops to **33–38% of a core**. Rule for the supervisor: **size each session's Xvfb to the profile and never scale in the pipeline.** `videoconvertscale n-threads=4` was no faster than the two separate elements (46% vs 45%).
- **How many 720p30 sessions fit at once:** a native-720p session costs about 0.38 core to encode. A busy desktop needs about another 0.6 core of Chromium/Xvfb rendering, measured as the change in whole-box CPU when the page animates. Keeping about 1 core free for agentd, claude, cloudflared and the OS, that leaves room for **about 3 sessions with constant motion**, or **about 5–6 sessions that are mostly static** (the normal case for agent desktops).
  - Recommended caps: **3 concurrent 720p30 sessions**, and **only one 1080p60 session** with nothing else running (it alone takes about half the box).
- **Compared with today's MJPEG feed (8 fps, 800x450, `mpdecimate`):**
  - H.264 720p30 gives 3.75× the frame rate and 2.56× the pixels per frame at **the same or lower bitrate**: 2.5 Mbit/s capped, or about 2.0 Mbit/s with CRF + VBV, against MJPEG's 1.75–3.0 Mbit/s in motion.
  - The cost is **2.5–5× the CPU** (0.33–0.67 core against 0.13–0.14).
  - **MJPEG is completely silent when idle**: 0 bytes, because `mpdecimate` drops identical frames. H.264 as configured keeps capturing and encoding 30 fps and sends **0.65–1.7 Mbit/s while nothing changes**. CBR spends its budget on a static screen and a keyframe every 2 s. Three fixes, the first two measured:
    - `qpmin=20` cut idle traffic to **0.65 Mbit/s**.
    - CRF 23 with a VBV cap cut it to **0.98 Mbit/s**, and also lowered motion traffic to about 2.0 Mbit/s.
    - Not built: damage gating (stop pushing frames, or drop to 1–5 fps, while XDamage reports nothing) plus a long GOP with a keyframe sent only on PLI/FIR.

## What was installed

| Component | Version | How |
|---|---|---|
| x264 | 0.165, `stable` branch commit `b35605ace3ddf7c1a5d67a2eb553f034aef41d55` (8 Jun 2025) | Built from `code.videolan.org/videolan/x264` with `--prefix=/usr/local --enable-shared --enable-pic`. aarch64 NEON asm is on (`asm: yes`). SVE/SVE2 objects are compiled in but the N1 has no SVE, so runtime dispatch uses NEON. Installed as `/usr/local/lib/libx264.so.165`. |
| gst x264enc | gst-plugins-ugly 1.22.12 | `meson setup build --prefix=/usr/local -Dauto_features=disabled -Dx264=enabled -Dgpl=enabled -Dnls=disabled -Ddoc=disabled`. Installed as `/usr/local/lib64/gstreamer-1.0/libgstx264.so` plus `/usr/local/share/gstreamer-1.0/presets/GstX264Enc.prs`. |
| libnice | **0.1.22** (source, `libnice.freedesktop.org`) | `meson ... --libdir=lib64 -Dgstreamer=enabled -Dgupnp=disabled -Dcrypto-library=openssl -Dexamples/tests/gtk_doc/introspection=disabled`. Installed as `/usr/local/lib64/libnice.so.10.14.0` plus `/usr/local/lib64/gstreamer-1.0/libgstnice.so` (nicesrc/nicesink). |
| webrtcbin | gst-plugins-bad 1.22.12, webrtc plugin only | `meson ... -Dauto_features=disabled -Dwebrtc=enabled -Dsctp=enabled`, then **only** `ext/webrtc/libgstwebrtc.so` and `gst-libs/gst/webrtc/nice/libgstwebrtcnice-1.0.so.0.2212.0` were copied to `/usr/local/lib64[/gstreamer-1.0]`. The full install would have shadowed the system's other `libgst*-1.0` libraries. RPATH was reset to `/usr/local/lib64` with `patchelf`. Everything else (`libgstwebrtc-1.0`, `libgstsctp-1.0`, the sctp, dtls and srtp plugins) comes from the distro package. |
| dnf | `gstreamer1-plugins-good-1.22.12-7.el9_8.8`, `gstreamer1-plugins-bad-free-1.22.12-7.el9_8.4` (+`-devel`), `gstreamer1-devel-1.22.12-3.el9`, `gstreamer1-plugins-base-devel-1.22.12-8.el9_8.2`, `gstreamer1-plugins-base-tools`, `libsrtp(-devel)-2.3.0-8.el9`, `usrsctp(-devel)-0.9.5.0-7.el9`, `openssl-devel`, `nasm-2.15.03-7.el9`, `meson-0.63.3-1.el9`, `ninja-build-1.10.2-6.el9`, `sysstat-12.5.4`, `python3-gobject-3.40.1-6.el9`, `patchelf` | |
| System config | `/etc/ld.so.conf.d/usr-local.conf` (`/usr/local/lib`, `/usr/local/lib64`) and `/etc/profile.d/gstreamer-local.sh` (`export GST_PLUGIN_PATH=/usr/local/lib64/gstreamer-1.0`) | |

Checked as user `agent` in a login shell. Every element now resolves:

```
webrtcbin    /usr/local/lib64/gstreamer-1.0/libgstwebrtc.so 1.22.12
nicesrc/sink /usr/local/lib64/gstreamer-1.0/libgstnice.so   0.1.22
x264enc      /usr/local/lib64/gstreamer-1.0/libgstx264.so   1.22.12
ximagesrc    /lib64/gstreamer-1.0/libgstximagesrc.so        1.22.12
dtlssrtpenc/dec /lib64/gstreamer-1.0/libgstdtls.so          1.22.12
srtpenc      /lib64/gstreamer-1.0/libgstsrtp.so             1.22.12
sctpenc      /lib64/gstreamer-1.0/libgstsctp.so             1.22.12
rtph264pay   /lib64/gstreamer-1.0/libgstrtp.so              1.22.12
```

### Things that failed, and corrections to the spec

- **The spec says "bad-free (incl. webrtcbin)" is packaged. That is wrong.** EL9's `gstreamer1-plugins-bad-free` ships the `libgstwebrtc-1.0` *library* but not the `webrtc` *plugin*. In 1.22, building the plugin needs libnice ≥ 0.1.20, and EL9/EPEL has 0.1.19 (meson reports: `Dependency nice found: NO found 0.1.19 but need: '>=0.1.20'`). The fix is the source build of libnice 0.1.22 and the webrtc plugin described above.
- **`gstreamer1-plugins-bad-free-extras` does not exist** on OL9.
- **libnice 0.1.19 is no longer installed.** Removing `libnice-gstreamer1` and `libnice-devel` (installed during this spike, to avoid two `nice` plugins) let dnf autoremove the distro libnice too. Nothing else required it. `/usr/local` libnice 0.1.22 is now the only copy, and its gst plugin is the one webrtcbin loads. These must come from the same libnice build, because webrtcbin creates nicesrc/nicesink internally.
- `/etc/profile.d` only reaches login shells. **The supervisor's systemd unit must set `Environment=GST_PLUGIN_PATH=/usr/local/lib64/gstreamer-1.0`** itself. Library lookup is already covered system-wide by `ld.so.conf.d`.
- The pipeline `GST_QUERY_LATENCY` always returned 0: the source is live, the sink is `fakesink sync=false`, and the encoder reports no latency in zerolatency mode. It means nothing here. Encoder latency per frame was measured instead, with pad probes on `x264enc` sink→src, pairing frames FIFO. PTS cannot be used for the pairing because x264enc rebases PTS onto a 1000-hour offset. True capture→packet latency was not measured: the leaky queue breaks FIFO pairing upstream of it.

## webrtcbin negotiation: done

`offer.py` (beside this file) runs `ximagesrc :1 → videoconvert → x264enc zerolatency → rtph264pay → webrtcbin bundle-policy=max-bundle stun-server=stun.l.google.com`, then calls `create-offer` and `set-local-description`. Result:

```
a=group:BUNDLE video0
m=video 9 UDP/TLS/RTP/SAVPF 96
a=rtpmap:96 H264/90000
a=rtcp-fb:96 nack pli / ccm fir / transport-cc
a=fmtp:96 packetization-mode=1;sprop-parameter-sets=...;profile-level-id=42c028;level-asymmetry-allowed=1
a=fingerprint:sha-256 F0:7E:...   (DTLS loaded)
a=rtcp-mux-only
H264/90000 present: True
candidates gathered: 9  (host 10.0.0.118 UDP+TCP, IPv6 link-local, srflx 92.4.83.196 UDP+TCP)
```

What this means for the build:
- The offer is **constrained-baseline, Level 4.0** (`42c028`), chosen automatically for 1600x900@30. **1080p60 needs Level 4.2 (`42c02a`)**, so the supervisor should pin profile and level in the caps after x264enc for each profile.
- `nack pli` and `ccm fir` are already advertised, so a keyframe on request only needs the supervisor to act on the upstream `GstForceKeyUnit` event.
- The srflx candidates show the public IP. Media still goes through TURN/443 as the spec says; this spike opened no ports.

## Method

- **Benchmark harness.** `bench.py` is a Python/GStreamer harness that runs as user `agent`. It warms up for 2 s, then measures for 15 s, recording:
  - capture fps (buffers at `ximagesrc` src) and encoded fps (buffers at `x264enc` src);
  - **CPU of the gst process** (utime+stime from `/proc/self/stat` over wall time; 100% = one core);
  - **whole-box CPU** (from `/proc/stat`, as a percentage of 4 cores; it includes Chromium rendering the content);
  - RSS;
  - output Mbit/s (bytes leaving the encoder);
  - per-frame encoder latency, p50/p95.
- **Pipeline** (as specified): `ximagesrc display-name=D use-damage=false show-pointer=true ! video/x-raw,framerate=F/1 ! videoscale ! video/x-raw,width=W,height=H ! videoconvert ! video/x-raw,format=I420 ! queue max-size-buffers=2 leaky=downstream ! x264enc tune=zerolatency speed-preset=P key-int-max=60 bframes=0 bitrate=B ! fakesink sync=false`
- **Content.** A Chromium kiosk window (separate `--user-data-dir`, `--disable-gpu`) showed `anim.html` in one of three modes:
  - **idle**: a static page full of text cards;
  - **box**: text scrolling continuously plus a spinning gradient, in an 800x600 region (a typical window);
  - **full**: the same scroll and spin across the whole screen (worst case, like scrolling a long page full-screen).
- **Displays.** The real desktop `:1` was only **captured passively**, because a live agentd job and the agentd MJPEG live view were using it. Motion runs used temporary displays, all killed afterwards:
  - `:8` at 1600x900, the same geometry as `:1`, scaled to 720p.
  - `:9` at **1920x1080, native** for 1080p (videoscale passes through; nothing is upscaled).
  - `:7` at 1280x720, native 720p with no scale.
- **Background load.** The agentd MJPEG ffmpeg (about 14% of a core) and one agentd chat were running throughout. That adds about 3–5% to the whole-box figures.

## Results: the specified pipeline (CBR, videoscale + videoconvert)

| Profile | Source | Content | Preset | fps (target) | CPU, 1 core = 100% | Box CPU (of 4 cores) | RSS MB | Mbit/s | Encoder latency p50 / p95 ms |
|---|---|---|---|---|---|---|---|---|---|
| 720p30, 2500k | real `:1` (static) | idle | ultrafast | 29.98 (30) | 64.7 | 22.8 | 58 | 2.41 | 3.2 / 3.8 |
| 720p30, 2500k | real `:1` (static) | idle | superfast | 29.97 | 73.3 | 24.6 | 64 | 2.36 | 3.8 / 4.9 |
| 720p30, 2500k | `:8` 1600x900 → scaled | idle | ultrafast | 29.98 | 61.9 | 21.5 | 58 | 1.72 | 2.8 / 3.4 |
| 720p30, 2500k | `:8` | idle | superfast | 29.98 | 67.6 | 19.9 | 64 | 1.37 | 3.0 / 3.9 |
| 720p30, 2500k | `:8` | box | ultrafast | 29.98 | 65.8 | 34.1 | 57 | 2.54 | 2.9 / 3.2 |
| 720p30, 2500k | `:8` | box | superfast | 29.98 | 74.2 | 37.9 | 64 | 2.52 | 4.5 / 6.2 |
| 720p30, 2500k | `:8` | full | ultrafast | 29.98 | 67.1 | 44.9 | 57 | 2.50 | 4.0 / 5.4 |
| 720p30, 2500k | `:8` | full | superfast | 29.98 | 78.7 | 48.4 | 64 | 2.48 | 5.1 / 7.6 |
| 720p30, 2500k | `:7` 1280x720 **native**, convert only | idle | ultrafast | 29.99 | **33.3** | 15.1 | 52 | 1.86 | 2.8 / 3.5 |
| 720p30, 2500k | `:7` native | idle | superfast | 30.05 | 37.8 | 16.7 | 58 | 1.54 | 3.3 / 4.1 |
| 720p30, 2500k | `:7` native | full | ultrafast | 30.04 | **38.2** | 30.2 | 52 | 2.54 | 3.5 / 4.2 |
| 720p30, 2500k | `:7` native | full | superfast | 30.04 | 50.1 | 33.2 | 58 | 2.51 | 4.8 / 6.7 |
| 1080p30, 4500k | `:9` 1920x1080 native | idle | ultrafast | 29.98 | 70.9 | 23.9 | 69 | 3.39 | 5.6 / 7.1 |
| 1080p30, 4500k | `:9` | idle | superfast | 29.98 | 78.6 | 26.2 | 85 | 2.66 | 5.9 / 7.7 |
| 1080p30, 4500k | `:9` | box | ultrafast | 29.98 | 73.8 | 39.5 | 71 | 4.54 | 6.5 / 7.7 |
| 1080p30, 4500k | `:9` | box | superfast | 29.98 | 87.9 | 39.5 | 83 | 4.51 | 8.0 / 10.0 |
| 1080p30, 4500k | `:9` | full | ultrafast | 29.98 | 80.5 | 50.8 | 71 | 4.56 | 8.3 / 11.0 |
| 1080p30, 4500k | `:9` | full | superfast | 29.98 | 104.9 | 57.0 | 87 | 4.47 | 12.0 / 17.2 |
| 1080p60, 7000k | `:9` | idle | ultrafast | 59.98 (60) | 140.9 | 41.2 | 72 | 6.43 | 6.0 / 7.1 |
| 1080p60, 7000k | `:9` | idle | superfast | 60.03 | 158.2 | 50.7 | 89 | 4.97 | 6.9 / 9.7 |
| 1080p60, 7000k | `:9` | box | ultrafast | 60.03 | 145.0 | 55.1 | 71 | 7.14 | 6.3 / 7.5 |
| 1080p60, 7000k | `:9` | box | superfast | 60.02 | 168.2 | 60.8 | 86 | 6.99 | 7.6 / 10.1 |
| 1080p60, 7000k | `:9` | full | ultrafast | 59.62 | 158.1 | 71.0 | 75 | 7.04 | 8.7 / 12.0 |
| 1080p60, 7000k | `:9` | full | superfast | 59.75 | **200.6** | **80.4** | 89 | 7.08 | 12.2 / 16.8 |

No configuration dropped frames: 1080p60 full-screen superfast still delivered 59.75 fps. The ceiling is concurrency, not one session.

## Where the CPU goes (720p30 from 1600x900; 1080p60 native)

| Pipeline stage | Idle | Full |
|---|---|---|
| ximagesrc only (raw BGRx, 1600x900@30) | 0.7% | 1.1% |
| + videoscale + videoconvert → 720p I420 | 45.4% | 45.2% |
| + videoconvertscale n-threads=4 instead | 45.9% | 46.3% |
| + x264 ultrafast (videoconvertscale) | 62.7% | 67.9% |
| native 720p: ximagesrc + videoconvert only | 16.1% | 16.3% |
| native 720p: + x264 ultrafast | 33.3% | 38.2% |
| 1080p60 native: ximagesrc + videoconvert only | 69.3% | 69.9% |
| 1080p60 native: + x264 ultrafast (videoconvert n-threads=4) | 141.7% | 158.1% |

Chromium rendering the full-screen animation added about 15 points of whole-box CPU (0.6 core) on `:7`, compared with idle. That cost belongs to the session's content, not to the stream.

## Rate control (ultrafast)

| Setting | 720p idle Mbit/s | 720p full Mbit/s | CPU |
|---|---|---|---|
| CBR `bitrate=2500` (default, `pass=cbr`) | 1.72 | 2.51 | 62–68% |
| CBR + `option-string=qpmin=20` | **0.65** | 2.55 | 61–67% |
| `pass=qual quantizer=23` + `vbv-maxrate=2500:vbv-bufsize=2500` | 0.98 | **2.05** | 62–67% |
| 1080p30 with the same CRF 23 + VBV 4500 (videoconvert ×4) | 2.09 | 2.05 | 71–84% |

At idle, CBR keeps lowering QP to spend its budget on a static screen, and resends that high-quality picture as an I-frame every 60 frames. Recommendation: use CRF + VBV cap (or `qpmin`), with a long GOP and keyframes sent on PLI.

## MJPEG baseline (today's live view)

`ffmpeg -f x11grab -framerate 8 -video_size 1600x900 -i D -vf mpdecimate,scale=800:450 -c:v mjpeg -q:v 10 -f image2pipe -`. `mjpeg.py` counts output bytes and JPEG SOI markers, and samples CPU from ffmpeg's own `/proc/<pid>/stat`.

| Display | Content | Output fps | CPU (1 core = 100%) | RSS MB | Mbit/s (KB/s) |
|---|---|---|---|---|---|
| real `:1` | static | 0.00 | 13.9 | 83 | 0 |
| `:8` | idle | 0.00 | 13.9 | 83 | 0 |
| `:8` | box | 7.99 | 13.2 | 101 | 1.75 (214) |
| `:8` | full | 7.99 | 13.5 | 101 | 3.00 (366) |

The live agentd process actually running (`… scale=960:540 …`, a slightly larger output) was sampled at 14.1% CPU.

| Measure | MJPEG 800x450 | H.264 720p30 ultrafast |
|---|---|---|
| Frame rate | ≤ 8 fps | 30 fps (×3.75) |
| Pixels per frame | 0.36 MP | 0.92 MP (×2.56) |
| Bitrate, motion | 1.75–3.0 Mbit/s | 2.0–2.5 Mbit/s (capped) |
| Bitrate, idle | 0 | 0.65–1.7 Mbit/s (needs damage gating to reach about 0) |
| CPU | 0.13–0.14 core | 0.33–0.38 core native, 0.62–0.67 core if scaled |

## Reproduce

All scripts are on the box under `/opt/remote-os/bench/` (`run_all.sh`, `extra.sh`, `extra2.sh`, `bench.py`, `mjpeg.py`, `anim.html`); `offer.py` is beside this file. Run them as `agent`:

```
sudo -iu agent /opt/remote-os/bench/run_all.sh          # main matrix → /tmp/rob-results.jsonl
sudo -iu agent python3 /opt/remote-os/bench/bench.py :1 1280 720 30 2500 ultrafast 15 label
CONV='videoconvert ! video/x-raw,format=I420' ENC='x264enc name=enc ...' python3 bench.py ...   # overrides
sudo -iu agent bash -lc 'DISPLAY=:1 python3 offer.py "ximagesrc display-name=:1 use-damage=false ! video/x-raw,framerate=30/1"'
```

Build sources are kept in `/opt/remote-os/build/`: `x264/`, `gst-plugins-ugly-1.22.12/`, `gst-plugins-bad-1.22.12/`, `libnice-0.1.22/`.
