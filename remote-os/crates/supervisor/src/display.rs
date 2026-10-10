//! Display readiness and the supervisor's merged X authority file.

use std::time::{Duration, Instant};

use protocol::SessionState;
use session::{cookie_path_for_slot, display_for_slot, Manager};

/// Rewrites `$XAUTHORITY` from the cookie files of every live session.
pub fn rebuild_authority(manager: &Manager, xauthority: &std::path::Path) {
    let live = match manager.live() {
        Ok(l) => l,
        Err(e) => {
            tracing::warn!(error = %e, "authority rebuild: cannot list sessions");
            return;
        }
    };
    let pairs: Vec<(String, std::path::PathBuf)> = live
        .iter()
        .filter_map(|s| s.slot)
        .map(|slot| (display_for_slot(slot), cookie_path_for_slot(slot)))
        .collect();
    match capture::rebuild_authority(xauthority, &pairs) {
        Ok(n) => tracing::debug!(entries = n, "X authority rebuilt"),
        Err(e) => tracing::error!(error = %e, "X authority rebuild failed"),
    }
}

/// Blocks until the session's display answers at the profile's geometry, then
/// moves it CREATING → READY; FAILED after `timeout`. Run on a blocking thread.
pub fn await_ready(manager: &Manager, xauthority: &std::path::Path, id: &str, timeout: Duration) {
    let Ok(rec) = manager.get(id) else { return };
    if rec.state != SessionState::Creating {
        return;
    }
    let Some(slot) = rec.slot else { return };
    let disp = display_for_slot(slot);
    let want = (rec.profile.width(), rec.profile.height());
    let start = Instant::now();
    let mut last_err = String::new();
    while start.elapsed() < timeout {
        rebuild_authority(manager, xauthority);
        match capture::probe_display(&disp) {
            Ok(geom) if geom == want => {
                tracing::info!(session = %id, display = %disp, ms = start.elapsed().as_millis() as u64, "display ready");
                if let Err(e) = manager.set_state(id, SessionState::Ready, None, Some("display up"))
                {
                    tracing::warn!(session = %id, error = %e, "ready transition");
                }
                return;
            }
            Ok(geom) => {
                last_err = format!(
                    "display is {}x{}, expected {}x{}",
                    geom.0, geom.1, want.0, want.1
                )
            }
            Err(e) => last_err = e.to_string(),
        }
        // The unit died (bad script, Xvfb refused to start): fail now rather
        // than at the timeout.
        if start.elapsed() > Duration::from_secs(1) && !manager.unit_active(slot) {
            last_err = format!("session unit exited before {disp} came up");
            break;
        }
        // Someone stopped it meanwhile.
        if manager
            .get(id)
            .map(|r| r.state != SessionState::Creating)
            .unwrap_or(true)
        {
            return;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    tracing::error!(session = %id, error = %last_err, "display never became ready");
    let _ = manager.fail(id, &format!("display did not come up: {last_err}"));
    rebuild_authority(manager, xauthority);
}
