//! Wire types shared by every remote-os crate.
//!
//! Everything a browser can send arrives through one of the parsers here, so
//! the limits in the Milestone 1 contract (message size, rate, sequence
//! numbers, field ranges) are enforced in ONE place that has no I/O and is
//! exhaustively unit-tested. The supervisor never hands raw client text to
//! GStreamer or to X.

pub mod input;
pub mod profile;
pub mod rest;
pub mod signal;
pub mod status;

pub use profile::Profile;
pub use rest::SessionState;
