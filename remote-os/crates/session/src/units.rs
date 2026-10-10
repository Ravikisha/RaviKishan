//! Starting and stopping session units.
//!
//! The supervisor runs as `remoteos` and a polkit rule lets that user
//! start/stop ONLY `remote-os-session@[1-3].service`. This side refuses any
//! slot outside 1..=max before a process is even spawned, so a bug upstream
//! cannot turn into `systemctl stop <something else>`.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

use protocol::Profile;

#[derive(Debug, thiserror::Error)]
pub enum UnitError {
    #[error("slot {0} is not one this supervisor manages")]
    BadSlot(u8),
    #[error("systemctl {verb} {unit} failed: {detail}")]
    Systemctl {
        verb: &'static str,
        unit: String,
        detail: String,
    },
    #[error("could not write {path}: {err}")]
    EnvFile { path: String, err: String },
}

pub trait UnitControl: Send + Sync {
    /// Writes the profile for the unit, then starts it.
    fn start(&self, slot: u8, profile: Profile) -> Result<(), UnitError>;
    fn stop(&self, slot: u8) -> Result<(), UnitError>;
    fn is_active(&self, slot: u8) -> bool;
}

pub fn unit_name(slot: u8) -> String {
    format!("remote-os-session@{slot}.service")
}

/// Content of `/run/remote-os/session-<slot>.env`, read by systemd (as root)
/// for the unit's environment. Only numbers and a known profile id — nothing
/// a client typed.
pub fn env_file_contents(profile: Profile) -> String {
    format!(
        "RO_WIDTH={}\nRO_HEIGHT={}\nRO_FPS={}\nRO_PROFILE={}\n",
        profile.width(),
        profile.height(),
        profile.fps(),
        profile.id()
    )
}

pub fn write_env_file(dir: &Path, slot: u8, profile: Profile) -> Result<PathBuf, UnitError> {
    let path = dir.join(format!("session-{slot}.env"));
    let tmp = dir.join(format!(".session-{slot}.env.tmp"));
    let res = (|| -> std::io::Result<()> {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(env_file_contents(profile).as_bytes())?;
        f.sync_all()?;
        std::fs::rename(&tmp, &path)
    })();
    res.map_err(|e| UnitError::EnvFile {
        path: path.display().to_string(),
        err: e.to_string(),
    })?;
    Ok(path)
}

pub struct SystemctlUnits {
    pub max_slot: u8,
    pub env_dir: PathBuf,
    pub systemctl: PathBuf,
}

impl SystemctlUnits {
    pub fn new(max_slot: u8, env_dir: PathBuf) -> SystemctlUnits {
        SystemctlUnits {
            max_slot,
            env_dir,
            systemctl: PathBuf::from("/usr/bin/systemctl"),
        }
    }

    fn check(&self, slot: u8) -> Result<String, UnitError> {
        if slot == 0 || slot > self.max_slot {
            return Err(UnitError::BadSlot(slot));
        }
        Ok(unit_name(slot))
    }

    fn run(&self, verb: &'static str, unit: &str) -> Result<(), UnitError> {
        let out = Command::new(&self.systemctl)
            .args(["--no-ask-password", verb, unit])
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .output()
            .map_err(|e| UnitError::Systemctl {
                verb,
                unit: unit.into(),
                detail: e.to_string(),
            })?;
        if out.status.success() {
            Ok(())
        } else {
            Err(UnitError::Systemctl {
                verb,
                unit: unit.into(),
                detail: String::from_utf8_lossy(&out.stderr)
                    .trim()
                    .chars()
                    .take(300)
                    .collect(),
            })
        }
    }
}

impl UnitControl for SystemctlUnits {
    fn start(&self, slot: u8, profile: Profile) -> Result<(), UnitError> {
        let unit = self.check(slot)?;
        write_env_file(&self.env_dir, slot, profile)?;
        self.run("start", &unit)
    }

    fn stop(&self, slot: u8) -> Result<(), UnitError> {
        let unit = self.check(slot)?;
        self.run("stop", &unit)
    }

    fn is_active(&self, slot: u8) -> bool {
        let Ok(unit) = self.check(slot) else {
            return false;
        };
        Command::new(&self.systemctl)
            .args(["is-active", "--quiet", &unit])
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_foreign_slots_before_spawning() {
        let u = SystemctlUnits {
            max_slot: 3,
            env_dir: std::env::temp_dir(),
            // A path that does not exist: if check() let a bad slot through,
            // the error would be a spawn failure, not BadSlot.
            systemctl: PathBuf::from("/nonexistent/systemctl"),
        };
        assert!(matches!(u.stop(0), Err(UnitError::BadSlot(0))));
        assert!(matches!(u.stop(4), Err(UnitError::BadSlot(4))));
        assert!(matches!(
            u.start(9, Profile::P720p30),
            Err(UnitError::BadSlot(9))
        ));
        assert!(!u.is_active(7));
        assert_eq!(unit_name(2), "remote-os-session@2.service");
    }

    #[test]
    fn env_file_is_numbers_only() {
        let s = env_file_contents(Profile::P1080p60);
        assert_eq!(
            s,
            "RO_WIDTH=1920\nRO_HEIGHT=1080\nRO_FPS=60\nRO_PROFILE=1080p60\n"
        );
        let dir = std::env::temp_dir().join(format!("ro-env-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = write_env_file(&dir, 2, Profile::P720p30).unwrap();
        assert_eq!(
            std::fs::read_to_string(p).unwrap(),
            env_file_contents(Profile::P720p30)
        );
        std::fs::remove_dir_all(dir).ok();
    }
}
