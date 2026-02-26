use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::model::{AssetVersionId, ClipInstanceId, SequenceId, TrackId};
use crate::time::Tick;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventEnvelope<TPayload> {
    pub event_id: Uuid,
    pub schema_version: u16,
    pub event_type: String,
    pub sequence_id: SequenceId,
    pub commit_id: Uuid,
    pub parent_commit_id: Option<Uuid>,
    pub idempotency_key: String,
    pub actor: String,
    pub timestamp: DateTime<Utc>,
    pub payload: TPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ChangePayload {
    ClipAdded {
        clip_instance_id: ClipInstanceId,
        track_id: TrackId,
        start_tick: Tick,
        duration_tick: Tick,
        asset_version_id: AssetVersionId,
        source_in_tick: Tick,
    },
    ClipTrimmed {
        clip_instance_id: ClipInstanceId,
        new_source_in_tick: Tick,
        new_duration_tick: Tick,
    },
    PromptClipOutputSelected {
        prompt_clip_id: Uuid,
        asset_version_id: AssetVersionId,
    },
    RippleShift {
        from_tick: Tick,
        delta_tick: Tick,
    },
    SnapshotCreated,
}
