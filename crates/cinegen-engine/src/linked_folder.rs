use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StabilityState {
    Pending,
    StableReady,
}

#[derive(Debug, Clone, Copy)]
struct FileProbe {
    size_bytes: u64,
    mtime_ms: i64,
    observed_at_ms: i64,
}

#[derive(Default)]
pub struct LinkedFolderStabilityChecker {
    latest: HashMap<String, FileProbe>,
    stable_counts: HashMap<String, u8>,
}

impl LinkedFolderStabilityChecker {
    pub const DEBOUNCE_MS: i64 = 1_500;
    pub const STABILITY_CHECK_INTERVAL_MS: i64 = 2_000;
    pub const REQUIRED_STABLE_CHECKS: u8 = 3;

    pub fn should_scan_event(last_scan_at_ms: Option<i64>, event_at_ms: i64) -> bool {
        match last_scan_at_ms {
            Some(last) => event_at_ms - last >= Self::DEBOUNCE_MS,
            None => true,
        }
    }

    pub fn observe(
        &mut self,
        path: impl Into<String>,
        size_bytes: u64,
        mtime_ms: i64,
        observed_at_ms: i64,
    ) -> StabilityState {
        let path = path.into();

        let previous = self.latest.insert(
            path.clone(),
            FileProbe {
                size_bytes,
                mtime_ms,
                observed_at_ms,
            },
        );

        let stable_counter = self.stable_counts.entry(path).or_insert(0);

        match previous {
            None => {
                *stable_counter = 0;
                StabilityState::Pending
            }
            Some(prev) => {
                let matches_metadata =
                    prev.size_bytes == size_bytes && prev.mtime_ms == mtime_ms;
                let interval_ok = observed_at_ms - prev.observed_at_ms >= Self::STABILITY_CHECK_INTERVAL_MS;

                if matches_metadata && interval_ok {
                    *stable_counter = stable_counter.saturating_add(1);
                } else {
                    *stable_counter = 0;
                }

                if *stable_counter >= Self::REQUIRED_STABLE_CHECKS {
                    StabilityState::StableReady
                } else {
                    StabilityState::Pending
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{LinkedFolderStabilityChecker, StabilityState};

    #[test]
    fn file_becomes_stable_after_three_stable_checks() {
        let mut checker = LinkedFolderStabilityChecker::default();
        let path = "clip.mov";

        assert_eq!(
            checker.observe(path, 100, 10, 0),
            StabilityState::Pending
        );
        assert_eq!(
            checker.observe(path, 100, 10, 2_000),
            StabilityState::Pending
        );
        assert_eq!(
            checker.observe(path, 100, 10, 4_000),
            StabilityState::Pending
        );
        assert_eq!(
            checker.observe(path, 100, 10, 6_000),
            StabilityState::StableReady
        );
    }
}
