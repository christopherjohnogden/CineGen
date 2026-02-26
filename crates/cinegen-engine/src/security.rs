use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApiKeyRef {
    pub provider_id: String,
    pub key_ref: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecretStorage {
    MacOsKeychain,
}

pub fn redact_for_logs(input: &str) -> String {
    if input.len() <= 4 {
        return "****".to_string();
    }

    let suffix = &input[input.len() - 4..];
    format!("****{}", suffix)
}

#[cfg(test)]
mod tests {
    use super::redact_for_logs;

    #[test]
    fn redacts_sensitive_strings() {
        assert_eq!(redact_for_logs("sk-123456789"), "****6789");
        assert_eq!(redact_for_logs("abc"), "****");
    }
}
