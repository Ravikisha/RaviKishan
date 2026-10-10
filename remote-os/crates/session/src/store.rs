//! SQLite metadata: sessions, idempotency keys, and an append-only event log
//! of every state change. One file under the supervisor's StateDirectory.

use std::path::Path;

use protocol::{Profile, SessionState};
use rusqlite::{params, Connection, OptionalExtension};

use crate::manager::SessionRecord;

pub struct Store {
    conn: Connection,
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  profile     TEXT NOT NULL,
  state       TEXT NOT NULL,
  slot        INTEGER,
  owner       TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS sessions_state ON sessions(state);
CREATE TABLE IF NOT EXISTS idempotency (
  owner       TEXT NOT NULL,
  key         TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (owner, key)
);
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  at          INTEGER NOT NULL,
  from_state  TEXT,
  to_state    TEXT NOT NULL,
  note        TEXT
);
";

fn row_to_record(r: &rusqlite::Row<'_>) -> rusqlite::Result<SessionRecord> {
    let profile: String = r.get("profile")?;
    let state: String = r.get("state")?;
    let slot: Option<i64> = r.get("slot")?;
    Ok(SessionRecord {
        id: r.get("id")?,
        name: r.get("name")?,
        profile: Profile::parse(&profile).unwrap_or(Profile::P720p30),
        state: SessionState::parse(&state).unwrap_or(SessionState::Failed),
        slot: slot.and_then(|s| u8::try_from(s).ok()),
        owner: r.get("owner")?,
        created_at_ms: r.get("created_at")?,
        updated_at_ms: r.get("updated_at")?,
        error: r.get("error")?,
    })
}

impl Store {
    pub fn open(path: &Path) -> rusqlite::Result<Store> {
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.execute_batch(SCHEMA)?;
        Ok(Store { conn })
    }

    pub fn in_memory() -> rusqlite::Result<Store> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(SCHEMA)?;
        Ok(Store { conn })
    }

    pub fn insert(&mut self, s: &SessionRecord) -> rusqlite::Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute(
            "INSERT INTO sessions (id,name,profile,state,slot,owner,created_at,updated_at,error)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                s.id,
                s.name,
                s.profile.id(),
                s.state.as_str(),
                s.slot.map(i64::from),
                s.owner,
                s.created_at_ms,
                s.updated_at_ms,
                s.error
            ],
        )?;
        tx.execute(
            "INSERT INTO events (session_id,at,from_state,to_state,note) VALUES (?1,?2,NULL,?3,'created')",
            params![s.id, s.created_at_ms, s.state.as_str()],
        )?;
        tx.commit()
    }

    pub fn get(&self, id: &str) -> rusqlite::Result<Option<SessionRecord>> {
        self.conn
            .query_row(
                "SELECT * FROM sessions WHERE id = ?1",
                params![id],
                row_to_record,
            )
            .optional()
    }

    /// Live sessions, plus terminal ones updated in the last `recent_ms`.
    pub fn list(&self, now_ms: i64, recent_ms: i64) -> rusqlite::Result<Vec<SessionRecord>> {
        let mut st = self.conn.prepare(
            "SELECT * FROM sessions
             WHERE state NOT IN ('STOPPED','FAILED') OR updated_at >= ?1
             ORDER BY created_at DESC LIMIT 100",
        )?;
        let rows = st.query_map(params![now_ms - recent_ms], row_to_record)?;
        rows.collect()
    }

    pub fn live(&self) -> rusqlite::Result<Vec<SessionRecord>> {
        let mut st = self.conn.prepare(
            "SELECT * FROM sessions WHERE state NOT IN ('STOPPED','FAILED') ORDER BY created_at",
        )?;
        let rows = st.query_map([], row_to_record)?;
        rows.collect()
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update_state(
        &mut self,
        id: &str,
        from: SessionState,
        to: SessionState,
        slot: Option<u8>,
        error: Option<&str>,
        note: Option<&str>,
        now_ms: i64,
    ) -> rusqlite::Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute(
            "UPDATE sessions SET state=?2, slot=?3, error=COALESCE(?4,error), updated_at=?5 WHERE id=?1",
            params![id, to.as_str(), slot.map(i64::from), error, now_ms],
        )?;
        tx.execute(
            "INSERT INTO events (session_id,at,from_state,to_state,note) VALUES (?1,?2,?3,?4,?5)",
            params![id, now_ms, from.as_str(), to.as_str(), note],
        )?;
        tx.commit()
    }

    pub fn update_profile(
        &mut self,
        id: &str,
        profile: Profile,
        now_ms: i64,
    ) -> rusqlite::Result<()> {
        self.conn.execute(
            "UPDATE sessions SET profile=?2, updated_at=?3 WHERE id=?1",
            params![id, profile.id(), now_ms],
        )?;
        Ok(())
    }

    pub fn idem_get(&self, owner: &str, key: &str) -> rusqlite::Result<Option<(String, String)>> {
        self.conn
            .query_row(
                "SELECT fingerprint, session_id FROM idempotency WHERE owner=?1 AND key=?2",
                params![owner, key],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
    }

    pub fn idem_put(
        &mut self,
        owner: &str,
        key: &str,
        fingerprint: &str,
        session_id: &str,
        now_ms: i64,
    ) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO idempotency (owner,key,fingerprint,session_id,created_at) VALUES (?1,?2,?3,?4,?5)",
            params![owner, key, fingerprint, session_id, now_ms],
        )?;
        Ok(())
    }

    /// Idempotency keys are honoured for 24 h.
    pub fn idem_prune(&mut self, older_than_ms: i64) -> rusqlite::Result<usize> {
        self.conn.execute(
            "DELETE FROM idempotency WHERE created_at < ?1",
            params![older_than_ms],
        )
    }

    pub fn events_for(&self, id: &str) -> rusqlite::Result<Vec<(String, String)>> {
        let mut st = self.conn.prepare(
            "SELECT COALESCE(from_state,''), to_state FROM events WHERE session_id=?1 ORDER BY id",
        )?;
        let rows = st.query_map(params![id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect()
    }
}
