//! The lifecycle, as a table. Anything not listed is refused.
//!
//! ```text
//! CREATING ─► READY ─► CONNECTED ⇄ IDLE
//!     │         │          │        │
//!     └─────────┴──► STOPPING ◄─────┘ ─► STOPPED
//!  (any live state) ─► FAILED
//! ```

use protocol::SessionState::{self, *};

pub fn can_transition(from: SessionState, to: SessionState) -> bool {
    matches!(
        (from, to),
        (Creating, Ready)
            | (Creating, Stopping)
            | (Creating, Failed)
            | (Ready, Connected)
            | (Ready, Stopping)
            | (Ready, Failed)
            | (Connected, Connected)
            | (Connected, Idle)
            | (Connected, Stopping)
            | (Connected, Failed)
            | (Idle, Connected)
            | (Idle, Stopping)
            | (Idle, Failed)
            | (Stopping, Stopped)
            | (Stopping, Failed)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_states_go_nowhere() {
        for to in SessionState::ALL {
            assert!(!can_transition(Stopped, to));
            assert!(!can_transition(Failed, to));
        }
    }

    #[test]
    fn happy_path() {
        let path = [
            Creating, Ready, Connected, Idle, Connected, Stopping, Stopped,
        ];
        for w in path.windows(2) {
            assert!(can_transition(w[0], w[1]), "{:?} -> {:?}", w[0], w[1]);
        }
    }

    #[test]
    fn cannot_skip_stopping() {
        for from in [Creating, Ready, Connected, Idle] {
            assert!(!can_transition(from, Stopped));
        }
        assert!(!can_transition(Creating, Connected));
        assert!(!can_transition(Stopping, Ready));
    }

    #[test]
    fn every_live_state_can_fail_and_stop() {
        for from in [Creating, Ready, Connected, Idle] {
            assert!(can_transition(from, Failed));
            assert!(can_transition(from, Stopping));
        }
    }
}
