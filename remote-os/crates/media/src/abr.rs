//! Adaptive bitrate, pure. Input: the receiver's loss fraction and RTT from
//! its RTCP report, once a second. Output: the x264 VBV cap. Multiplicative
//! decrease on loss, slow additive increase after a run of clean seconds —
//! the shape that keeps a TCP-carried TURN path (where loss shows up as
//! queueing, i.e. rising RTT) from oscillating.

#[derive(Debug, Clone)]
pub struct Abr {
    floor: u32,
    ceiling: u32,
    cap: u32,
    clean: u32,
    min_rtt: Option<f64>,
}

impl Abr {
    pub fn new(floor_kbps: u32, ceiling_kbps: u32) -> Abr {
        Abr {
            floor: floor_kbps,
            ceiling: ceiling_kbps,
            cap: ceiling_kbps,
            clean: 0,
            min_rtt: None,
        }
    }

    pub fn cap(&self) -> u32 {
        self.cap
    }

    /// One observation per second. Returns `Some(new_cap)` when the cap moved.
    pub fn observe(&mut self, loss: Option<f64>, rtt_ms: Option<f64>) -> Option<u32> {
        let before = self.cap;
        if let Some(r) = rtt_ms.filter(|r| r.is_finite() && *r > 0.0) {
            self.min_rtt = Some(self.min_rtt.map_or(r, |m| m.min(r)));
        }
        // Over TCP, congestion is queueing: RTT well above its floor.
        let queueing = match (rtt_ms, self.min_rtt) {
            (Some(r), Some(m)) if r.is_finite() => r > m * 2.5 && r > m + 150.0,
            _ => false,
        };
        let loss = loss
            .filter(|l| l.is_finite())
            .unwrap_or(0.0)
            .clamp(0.0, 1.0);
        if loss > 0.10 {
            self.cap = (self.cap as f64 * 0.7) as u32;
            self.clean = 0;
        } else if loss > 0.03 || queueing {
            self.cap = (self.cap as f64 * 0.85) as u32;
            self.clean = 0;
        } else if loss < 0.01 {
            self.clean += 1;
            if self.clean >= 3 {
                self.cap += self.ceiling / 20;
            }
        } else {
            self.clean = 0;
        }
        self.cap = self.cap.clamp(self.floor, self.ceiling);
        // Ignore moves under 2%: each change reconfigures x264.
        if self.cap.abs_diff(before) * 50 > before {
            Some(self.cap)
        } else {
            self.cap = before;
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backs_off_and_recovers() {
        let mut a = Abr::new(750, 2500);
        assert_eq!(a.observe(Some(0.0), Some(60.0)), None);
        assert_eq!(a.observe(Some(0.2), Some(60.0)), Some(1750));
        assert_eq!(a.observe(Some(0.2), Some(60.0)), Some(1225));
        assert_eq!(a.observe(Some(0.2), Some(60.0)), Some(857));
        assert_eq!(a.observe(Some(0.2), Some(60.0)), Some(750), "floor");
        assert_eq!(a.observe(Some(0.2), Some(60.0)), None);
        // Three clean seconds before growth.
        assert_eq!(a.observe(Some(0.0), Some(60.0)), None);
        assert_eq!(a.observe(Some(0.0), Some(60.0)), None);
        assert_eq!(a.observe(Some(0.0), Some(60.0)), Some(875));
        for _ in 0..100 {
            a.observe(Some(0.0), Some(60.0));
        }
        assert_eq!(a.cap(), 2500, "ceiling");
    }

    #[test]
    fn rtt_queueing_counts_as_congestion() {
        let mut a = Abr::new(750, 2500);
        a.observe(None, Some(60.0));
        assert_eq!(a.observe(None, Some(400.0)), Some(2125));
    }

    #[test]
    fn garbage_is_harmless() {
        let mut a = Abr::new(750, 2500);
        assert_eq!(a.observe(Some(f64::NAN), Some(f64::INFINITY)), None);
        assert_eq!(a.observe(Some(-5.0), Some(-1.0)), None);
        assert_eq!(a.cap(), 2500);
    }
}
