//! The Xauthority file format: a sequence of entries, each
//! `family:u16be` then four `len:u16be + bytes` fields (address, display
//! number, auth name, auth data).

use std::io::Write;
use std::path::Path;

pub const FAMILY_LOCAL: u16 = 256;
pub const FAMILY_WILD: u16 = 0xffff;
pub const MIT_MAGIC_COOKIE: &[u8] = b"MIT-MAGIC-COOKIE-1";

#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    pub family: u16,
    pub address: Vec<u8>,
    pub number: Vec<u8>,
    pub name: Vec<u8>,
    pub data: Vec<u8>,
}

impl Entry {
    pub fn wild(number: &str, cookie: Vec<u8>) -> Entry {
        Entry {
            family: FAMILY_WILD,
            address: Vec::new(),
            number: number.as_bytes().to_vec(),
            name: MIT_MAGIC_COOKIE.to_vec(),
            data: cookie,
        }
    }
}

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum XauthError {
    #[error("truncated Xauthority entry")]
    Truncated,
}

fn take<'a>(b: &mut &'a [u8], n: usize) -> Result<&'a [u8], XauthError> {
    if b.len() < n {
        return Err(XauthError::Truncated);
    }
    let (h, t) = b.split_at(n);
    *b = t;
    Ok(h)
}

fn u16be(b: &mut &[u8]) -> Result<u16, XauthError> {
    let x = take(b, 2)?;
    Ok(u16::from_be_bytes([x[0], x[1]]))
}

fn field(b: &mut &[u8]) -> Result<Vec<u8>, XauthError> {
    let n = u16be(b)? as usize;
    Ok(take(b, n)?.to_vec())
}

pub fn parse(mut b: &[u8]) -> Result<Vec<Entry>, XauthError> {
    let mut out = Vec::new();
    while !b.is_empty() {
        let family = u16be(&mut b)?;
        out.push(Entry {
            family,
            address: field(&mut b)?,
            number: field(&mut b)?,
            name: field(&mut b)?,
            data: field(&mut b)?,
        });
    }
    Ok(out)
}

pub fn serialize(entries: &[Entry]) -> Vec<u8> {
    let mut out = Vec::new();
    for e in entries {
        out.extend_from_slice(&e.family.to_be_bytes());
        for f in [&e.address, &e.number, &e.name, &e.data] {
            out.extend_from_slice(&(f.len() as u16).to_be_bytes());
            out.extend_from_slice(f);
        }
    }
    out
}

/// The MIT cookie for display `number` ("21"), whatever family it was
/// written under (xauth writes FamilyLocal with the hostname).
pub fn cookie_for(entries: &[Entry], number: &str) -> Option<Vec<u8>> {
    entries
        .iter()
        .find(|e| e.number == number.as_bytes() && e.name == MIT_MAGIC_COOKIE)
        .map(|e| e.data.clone())
}

/// Writes `entries` to `path` via a 0600 temp file and a rename, so a reader
/// never sees a half-written file.
pub fn write_atomic(path: &Path, entries: &[Entry]) -> std::io::Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    let tmp = path.with_extension("tmp");
    let _ = std::fs::remove_file(&tmp);
    {
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&tmp)?;
        f.write_all(&serialize(entries))?;
        f.sync_all()?;
    }
    std::fs::rename(tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let e = vec![
            Entry {
                family: FAMILY_LOCAL,
                address: b"jarvis".to_vec(),
                number: b"21".to_vec(),
                name: MIT_MAGIC_COOKIE.to_vec(),
                data: vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
            },
            Entry::wild("22", vec![9; 16]),
        ];
        let b = serialize(&e);
        assert_eq!(parse(&b).unwrap(), e);
        assert_eq!(cookie_for(&e, "21").unwrap()[0], 1);
        assert_eq!(cookie_for(&e, "22").unwrap(), vec![9; 16]);
        assert_eq!(cookie_for(&e, "23"), None);
    }

    #[test]
    fn truncated_input_is_an_error_not_a_panic() {
        let b = serialize(&[Entry::wild("21", vec![7; 16])]);
        for n in 1..b.len() {
            assert_eq!(parse(&b[..n]), Err(XauthError::Truncated), "len {n}");
        }
        assert_eq!(parse(&[]).unwrap(), vec![]);
    }

    #[test]
    fn atomic_write_is_private() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("xauth-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("xauthority");
        write_atomic(&p, &[Entry::wild("21", vec![1; 16])]).unwrap();
        let mode = std::fs::metadata(&p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        assert_eq!(parse(&std::fs::read(&p).unwrap()).unwrap().len(), 1);
        std::fs::remove_dir_all(dir).ok();
    }
}
