//! Admission rule, pure: at most `max` live sessions, and 1080p60 only alone
//! (the spike measured it at ~half the box by itself).

use protocol::Profile;

pub fn admits(active: &[Profile], max: usize, new: Profile) -> Result<(), String> {
    if active.len() >= max {
        return Err(format!("All {max} session slots are in use."));
    }
    if active.iter().any(|p| p.exclusive()) {
        return Err(
            "A 1080p60 session is running; 1080p60 runs only when it is the only session.".into(),
        );
    }
    if new.exclusive() && !active.is_empty() {
        return Err(format!(
            "1080p60 runs only when it is the only session; {} other session(s) are running.",
            active.len()
        ));
    }
    Ok(())
}

/// Lowest slot in 1..=max not in `used`.
pub fn free_slot(used: &[u8], max: u8) -> Option<u8> {
    (1..=max).find(|s| !used.contains(s))
}

#[cfg(test)]
mod tests {
    use super::*;
    use Profile::*;

    #[test]
    fn caps_at_max() {
        assert!(admits(&[], 3, P720p30).is_ok());
        assert!(admits(&[P720p30, P720p30], 3, P1080p30).is_ok());
        assert!(admits(&[P720p30, P720p30, P720p30], 3, P720p30).is_err());
    }

    #[test]
    fn p60_only_alone() {
        assert!(admits(&[], 3, P1080p60).is_ok());
        assert!(admits(&[P720p30], 3, P1080p60).is_err());
        assert!(admits(&[P1080p60], 3, P720p30).is_err());
    }

    #[test]
    fn slots() {
        assert_eq!(free_slot(&[], 3), Some(1));
        assert_eq!(free_slot(&[1, 3], 3), Some(2));
        assert_eq!(free_slot(&[1, 2, 3], 3), None);
    }
}
