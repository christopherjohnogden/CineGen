use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitMeta {
    pub commit_id: Uuid,
    pub branch_id: Uuid,
    pub parent_commit_id: Option<Uuid>,
    pub source_commit_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub message: String,
    pub author: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MergeOperation {
    ReplaceSequence,
    InsertTimeRange,
    ImportTracks,
    ImportClips,
}
