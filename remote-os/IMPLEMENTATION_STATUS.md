# remote-os — implementation status (Milestone 1, server side)

Updated 11 Oct 2026. Spec: `docs/superpowers/specs/2026-10-11-remote-os-design.md` (the "Milestone 1 contract", its "Browser access" section added by the viewer builder, and the "Supervisor as built" notes added with this build). Encode spike: `benchmarks/2026-10-11-encode-spike.md`.

**Display honesty:** this is **X11 (Xvfb), not Wayland**. Capture is `ximagesrc` and input is XTest. Both sit behind `CaptureBackend` / `InputBackend` traits so a Wayland backend (Milestone 2) can drop in.

## Live deployment

- `https://desk.ravikishan.me/api/v1/health` answers **200** from the owner's PC through the Cloudflare tunnel. The supervisor listens on `127.0.0.1:7780` only.
- `remote-os.service` is enabled and active as user `remoteos`.
- agentd (7777), the shared desktop `:1`, agentd-browser, cloudflared and coturn are unchanged and still active.
- Binary: `/opt/remote-os/bin/remote-os-supervisor`. It was built on the box (aarch64, rustc 1.92) from `/opt/remote-os/src`, which is a copy of this directory. **This repo is the source of truth.**
- Units: `/etc/systemd/system/remote-os.service` and `remote-os-session@.service`.
- Polkit rule: `/etc/polkit-1/rules.d/50-remote-os.rules`.
- Session runner: `/opt/remote-os/bin/remote-os-session-run`.
- Test pages: `/opt/remote-os/share/{anim,latency}.html`.
- To reinstall: `cargo build --release && sudo bash deploy/install.sh`.
- **Bench token: DISABLED and removed.** `/etc/remote-os/bench.env` was shredded after the benchmark and the supervisor restarted. The running process has no `REMOTE_OS_BENCH_TOKEN` (checked in `/proc/<pid>/environ`) and logged no BENCH warning at startup. The local copy of the token was deleted.

## Completed

| Area | What exists |
|---|---|
| Workspace | `crates/{protocol,session,capture,input,media,auth,turn,supervisor}`. `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` all pass (**64 unit tests**). |
| protocol | REST, signalling, input and status types. One total parser for the `input` channel: version check, monotonic `seq`, 512-byte limit (`clip` 64 KiB), field ranges, and a token bucket of 400/s (every message counts, valid or not). Every failure has a stable `input/*` code. |
| session | State table (CREATING→READY→CONNECTED⇄IDLE→STOPPING→STOPPED, plus FAILED). Capacity is 3, and 1080p60 runs only alone. Slots map to `rdesk<N>` / `:2<N>` / `remote-os-session@<N>`. SQLite store holds sessions, idempotency keys (24 h, per account) and an append-only event log. On restart, the supervisor reconciles sessions. A reaper stops sessions whose desktop unit died. `systemctl` is refused for any slot outside 1..=max before it is spawned. |
| capture | `X11Capture` (`ximagesrc use-damage=false show-pointer=true`), a readiness probe, and a hand-written Xauthority parser/writer. The supervisor merges per-session cookies into its own `$XAUTHORITY` with FamilyWild entries. |
| input | `Controller` tracks held keys and buttons. Release-all happens on `rel`, channel close, 6 s heartbeat loss and pipeline teardown. XTest runs over one x11rb connection per viewer, with no xdotool spawn. The keysym map follows `KeyboardEvent.code` (physical US keys); a Unicode character from `key` falls back to a scratch keycode. Wheel input becomes buttons 4–7. A CLIPBOARD owner thread runs per session (set + pull, 64 KiB, INCR refused). |
| media | `ximagesrc → videoconvert(n-threads by profile) → I420 → queue leaky=downstream max-size-buffers=2 → x264enc` with `tune=zerolatency speed-preset=ultrafast bframes=0 key-int-max=4·fps pass=qual quantizer=23 qpmin=20`, bitrate = VBV cap, VBV buffer ≤150 ms. The level is pinned through caps, giving 42c01f / 42c028 / **42c02a** (verified in the SDP offers). Then `h264parse → rtph264pay config-interval=-1 aggregate-mode=zero-latency → webrtcbin bundle-policy=max-bundle`, sendonly, **NACK/RTX on**. Both DataChannels are created server-side before the offer. PLI/FIR become a force-key-unit, rate-limited to one per 300 ms. Stats go out every second (captured/encoded/dropped/encode-ms/fps/bitrate/RTT/loss). Adaptive bitrate is AIMD on RTCP loss plus RTT queueing and retunes x264 live. |
| auth | Firebase ID token check: RS256, `aud`/`iss` = project, `sub`, `email_verified`, allow-list from `AGENT_ADMIN_EMAILS`. Google keys are cached per `Cache-Control: max-age`, with an early refetch for an unknown `kid` (at most every 30 s). Keys come from Google's securetoken **JWK** endpoint, which publishes the same keys as the x509 endpoint. The bench token is tunnel-only and constant-time compared. |
| turn | coturn `use-auth-secret` credentials: `<expiry>:<session>`, HMAC-SHA1, 10 min. A test vector is checked against openssl. |
| supervisor | Axum/Tokio REST + WebSocket exactly per contract. CORS per "Browser access", hand-written so preflight returns 204 without auth and error responses carry the headers. Upgrades from origins outside the allow-list are refused with 403. Logs are JSON via `tracing`; they never contain SDP, ICE candidates or tokens (sizes only). Re-auth over the socket is supported. Input is refused when `auth_time` is more than 30 min old. A frame-rate-only profile change renegotiates; a size change is refused with `profile/needs-restart`. |
| Deployment | Users `rdesk1..3` (own group, 0700 homes, `/bin/bash`, no sudo). User `remoteos` (system, nologin, groups `coturn`, `rdesk1..3`). The session unit runs Xvfb with a fresh MIT cookie (`/run/remote-os-session-N/Xauthority`, rdeskN:rdeskN 0640), then XFCE and Chromium. Its limits: MemoryMax 4G, CPUQuota 150%, TasksMax 1024, NoNewPrivileges, ProtectSystem=strict, ProtectHome=tmpfs + BindPaths of its own home, PrivateTmp, PrivateDevices. `PrivateTmp=yes` works because the supervisor reaches Xvfb over the abstract socket. The supervisor unit has NoNewPrivileges, ProtectSystem=strict, ProtectHome, PrivateTmp/Devices, RestrictNamespaces, CPUQuota 300% and MemoryMax 3G. Only `AGENT_ADMIN_EMAILS` is copied out of `/etc/agentd.env`, by a root `ExecStartPre`; agentd's other secrets never reach this process. |

## Tests run

**Unit (`cargo test`, 64 tests, all pass)** cover:
- protocol: every message type, malformed and oversized messages are refused rather than panicked on, the rate bucket (burst exactly 400), sequence replay, clip limits.
- session: state table, capacity and the 1080p60-alone rule, slot reuse, idempotency replay and mismatch, unit start failure leading to FAILED, live profile change, reconcile after restart, reaper.
- auth: valid token, wrong aud, wrong iss, expired, unverified e-mail, not allow-listed, a key from another signer under the right kid, unknown kid, `alg:none`, HS256 alg-confusion, empty allow-list. Bench token needs both the tunnel and a match.
- turn: openssl vector.
- capture: xauth round-trip and truncation, display-name validation.
- input: pixel mapping, release-all, auto-repeat, wheel.
- media: ABR.
- supervisor: CORS exact-match origins, tunnel detection, Idempotency-Key validation.

**Isolation (`tests/isolation.sh`, on the box, 71/71 pass, 11 Oct 2026)**:
- rdesk1 and rdesk2 cannot list each other's homes or read each other's X cookies. rdesk2 cannot open `:21` without the cookie, while rdesk1 can open its own display.
- Session users cannot read the TURN secret, agentd's env or the supervisor's state, and have no sudo.
- `remoteos` reads the TURN secret and the session cookies through its groups, and cannot read agentd's env or session homes.
- Polkit, exercised with real `systemctl` calls, lets remoteos start/stop `remote-os-session@N` only. It is refused for agentd, cloudflared, coturn, agentd-desktop, `@4`, and `reload`; rdeskN is refused even its own unit.
- The negative checks use `start` on already-running units, so a wrong rule would have been a no-op.
- No X server listens on TCP, and Xvfb runs as the slot user.

**End-to-end (`tests/e2e-webrtc.mjs`, from the owner's PC, real tunnel + TURN/TCP 443, `iceTransportPolicy:"relay"`, installed Chrome via puppeteer-core)**:
- health 200;
- origin and auth refusals: a foreign Origin is refused, REST without a token gets 401, preflight gets 204, an unknown session gets 404;
- WS with no auth in 5 s closes **4401**, a forged token closes **4401**, an unknown session closes **4404**;
- create returns READY in ~0.2–0.3 s of display start-up (~1.2 s for the whole POST through the tunnel);
- CONNECTED with `viewer:true`;
- the relay path is verified (local candidate `via turn:92.4.83.196:443?transport=tcp`, plus a TCP/443 leg on the box);
- stats come from both the client and the status channel;
- input-to-display latency;
- **live abuse of the input channel**: non-JSON, a replayed seq, a 2 KB move, binary, `v:2`, an unknown type, an out-of-range coordinate and a 1000-message flood. Result: ~585–589 rejected, the stream kept decoding (129 frames at 30 fps / 259 at 60 fps in the window) and `/health` stayed 200;
- the clipboard set + pull round trip;
- `res` across sizes is refused with `profile/needs-restart`;
- a second viewer gets `{type:"replaced"}` plus **4409** on the first;
- stop returns STOPPED.

Final runs, after the RTX change: 720p30 **25/25**, 1080p30 **25/25**, 1080p60 all checks passed. Raw logs and JSON are in `benchmarks/2026-10-11-m1-e2e/`.

## Benchmarks (11 Oct 2026, measured, owner's PC ↔ box over the internet; RTT ≈ 30–43 ms)

The motion content is `anim.html#full` (full-screen scroll plus spin) in a kiosk Chromium on the session display. Idle is `anim.html#idle`, a static page of text. The window is 20 s for motion and 10 s for idle. Numbers come from the browser's `getStats()` unless they are labelled as server numbers.

| Profile | Content | Decoded fps | Dropped (browser) | Lost pkts | Mbit/s | RTT p50/p95 ms | Jitter ms | Decode ms/frame | Jitter buffer ms | Server encode ms/frame | Supervisor CPU (cores) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 720p30 | idle | 30.0 | 0 | 0 | 0.5 | 30 / 31 | 1 | 1.0 | 2.4 | 2.2 | — |
| 720p30 | motion | **30.0** | 0 | 0 | 2.5 | 30 / 31 | 1 | 1.7 | 8.9 | 3.3 | **0.41** |
| 1080p30 | idle | 30.0 | 0 | 0 | 1.0 | 33 / 33 | 1 | 1.8 | 4.1 | 4.8 | — |
| 1080p30 | motion | **30.0** | 0 | 0 | 4.5 | 33 / 35 | 3 | 3.8 | 9.8 | 8.9 | **0.86** |
| 1080p60 | idle | 59.9 | 0 | 0 | 1.0 | 32 / 35 | 1 | 1.8 | 14.9 | 4.6 | — |
| 1080p60 | motion | **51.9** | 0 | 926 (824 retransmitted via RTX, 185 NACKs, 0 PLI) | 6.4 | 33 / **374** | 2 | 3.3 | 16.5 | 8.3 | **1.61** |
| 1080p60 | motion (earlier run, no congestion) | **60.0** | 0 | 0 | 7.0 | 33 / 53 | 6 | 8.8 | 23.5 | 8.5 | 1.61 |

- The bare XFCE desktop (no page) idles at **13–17 kbit/s**, with ~180–310 kbit/s seconds at each 4-s keyframe.
- Resolution received was always the profile's: 1280×720 or 1920×1080. The server reported encoded fps at 30.0 / 30.0 / 60.0, and leaky-queue drops inside the windows were 0–1.
- The 1080p60 run with 926 lost packets is a real congestion episode on the internet path: RTT p95 rose to 374 ms. ABR cut the cap from 7000 to 5950 kbit/s, RTX repaired 824 packets, and no keyframe request was needed. The picture slowed to 52 fps but did not freeze.
- An earlier 1080p30 run, before RTX, hit a similar episode: 3 packets lost, 1 PLI, 23 decoded fps over the window. That run is what prompted turning RTX on.

**Input-to-display latency.** Measured from a `pd/pu` or `kd/ku` sent on the DataChannel to the first decoded frame whose centre flipped black↔white. The probe is `latency.html` in the session's Chromium, sampled on every `requestVideoFrameCallback`; 15 trials each.

| Profile | Click p50 / p95 / min ms | Key p50 / p95 / min ms |
|---|---|---|
| 720p30 | 110 / 113 / 107 | 110 / 113 / 110 |
| 1080p30 | 83 / 126 / 78 | 81 / 109 / 75 |
| 1080p60 | 97 / 113 / 68 | 95 / 106 / 80 |

Across all runs, p50 ranged from 80 to 115 ms and nothing was missed.

That figure includes everything between the two clocks:
- the network RTT (~31 ms, both directions);
- XTest injection;
- the remote Chromium rendering the flip (software compositor, `--disable-gpu`);
- capture phase at 30/60 fps (0–33 ms);
- x264 (3–9 ms);
- the TURN relay;
- the jitter buffer (2–24 ms) and decode (1–9 ms).

It does not include display scan-out on the PC.

**Supervisor CPU while streaming** (one viewer, full-screen motion): 0.41 core at 720p30, 0.86 at 1080p30, 1.61 at 1080p60. These match the spike's native-resolution numbers, because there is no scaling.
- The session unit's own cgroup used 0.11–0.28 core (Xvfb, XFCE and Chromium idle).
- The motion kiosk Chromium was launched by the test **outside** the session's cgroup (via `sudo -u rdeskN` over ssh), so its rendering cost (~0.6 core in the spike) is not in the session figure.

**Connect time:** from WS open to the first decoded frame with both DataChannels open, 2.2–4.5 s. Most of that is TURN allocation plus ICE over TCP.

### Against the MJPEG baseline (today's live view, from the spike)

| Measure | MJPEG 800×450 (agentd live view) | WebRTC H.264 720p30 (this build) | WebRTC H.264 1080p30 / 1080p60 |
|---|---|---|---|
| Frame rate in motion | ≤ 8 fps (measured ≈ 5 fps over the tunnel) | **30.0 fps decoded** | 30.0 / 60.0 fps |
| Pixels per frame | 0.36 MP | 0.92 MP (×2.6) | 2.07 MP (×5.8) |
| Bitrate in motion | 1.75–3.0 Mbit/s | 2.5 Mbit/s (capped) | 4.5 / 7.0 Mbit/s |
| Bitrate idle | 0 (mpdecimate) | 0.5 Mbit/s on a static text page; 13–17 kbit/s on the bare desktop | 0.7–1.0 Mbit/s |
| Encode CPU | 0.13–0.14 core | 0.41 core (supervisor, incl. capture + DTLS/SRTP) | 0.86 / 1.61 core |
| Transport | HTTP push through the tunnel, screenshot-style | real-time RTP over TURN/TCP 443, NACK/RTX, PLI, ABR | same |
| Input | `xdotool` process spawned per action | in-process XTest over a reliable DataChannel; ~80–115 ms input→photon p50 end to end | same |

## Remaining / not done

- **The admin viewer** is the other builder's work. Its real Firebase path is already exercised against this server: during the benchmark the owner's live viewer (`ravikishan63392@gmail.com`) attached to the benchmark session twice, authenticated, completed ICE and opened both channels. Under the one-viewer rule it replaced the test viewer, which is why one interrupted 720p30 run is archived separately.
- **Milestone 2+** — Wayland capture and input, damage gating (idle traffic is still constant), per-session cleanup on long idle, a dashboard, and density/cost reports — is not started.
- **Resolution change on a live session** is refused (`profile/needs-restart`): Xvfb 1.20 exposes a single RandR mode and `xrandr --fb` fails. Frame-rate-only changes (1080p30↔1080p60) renegotiate. They are unit-tested but not exercised end to end.
- **The sessions' Chromium** runs with the default sandbox. Inside the unit, user namespaces are allowed; `RestrictNamespaces` is not set on the session unit because Chromium needs them.
- **webrtcbin `turn-server`** support is implemented (`REMOTE_OS_WEBRTC_TURN=1`) but OFF. It is not needed: coturn reaches webrtcbin's host candidate on 10.0.0.118 (`allowed-peer-ip`), and the browser's relayed checks arrive as peer-reflexive. Verified on every e2e run.

## Limitations and findings to act on

1. **X11, not Wayland.** Any X client holding a session's cookie can read and inject into that session. The cookie is the boundary: per-slot user and group, 0640, readable only by that slot's user and the supervisor.
2. **FIXED 11 Oct 2026 (was pre-existing, outside remote-os):** agentd's shared desktop `:1` ran Xvfb **without `-auth`** and its Chromium exposed unauthenticated CDP on `127.0.0.1:9222`, so any local user — `rdeskN`, anything in their Chromium, `remoteos` — could drive the agent's desktop and signed-in browser. Now: Xvfb `:1` runs `-auth /run/agentd-desktop/Xauthority` (fresh cookie per start, dir 0700 / file 0600, owner `agent`), and `agentd-loopback-guard.service` loads nft table `inet agentd_loopback` that filters connections on `lo` by the connecting uid: 9222 and 5901 only `agent`; 7777 only `agent` + root (cloudflared runs as root); 7780 only root + `remoteos`. `tests/isolation.sh` asserts both (26 new checks, formerly the `KNOWN` line). `deploy/install.sh` reloads the guard so it picks up the `remoteos` uid.
3. **Pre-existing:** `/etc/coturn/turnserver.conf` carries the TURN secret inline (`static-auth-secret=`) as well as in `/etc/remote-os/turn.secret`; the file permissions were not checked here. Making coturn read the secret from the 0640 file is the cleaner arrangement.
4. **TURN over TCP and bursts.** A keyframe is one burst that coturn pushes down a single TCP connection.
   - With a 500 ms VBV buffer, keyframes lost ~20% of their packets, causing PLI loops and frozen video at idle.
   - **Measured fix:** VBV buffer ≤ 150 ms and ≤ ~90 KB per frame (1080p60 → 102 ms), which gave 0 loss. RTX now repairs congestion loss.
   - TCP head-of-line blocking still shows as RTT spikes under internet congestion (p95 374 ms in one run). UDP TURN or TURN/TLS on 443 would be the next step; UDP needs a firewall/OCI change that was out of scope.
5. **The benchmark harness opens the motion page outside the session cgroup**, so session CPU excludes page rendering. The supervisor CPU figure is exact.
6. **The bench token** was the only non-Firebase way in. It existed only for the benchmark, required Cloudflare tunnel headers (`cf-ray` + `cf-connecting-ip`), and is now removed.
7. **One viewer per session** is enforced. Another tab, or the admin auto-connecting, will replace a running viewer (4409), as the contract specifies.
8. **Clipboard** is owner-initiated only (`clip?`). There is no change notification, and transfers over 64 KiB (INCR) are refused.
9. **Logging** is JSON through journald. Request logs record method, path, status and latency — never headers, query strings, SDP, ICE candidates or tokens.

## Files

- `Cargo.toml`, `crates/*` — the workspace.
- `deploy/systemd/remote-os.service`, `deploy/systemd/remote-os-session@.service`, `deploy/polkit/50-remote-os.rules`, `deploy/bin/remote-os-session-run`, `deploy/install.sh`.
- `tests/e2e-webrtc.mjs` — run `REMOTE_OS_BENCH_TOKEN=… node remote-os/tests/e2e-webrtc.mjs 720p30 1080p30 1080p60`; this needs the bench token re-enabled in `/etc/remote-os/bench.env` (root 0600) and REMOVED afterwards. `PROBE=n` prints per-second client and server stats.
- `tests/isolation.sh` — on the box: `sudo bash tests/isolation.sh` with sessions in slots 1–3. It stops slot 3 at the end.
- `tests/pages/{anim,latency}.html`.
- `benchmarks/2026-10-11-m1-e2e/` — raw e2e logs and result JSON.
