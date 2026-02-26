use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum JobStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
    Canceled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerationJobRecord {
    pub generation_job_id: Uuid,
    pub provider_id: String,
    pub external_job_id: Option<String>,
    pub idempotency_key: String,
    pub retry_count: u32,
    pub status: JobStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Default)]
pub struct JobDeduper {
    by_key: HashMap<String, GenerationJobRecord>,
}

impl JobDeduper {
    pub fn submit_or_get(&mut self, provider_id: impl Into<String>, idempotency_key: impl Into<String>) -> GenerationJobRecord {
        let key = idempotency_key.into();
        if let Some(existing) = self.by_key.get(&key) {
            return existing.clone();
        }

        let now = Utc::now();
        let record = GenerationJobRecord {
            generation_job_id: Uuid::new_v4(),
            provider_id: provider_id.into(),
            external_job_id: None,
            idempotency_key: key.clone(),
            retry_count: 0,
            status: JobStatus::Queued,
            created_at: now,
            updated_at: now,
        };

        self.by_key.insert(key, record.clone());
        record
    }
}

#[cfg(test)]
mod tests {
    use super::JobDeduper;

    #[test]
    fn dedupes_same_idempotency_key() {
        let mut deduper = JobDeduper::default();
        let first = deduper.submit_or_get("comfyui", "idem-key-1");
        let second = deduper.submit_or_get("comfyui", "idem-key-1");
        assert_eq!(first.generation_job_id, second.generation_job_id);
    }
}
