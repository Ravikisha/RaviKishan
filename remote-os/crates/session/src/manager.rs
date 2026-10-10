//! The session manager: the only writer of session state.

use std::path::Path;
use std::sync::{Arc, Mutex};

use protocol::rest::{valid_session_name, CapacityView, ProfileAllowance, SessionView};
use protocol::{Profile, SessionState};

use crate::capacity::{admits, free_slot};
use crate::state::can_transition;
use crate::store::Store;
use crate::units::{UnitControl, UnitError};

#[derive(Debug, Clone, PartialEq)]
pub struct SessionRecord {
    pub id: String,
    pub name: String,
    pub profile: Profile,
    pub state: SessionState,
    pub slot: Option<u8>,
    pub owner: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub error: Option<String>,
}

impl SessionRecord {
    pub fn view(&self) -> SessionView {
        let ts = |ms: i64| {
            chrono::DateTime::from_timestamp_millis(ms)
                .map(|d| d.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
                .unwrap_or_default()
        };
        SessionView {
            id: self.id.clone(),
            name: self.name.clone(),
            profile: self.profile,
            state: self.state,
            width: self.profile.width(),
            height: self.profile.height(),
            fps: self.profile.fps(),
            created_at: ts(self.created_at_ms),
            last_active_at: ts(self.updated_at_ms),
            viewer: None,
            error: self.error.clone(),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    #[error("{0}")]
    CapacityFull(String),
    #[error("No such session.")]
    NotFound,
    #[error("Unknown profile {0:?}; use 720p30, 1080p30 or 1080p60.")]
    ProfileUnknown(String),
    #[error("A session name is 1-64 printable characters.")]
    InvalidName,
    #[error("That Idempotency-Key was already used for a different request.")]
    IdempotencyMismatch,
    #[error("Session is {from:?}; it cannot become {to:?}.")]
    BadTransition {
        from: SessionState,
        to: SessionState,
    },
    #[error("{0}")]
    NeedsRestart(String),
    #[error("{0}")]
    Unit(#[from] UnitError),
    #[error("session store: {0}")]
    Store(#[from] rusqlite::Error),
}

impl SessionError {
    pub fn code(&self) -> &'static str {
        match self {
            SessionError::CapacityFull(_) => "capacity/full",
            SessionError::NotFound => "session/not-found",
            SessionError::ProfileUnknown(_) => "profile/unknown",
            SessionError::InvalidName => "request/invalid",
            SessionError::IdempotencyMismatch => "idempotency/mismatch",
            SessionError::BadTransition { .. } => "session/state",
            SessionError::NeedsRestart(_) => "profile/needs-restart",
            SessionError::Unit(_) => "session/unit-failed",
            SessionError::Store(_) => "session/store",
        }
    }

    pub fn http_status(&self) -> u16 {
        match self {
            SessionError::CapacityFull(_) => 409,
            SessionError::NotFound => 404,
            SessionError::ProfileUnknown(_) | SessionError::InvalidName => 400,
            SessionError::IdempotencyMismatch => 422,
            SessionError::BadTransition { .. } | SessionError::NeedsRestart(_) => 409,
            SessionError::Unit(_) | SessionError::Store(_) => 500,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ManagerConfig {
    pub max_sessions: u8,
}

impl Default for ManagerConfig {
    fn default() -> Self {
        ManagerConfig { max_sessions: 3 }
    }
}

pub struct Manager {
    store: Mutex<Store>,
    units: Arc<dyn UnitControl>,
    cfg: ManagerConfig,
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn fingerprint(name: &str, profile: Profile) -> String {
    format!("{}\u{1f}{}", name.trim(), profile.id())
}

/// Recent terminal sessions stay listed for a day.
const RECENT_MS: i64 = 24 * 3600 * 1000;

impl Manager {
    pub fn open(
        path: &Path,
        units: Arc<dyn UnitControl>,
        cfg: ManagerConfig,
    ) -> Result<Manager, SessionError> {
        Ok(Manager {
            store: Mutex::new(Store::open(path)?),
            units,
            cfg,
        })
    }

    pub fn in_memory(
        units: Arc<dyn UnitControl>,
        cfg: ManagerConfig,
    ) -> Result<Manager, SessionError> {
        Ok(Manager {
            store: Mutex::new(Store::in_memory()?),
            units,
            cfg,
        })
    }

    fn store(&self) -> std::sync::MutexGuard<'_, Store> {
        // A panic while holding the lock cannot leave SQLite half-written
        // (every multi-statement write is a transaction), so poisoning is
        // recovered rather than propagated.
        self.store.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Whether the session unit for `slot` is running (systemd's view).
    pub fn unit_active(&self, slot: u8) -> bool {
        self.units.is_active(slot)
    }

    pub fn max_sessions(&self) -> u8 {
        self.cfg.max_sessions
    }

    /// Creates a session and starts its unit. Returns `(record, created)`;
    /// `created == false` means an Idempotency-Key replay of an earlier call.
    /// The record comes back CREATING; the caller probes the display and moves
    /// it to READY or FAILED.
    pub fn create(
        &self,
        owner: &str,
        name: &str,
        profile: &str,
        idempotency_key: Option<&str>,
    ) -> Result<(SessionRecord, bool), SessionError> {
        if !valid_session_name(name) {
            return Err(SessionError::InvalidName);
        }
        let profile = Profile::parse(profile)
            .ok_or_else(|| SessionError::ProfileUnknown(profile.chars().take(32).collect()))?;
        let fp = fingerprint(name, profile);
        let mut st = self.store();
        if let Some(key) = idempotency_key {
            st.idem_prune(now_ms() - RECENT_MS)?;
            if let Some((prev_fp, sid)) = st.idem_get(owner, key)? {
                if prev_fp != fp {
                    return Err(SessionError::IdempotencyMismatch);
                }
                if let Some(rec) = st.get(&sid)? {
                    return Ok((rec, false));
                }
            }
        }
        let live = st.live()?;
        let profiles: Vec<Profile> = live.iter().map(|s| s.profile).collect();
        admits(&profiles, self.cfg.max_sessions as usize, profile)
            .map_err(SessionError::CapacityFull)?;
        let used: Vec<u8> = live.iter().filter_map(|s| s.slot).collect();
        let slot = free_slot(&used, self.cfg.max_sessions)
            .ok_or_else(|| SessionError::CapacityFull("No free slot.".into()))?;
        let now = now_ms();
        let rec = SessionRecord {
            id: uuid::Uuid::new_v4().simple().to_string(),
            name: name.trim().to_string(),
            profile,
            state: SessionState::Creating,
            slot: Some(slot),
            owner: owner.to_string(),
            created_at_ms: now,
            updated_at_ms: now,
            error: None,
        };
        st.insert(&rec)?;
        if let Some(key) = idempotency_key {
            st.idem_put(owner, key, &fp, &rec.id, now)?;
        }
        drop(st);
        tracing::info!(session = %rec.id, slot, profile = profile.id(), "starting session unit");
        if let Err(e) = self.units.start(slot, profile) {
            let msg = e.to_string();
            let _ = self.units.stop(slot);
            self.set_state(
                &rec.id,
                SessionState::Failed,
                Some(&msg),
                Some("unit start failed"),
            )?;
            return Err(SessionError::Unit(e));
        }
        Ok((rec, true))
    }

    pub fn get(&self, id: &str) -> Result<SessionRecord, SessionError> {
        // Session ids are 32 lowercase hex chars; anything else cannot be one
        // of ours and is refused without touching the database.
        if id.len() != 32 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(SessionError::NotFound);
        }
        self.store().get(id)?.ok_or(SessionError::NotFound)
    }

    pub fn list(&self) -> Result<Vec<SessionRecord>, SessionError> {
        Ok(self.store().list(now_ms(), RECENT_MS)?)
    }

    pub fn live(&self) -> Result<Vec<SessionRecord>, SessionError> {
        Ok(self.store().live()?)
    }

    /// Moves a session along the state table. A terminal state releases the
    /// slot. Same-state CONNECTED → CONNECTED is allowed (viewer replaced).
    pub fn set_state(
        &self,
        id: &str,
        to: SessionState,
        error: Option<&str>,
        note: Option<&str>,
    ) -> Result<SessionRecord, SessionError> {
        let mut st = self.store();
        let rec = st.get(id)?.ok_or(SessionError::NotFound)?;
        if !can_transition(rec.state, to) {
            return Err(SessionError::BadTransition {
                from: rec.state,
                to,
            });
        }
        let slot = if to.is_terminal() { None } else { rec.slot };
        let now = now_ms();
        st.update_state(id, rec.state, to, slot, error, note, now)?;
        tracing::info!(session = %id, from = rec.state.as_str(), to = to.as_str(), "state");
        Ok(SessionRecord {
            state: to,
            slot,
            updated_at_ms: now,
            error: error.map(str::to_string).or(rec.error),
            ..rec
        })
    }

    /// STOPPING → stop the unit → STOPPED. Idempotent for terminal sessions.
    pub fn stop(&self, id: &str) -> Result<SessionRecord, SessionError> {
        let rec = self.get(id)?;
        if rec.state.is_terminal() {
            return Ok(rec);
        }
        let rec = if rec.state == SessionState::Stopping {
            rec
        } else {
            self.set_state(id, SessionState::Stopping, None, Some("stop requested"))?
        };
        if let Some(slot) = rec.slot {
            if let Err(e) = self.units.stop(slot) {
                let msg = e.to_string();
                return self.set_state(
                    id,
                    SessionState::Failed,
                    Some(&msg),
                    Some("unit stop failed"),
                );
            }
        }
        self.set_state(id, SessionState::Stopped, None, Some("unit stopped"))
    }

    /// Marks a live session FAILED and stops its unit (best effort).
    pub fn fail(&self, id: &str, why: &str) -> Result<SessionRecord, SessionError> {
        let rec = self.get(id)?;
        if rec.state.is_terminal() {
            return Ok(rec);
        }
        if let Some(slot) = rec.slot {
            if let Err(e) = self.units.stop(slot) {
                tracing::warn!(session = %id, error = %e, "unit stop after failure");
            }
        }
        self.set_state(id, SessionState::Failed, Some(why), Some("failed"))
    }

    /// A live profile change keeps the display, so it may change only the
    /// frame rate (Xvfb 1.20 cannot resize: it exposes one RandR mode).
    pub fn change_profile(&self, id: &str, to: &str) -> Result<SessionRecord, SessionError> {
        let to = Profile::parse(to)
            .ok_or_else(|| SessionError::ProfileUnknown(to.chars().take(32).collect()))?;
        let mut st = self.store();
        let rec = st.get(id)?.ok_or(SessionError::NotFound)?;
        if !rec.state.is_viewable() {
            return Err(SessionError::BadTransition {
                from: rec.state,
                to: rec.state,
            });
        }
        if rec.profile == to {
            return Ok(rec);
        }
        if (to.width(), to.height()) != (rec.profile.width(), rec.profile.height()) {
            return Err(SessionError::NeedsRestart(format!(
                "{} -> {} changes the display size, which needs a new session (Xvfb cannot resize).",
                rec.profile.id(),
                to.id()
            )));
        }
        let others: Vec<Profile> = st
            .live()?
            .into_iter()
            .filter(|s| s.id != rec.id)
            .map(|s| s.profile)
            .collect();
        admits(&others, self.cfg.max_sessions as usize, to).map_err(SessionError::CapacityFull)?;
        st.update_profile(id, to, now_ms())?;
        Ok(SessionRecord { profile: to, ..rec })
    }

    pub fn capacity(&self) -> Result<CapacityView, SessionError> {
        let live = self.live()?;
        let profiles: Vec<Profile> = live.iter().map(|s| s.profile).collect();
        let max = self.cfg.max_sessions as u32;
        let running = live.len() as u32;
        let profiles = Profile::ALL
            .into_iter()
            .map(|p| {
                let r = admits(&profiles, max as usize, p);
                (
                    p.id().to_string(),
                    ProfileAllowance {
                        allowed: r.is_ok(),
                        reason: r.err(),
                    },
                )
            })
            .collect();
        Ok(CapacityView {
            max,
            running,
            profiles,
        })
    }

    /// After a supervisor restart: a live session whose unit is gone is
    /// STOPPED (through STOPPING, so the event log stays a valid path); one
    /// whose unit survived is returned for the caller to re-probe. CONNECTED
    /// becomes IDLE, because no viewer survives a restart.
    pub fn reconcile(&self) -> Result<Vec<SessionRecord>, SessionError> {
        let mut alive = Vec::new();
        for rec in self.live()? {
            let up = rec.slot.map(|s| self.units.is_active(s)).unwrap_or(false);
            if !up {
                if rec.state != SessionState::Stopping {
                    self.set_state(
                        &rec.id,
                        SessionState::Stopping,
                        None,
                        Some("unit gone at restart"),
                    )?;
                }
                self.set_state(
                    &rec.id,
                    SessionState::Stopped,
                    Some("unit was not running when the supervisor restarted"),
                    None,
                )?;
                continue;
            }
            let rec = if rec.state == SessionState::Connected {
                self.set_state(
                    &rec.id,
                    SessionState::Idle,
                    None,
                    Some("viewer lost at restart"),
                )?
            } else {
                rec
            };
            alive.push(rec);
        }
        Ok(alive)
    }

    /// A live session whose unit is no longer running (Xvfb crashed, the
    /// desktop was logged out, someone ran `systemctl stop`) is moved to
    /// STOPPED. Returns the ids reaped. CREATING sessions are left to their
    /// readiness probe.
    pub fn reap_dead(&self) -> Result<Vec<String>, SessionError> {
        let mut reaped = Vec::new();
        for rec in self.live()? {
            if matches!(rec.state, SessionState::Creating | SessionState::Stopping) {
                continue;
            }
            let up = rec.slot.map(|s| self.units.is_active(s)).unwrap_or(false);
            if !up {
                self.set_state(&rec.id, SessionState::Stopping, None, Some("unit exited"))?;
                self.set_state(
                    &rec.id,
                    SessionState::Stopped,
                    Some("the desktop unit exited on its own"),
                    None,
                )?;
                reaped.push(rec.id);
            }
        }
        Ok(reaped)
    }

    pub fn events(&self, id: &str) -> Result<Vec<(String, String)>, SessionError> {
        Ok(self.store().events_for(id)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[derive(Default)]
    struct FakeUnits {
        active: Mutex<BTreeMap<u8, Profile>>,
        fail_start: bool,
    }

    impl UnitControl for FakeUnits {
        fn start(&self, slot: u8, profile: Profile) -> Result<(), UnitError> {
            if self.fail_start {
                return Err(UnitError::Systemctl {
                    verb: "start",
                    unit: crate::units::unit_name(slot),
                    detail: "nope".into(),
                });
            }
            self.active.lock().unwrap().insert(slot, profile);
            Ok(())
        }
        fn stop(&self, slot: u8) -> Result<(), UnitError> {
            self.active.lock().unwrap().remove(&slot);
            Ok(())
        }
        fn is_active(&self, slot: u8) -> bool {
            self.active.lock().unwrap().contains_key(&slot)
        }
    }

    fn mgr() -> (Manager, Arc<FakeUnits>) {
        let u = Arc::new(FakeUnits::default());
        (
            Manager::in_memory(u.clone(), ManagerConfig::default()).unwrap(),
            u,
        )
    }

    #[test]
    fn create_allocates_slots_and_caps() {
        let (m, u) = mgr();
        let (a, created) = m.create("o", "a", "720p30", None).unwrap();
        assert!(created);
        assert_eq!(a.state, SessionState::Creating);
        assert_eq!(a.slot, Some(1));
        let (b, _) = m.create("o", "b", "720p30", None).unwrap();
        assert_eq!(b.slot, Some(2));
        let (c, _) = m.create("o", "c", "1080p30", None).unwrap();
        assert_eq!(c.slot, Some(3));
        let e = m.create("o", "d", "720p30", None).unwrap_err();
        assert_eq!(e.code(), "capacity/full");
        assert_eq!(u.active.lock().unwrap().len(), 3);
        let cap = m.capacity().unwrap();
        assert_eq!(cap.running, 3);
        assert!(!cap.profiles["720p30"].allowed);
        assert!(cap.profiles["720p30"].reason.is_some());
        // Stopping one frees its slot for reuse.
        m.stop(&b.id).unwrap();
        let (d, _) = m.create("o", "d", "720p30", None).unwrap();
        assert_eq!(d.slot, Some(2));
    }

    #[test]
    fn p60_runs_alone() {
        let (m, _) = mgr();
        let (a, _) = m.create("o", "a", "1080p60", None).unwrap();
        assert_eq!(
            m.create("o", "b", "720p30", None).unwrap_err().code(),
            "capacity/full"
        );
        assert!(!m.capacity().unwrap().profiles["720p30"].allowed);
        m.stop(&a.id).unwrap();
        m.create("o", "b", "720p30", None).unwrap();
        assert_eq!(
            m.create("o", "c", "1080p60", None).unwrap_err().code(),
            "capacity/full"
        );
    }

    #[test]
    fn idempotency_key_replays_and_detects_mismatch() {
        let (m, u) = mgr();
        let (a, c1) = m.create("o", "a", "720p30", Some("k1")).unwrap();
        let (b, c2) = m.create("o", "a", "720p30", Some("k1")).unwrap();
        assert!(c1 && !c2);
        assert_eq!(a.id, b.id);
        assert_eq!(u.active.lock().unwrap().len(), 1, "no second unit");
        assert_eq!(
            m.create("o", "other", "720p30", Some("k1"))
                .unwrap_err()
                .code(),
            "idempotency/mismatch"
        );
        // Keys are per owner.
        let (c, _) = m.create("p", "a", "720p30", Some("k1")).unwrap();
        assert_ne!(c.id, a.id);
    }

    #[test]
    fn validation() {
        let (m, _) = mgr();
        assert_eq!(
            m.create("o", "a", "4k", None).unwrap_err().code(),
            "profile/unknown"
        );
        assert_eq!(
            m.create("o", "", "720p30", None).unwrap_err().code(),
            "request/invalid"
        );
        assert_eq!(m.get("../../etc").unwrap_err().code(), "session/not-found");
        assert_eq!(
            m.get("0123456789abcdef0123456789abcdef")
                .unwrap_err()
                .code(),
            "session/not-found"
        );
    }

    #[test]
    fn lifecycle_and_event_log() {
        let (m, u) = mgr();
        let (a, _) = m.create("o", "a", "720p30", None).unwrap();
        m.set_state(&a.id, SessionState::Ready, None, None).unwrap();
        m.set_state(&a.id, SessionState::Connected, None, None)
            .unwrap();
        m.set_state(&a.id, SessionState::Idle, None, None).unwrap();
        assert_eq!(
            m.set_state(&a.id, SessionState::Stopped, None, None)
                .unwrap_err()
                .code(),
            "session/state"
        );
        let s = m.stop(&a.id).unwrap();
        assert_eq!(s.state, SessionState::Stopped);
        assert_eq!(s.slot, None);
        assert!(u.active.lock().unwrap().is_empty());
        // Stop is idempotent.
        assert_eq!(m.stop(&a.id).unwrap().state, SessionState::Stopped);
        let ev: Vec<String> = m.events(&a.id).unwrap().into_iter().map(|e| e.1).collect();
        assert_eq!(
            ev,
            [
                "CREATING",
                "READY",
                "CONNECTED",
                "IDLE",
                "STOPPING",
                "STOPPED"
            ]
        );
    }

    #[test]
    fn unit_start_failure_marks_failed_and_frees_slot() {
        let u = Arc::new(FakeUnits {
            fail_start: true,
            ..Default::default()
        });
        let m = Manager::in_memory(u, ManagerConfig::default()).unwrap();
        assert_eq!(
            m.create("o", "a", "720p30", None).unwrap_err().code(),
            "session/unit-failed"
        );
        assert_eq!(m.capacity().unwrap().running, 0);
        assert_eq!(m.list().unwrap()[0].state, SessionState::Failed);
    }

    #[test]
    fn live_profile_change_only_same_size() {
        let (m, _) = mgr();
        let (a, _) = m.create("o", "a", "1080p30", None).unwrap();
        m.set_state(&a.id, SessionState::Ready, None, None).unwrap();
        assert_eq!(
            m.change_profile(&a.id, "1080p60").unwrap().profile,
            Profile::P1080p60
        );
        assert_eq!(m.get(&a.id).unwrap().profile, Profile::P1080p60);
        assert_eq!(
            m.change_profile(&a.id, "720p30").unwrap_err().code(),
            "profile/needs-restart"
        );
        // 1080p60 must be alone.
        m.change_profile(&a.id, "1080p30").unwrap();
        m.create("o", "b", "720p30", None).unwrap();
        assert_eq!(
            m.change_profile(&a.id, "1080p60").unwrap_err().code(),
            "capacity/full"
        );
    }

    #[test]
    fn reconcile_after_restart() {
        let (m, u) = mgr();
        let (a, _) = m.create("o", "a", "720p30", None).unwrap();
        let (b, _) = m.create("o", "b", "720p30", None).unwrap();
        m.set_state(&a.id, SessionState::Ready, None, None).unwrap();
        m.set_state(&a.id, SessionState::Connected, None, None)
            .unwrap();
        // b's unit died while the supervisor was down.
        u.active.lock().unwrap().remove(&2);
        let alive = m.reconcile().unwrap();
        assert_eq!(alive.len(), 1);
        assert_eq!(alive[0].id, a.id);
        assert_eq!(alive[0].state, SessionState::Idle);
        assert_eq!(m.get(&b.id).unwrap().state, SessionState::Stopped);
    }

    #[test]
    fn reaps_sessions_whose_unit_died() {
        let (m, u) = mgr();
        let (a, _) = m.create("o", "a", "720p30", None).unwrap();
        let (b, _) = m.create("o", "b", "720p30", None).unwrap();
        m.set_state(&a.id, SessionState::Ready, None, None).unwrap();
        m.set_state(&b.id, SessionState::Ready, None, None).unwrap();
        assert!(m.reap_dead().unwrap().is_empty());
        u.active.lock().unwrap().remove(&1);
        assert_eq!(m.reap_dead().unwrap(), vec![a.id.clone()]);
        assert_eq!(m.get(&a.id).unwrap().state, SessionState::Stopped);
        assert_eq!(m.get(&b.id).unwrap().state, SessionState::Ready);
        assert_eq!(m.capacity().unwrap().running, 1);
    }

    #[test]
    fn view_matches_contract() {
        let (m, _) = mgr();
        let (a, _) = m.create("o", "work", "1080p60", None).unwrap();
        let v = a.view();
        assert_eq!((v.width, v.height, v.fps), (1920, 1080, 60));
        assert!(v.created_at.ends_with('Z'));
    }
}
