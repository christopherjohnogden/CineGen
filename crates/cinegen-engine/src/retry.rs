use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailureClass {
    Timeout,
    TransientNetwork,
    Server5xx,
    Auth,
    Validation,
    Canceled,
    Unknown,
}

#[derive(Debug, Clone, Copy)]
pub struct RetryPolicy {
    pub max_retries: u32,
    pub base_delay_seconds: u64,
    pub max_delay_seconds: u64,
    pub jitter_percent: u8,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_retries: 5,
            base_delay_seconds: 2,
            max_delay_seconds: 60,
            jitter_percent: 20,
        }
    }
}

impl RetryPolicy {
    pub fn should_retry(&self, class: FailureClass, attempt: u32) -> bool {
        if attempt >= self.max_retries {
            return false;
        }

        matches!(
            class,
            FailureClass::Timeout | FailureClass::TransientNetwork | FailureClass::Server5xx
        )
    }

    pub fn next_backoff(&self, attempt: u32, jitter_seed: u64) -> Duration {
        let exp = 2u64.saturating_pow(attempt);
        let unclamped = self.base_delay_seconds.saturating_mul(exp);
        let clamped = unclamped.min(self.max_delay_seconds);
        let jitter_span = (clamped.saturating_mul(u64::from(self.jitter_percent))) / 100;
        let jitter_offset = if jitter_span == 0 {
            0
        } else {
            jitter_seed % (jitter_span + 1)
        };

        Duration::from_secs(clamped.saturating_sub(jitter_span / 2).saturating_add(jitter_offset))
    }
}

#[cfg(test)]
mod tests {
    use super::{FailureClass, RetryPolicy};

    #[test]
    fn retries_only_retryable_failures() {
        let policy = RetryPolicy::default();
        assert!(policy.should_retry(FailureClass::Timeout, 0));
        assert!(policy.should_retry(FailureClass::Server5xx, 1));
        assert!(!policy.should_retry(FailureClass::Auth, 0));
        assert!(!policy.should_retry(FailureClass::Validation, 0));
        assert!(!policy.should_retry(FailureClass::Canceled, 0));
    }
}
