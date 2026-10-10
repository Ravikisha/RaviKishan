//! `KeyboardEvent.code` → X keysym.
//!
//! `code` names a PHYSICAL key, independent of the viewer's layout, so the
//! table gives the unshifted US keysym for each key; the X server's own
//! keymap (Xvfb: us) then decides what the key types, and Shift arrives as
//! its own `ShiftLeft` press. That is what makes shortcuts and games behave.
//! When `code` is empty or unknown (some IMEs and virtual keyboards) the
//! printable `key` is used instead.

pub fn keysym_for_code(code: &str) -> Option<u32> {
    if let Some(c) = code.strip_prefix("Key") {
        let b = c.as_bytes();
        if b.len() == 1 && b[0].is_ascii_uppercase() {
            return Some((b[0].to_ascii_lowercase()) as u32);
        }
    }
    if let Some(d) = code.strip_prefix("Digit") {
        let b = d.as_bytes();
        if b.len() == 1 && b[0].is_ascii_digit() {
            return Some(b[0] as u32);
        }
    }
    if let Some(n) = code.strip_prefix('F') {
        if let Ok(n) = n.parse::<u32>() {
            if (1..=24).contains(&n) {
                return Some(0xffbe + n - 1);
            }
        }
    }
    if let Some(d) = code.strip_prefix("Numpad") {
        let b = d.as_bytes();
        if b.len() == 1 && b[0].is_ascii_digit() {
            return Some(0xffb0 + (b[0] - b'0') as u32);
        }
    }
    Some(match code {
        "Enter" => 0xff0d,
        "Escape" => 0xff1b,
        "Backspace" => 0xff08,
        "Tab" => 0xff09,
        "Space" => 0x20,
        "Minus" => 0x2d,
        "Equal" => 0x3d,
        "BracketLeft" => 0x5b,
        "BracketRight" => 0x5d,
        "Backslash" => 0x5c,
        "IntlBackslash" => 0x3c,
        "Semicolon" => 0x3b,
        "Quote" => 0x27,
        "Backquote" => 0x60,
        "Comma" => 0x2c,
        "Period" => 0x2e,
        "Slash" => 0x2f,
        "CapsLock" => 0xffe5,
        "PrintScreen" => 0xff61,
        "ScrollLock" => 0xff14,
        "Pause" => 0xff13,
        "Insert" => 0xff63,
        "Home" => 0xff50,
        "PageUp" => 0xff55,
        "Delete" => 0xffff,
        "End" => 0xff57,
        "PageDown" => 0xff56,
        "ArrowRight" => 0xff53,
        "ArrowLeft" => 0xff51,
        "ArrowDown" => 0xff54,
        "ArrowUp" => 0xff52,
        "NumLock" => 0xff7f,
        "NumpadDivide" => 0xffaf,
        "NumpadMultiply" => 0xffaa,
        "NumpadSubtract" => 0xffad,
        "NumpadAdd" => 0xffab,
        "NumpadEnter" => 0xff8d,
        "NumpadDecimal" => 0xffae,
        "NumpadEqual" => 0xffbd,
        "ContextMenu" => 0xff67,
        "ControlLeft" => 0xffe3,
        "ControlRight" => 0xffe4,
        "ShiftLeft" => 0xffe1,
        "ShiftRight" => 0xffe2,
        "AltLeft" => 0xffe9,
        "AltRight" => 0xffea,
        "MetaLeft" | "OSLeft" => 0xffeb,
        "MetaRight" | "OSRight" => 0xffec,
        _ => return None,
    })
}

/// Named `key` values that are not single characters.
fn keysym_for_named_key(key: &str) -> Option<u32> {
    Some(match key {
        "Enter" => 0xff0d,
        "Escape" => 0xff1b,
        "Backspace" => 0xff08,
        "Tab" => 0xff09,
        "Delete" => 0xffff,
        "Home" => 0xff50,
        "End" => 0xff57,
        "PageUp" => 0xff55,
        "PageDown" => 0xff56,
        "ArrowRight" => 0xff53,
        "ArrowLeft" => 0xff51,
        "ArrowDown" => 0xff54,
        "ArrowUp" => 0xff52,
        "Shift" => 0xffe1,
        "Control" => 0xffe3,
        "Alt" => 0xffe9,
        "Meta" => 0xffeb,
        _ => return None,
    })
}

/// Keysym for a single printable character: Latin-1 maps to itself, the rest
/// of Unicode to `0x01000000 | codepoint` (X's Unicode keysym range).
pub fn keysym_for_char(c: char) -> Option<u32> {
    let cp = c as u32;
    if c.is_control() {
        return None;
    }
    if (0x20..=0x7e).contains(&cp) || (0xa0..=0xff).contains(&cp) {
        Some(cp)
    } else {
        Some(0x0100_0000 | cp)
    }
}

/// How a key event should be resolved.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyTarget {
    /// A physical key: any keycode carrying this keysym in any column.
    Physical(u32),
    /// A character: needs a keycode that types it WITHOUT modifiers, so a
    /// keysym found only in a shifted column gets a scratch keycode instead.
    Character(u32),
}

impl KeyTarget {
    pub fn keysym(self) -> u32 {
        match self {
            KeyTarget::Physical(k) | KeyTarget::Character(k) => k,
        }
    }
}

pub fn resolve(code: &str, key: &str) -> Option<KeyTarget> {
    if let Some(ks) = keysym_for_code(code) {
        return Some(KeyTarget::Physical(ks));
    }
    if let Some(ks) = keysym_for_named_key(key) {
        return Some(KeyTarget::Physical(ks));
    }
    let mut chars = key.chars();
    match (chars.next(), chars.next()) {
        (Some(c), None) => keysym_for_char(c).map(KeyTarget::Character),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn physical_keys() {
        assert_eq!(keysym_for_code("KeyA"), Some(0x61));
        assert_eq!(keysym_for_code("KeyZ"), Some(0x7a));
        assert_eq!(keysym_for_code("Digit0"), Some(0x30));
        assert_eq!(keysym_for_code("F1"), Some(0xffbe));
        assert_eq!(keysym_for_code("F12"), Some(0xffc9));
        assert_eq!(keysym_for_code("Numpad7"), Some(0xffb7));
        assert_eq!(keysym_for_code("ShiftLeft"), Some(0xffe1));
        assert_eq!(keysym_for_code("Enter"), Some(0xff0d));
        assert_eq!(keysym_for_code("Keya"), None);
        assert_eq!(keysym_for_code("F0"), None);
        assert_eq!(keysym_for_code("F25"), None);
        assert_eq!(keysym_for_code("Unidentified"), None);
    }

    #[test]
    fn code_wins_over_key() {
        // AZERTY "a" key sends code KeyQ: the physical key is what is pressed.
        assert_eq!(resolve("KeyQ", "a"), Some(KeyTarget::Physical(0x71)));
    }

    #[test]
    fn character_fallback() {
        assert_eq!(resolve("", "é"), Some(KeyTarget::Character(0xe9)));
        assert_eq!(resolve("", "€"), Some(KeyTarget::Character(0x0100_20ac)));
        assert_eq!(resolve("", "@"), Some(KeyTarget::Character(0x40)));
        assert_eq!(resolve("", "Enter"), Some(KeyTarget::Physical(0xff0d)));
        assert_eq!(resolve("", "Dead"), None);
        assert_eq!(resolve("", ""), None);
        assert_eq!(resolve("", "ab"), None);
    }
}
