//! Session lifecycle for the supervisor.
//!
//! A SESSION is one isolated desktop: unix user `rdesk<slot>`, Xvfb on
//! display `:2<slot>`, run by `remote-os-session@<slot>.service`. The slot is
//! the only thing that ties a session id to a unit, and the supervisor only
//! ever names units for slots it allocated itself — a session id it did not
//! create resolves to nothing.

pub mod capacity;
pub mod manager;
pub mod state;
pub mod store;
pub mod units;

pub use manager::{Manager, ManagerConfig, SessionError, SessionRecord};
pub use units::{SystemctlUnits, UnitControl, UnitError};

/// Display number for a slot: slot 1 → `:21`.
pub fn display_for_slot(slot: u8) -> String {
    format!(":2{slot}")
}

/// Unix user for a slot.
pub fn user_for_slot(slot: u8) -> String {
    format!("rdesk{slot}")
}

/// The X cookie the session unit writes into its RuntimeDirectory
/// (`/run/remote-os-session-<slot>/Xauthority`, rdesk<slot>:rdesk<slot> 0640).
pub fn cookie_path_for_slot(slot: u8) -> std::path::PathBuf {
    std::path::PathBuf::from(format!("/run/remote-os-session-{slot}/Xauthority"))
}
