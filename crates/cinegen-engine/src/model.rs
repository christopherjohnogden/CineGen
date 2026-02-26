use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::time::{FrameRate, Tick};

pub type SequenceId = Uuid;
pub type TrackId = Uuid;
pub type ClipInstanceId = Uuid;
pub type AssetVersionId = Uuid;
pub type EffectId = Uuid;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SequenceGraph {
    pub id: SequenceId,
    pub name: String,
    pub frame_rate: FrameRate,
    pub resolution: Resolution,
    pub tracks: BTreeMap<i32, Track>,
    pub clip_index: HashMap<ClipInstanceId, (i32, usize)>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Track {
    pub id: TrackId,
    pub kind: TrackKind,
    pub index: i32,
    pub clips: Vec<ClipInstance>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ClipInstance {
    pub id: ClipInstanceId,
    pub start_tick: Tick,
    pub duration_tick: Tick,
    pub source: ClipSource,
    pub transform: Transform,
    pub effects: Vec<EffectInstance>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum ClipSource {
    Asset {
        asset_version_id: AssetVersionId,
        source_in_tick: Tick,
    },
    Prompt {
        prompt_clip_id: Uuid,
        active_asset_version_id: Option<AssetVersionId>,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Transform {
    pub position: (f32, f32),
    pub scale: (f32, f32),
    pub rotation: f32,
    pub opacity: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EffectInstance {
    pub id: EffectId,
    pub plugin_id: String,
    pub params: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Resolution {
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum TrackKind {
    Video,
    Audio,
}
