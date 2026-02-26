use std::collections::BTreeMap;

use uuid::Uuid;

use crate::{
    event::{ChangePayload, EventEnvelope},
    model::{ClipInstance, ClipSource, Resolution, SequenceGraph, Track, TrackKind, Transform},
    time::{FrameRate, Tick},
};

pub fn replay_sequence(
    snapshot: Option<SequenceGraph>,
    events: &[EventEnvelope<ChangePayload>],
) -> SequenceGraph {
    let mut sequence = snapshot.unwrap_or_else(|| SequenceGraph {
        id: events
            .first()
            .map(|event| event.sequence_id)
            .unwrap_or_else(Uuid::new_v4),
        name: "Recovered Sequence".to_string(),
        frame_rate: FrameRate { num: 30, den: 1 },
        resolution: Resolution {
            width: 1920,
            height: 1080,
        },
        tracks: BTreeMap::new(),
        clip_index: Default::default(),
    });

    let mut ordered = events.to_vec();
    ordered.sort_by(|a, b| {
        a.timestamp
            .cmp(&b.timestamp)
            .then_with(|| a.event_id.cmp(&b.event_id))
    });

    for event in ordered {
        apply_event(&mut sequence, event.payload);
    }

    rebuild_clip_index(&mut sequence);
    sequence
}

fn apply_event(sequence: &mut SequenceGraph, payload: ChangePayload) {
    match payload {
        ChangePayload::ClipAdded {
            clip_instance_id,
            track_id,
            start_tick,
            duration_tick,
            asset_version_id,
            source_in_tick,
        } => {
            let track_entry = find_or_insert_track(sequence, track_id);
            track_entry.clips.push(ClipInstance {
                id: clip_instance_id,
                start_tick,
                duration_tick,
                source: ClipSource::Asset {
                    asset_version_id,
                    source_in_tick,
                },
                transform: Transform {
                    position: (0.0, 0.0),
                    scale: (1.0, 1.0),
                    rotation: 0.0,
                    opacity: 1.0,
                },
                effects: Vec::new(),
            });
            track_entry
                .clips
                .sort_by(|a, b| a.start_tick.cmp(&b.start_tick).then_with(|| a.id.cmp(&b.id)));
        }
        ChangePayload::ClipTrimmed {
            clip_instance_id,
            new_source_in_tick,
            new_duration_tick,
        } => {
            if let Some(clip) = find_clip_mut(sequence, clip_instance_id) {
                if let ClipSource::Asset { source_in_tick, .. } = &mut clip.source {
                    *source_in_tick = new_source_in_tick;
                }
                clip.duration_tick = new_duration_tick;
            }
        }
        ChangePayload::RippleShift {
            from_tick,
            delta_tick,
        } => {
            ripple_shift(sequence, from_tick, delta_tick);
        }
        ChangePayload::PromptClipOutputSelected { .. } | ChangePayload::SnapshotCreated => {}
    }
}

fn find_or_insert_track(sequence: &mut SequenceGraph, track_id: Uuid) -> &mut Track {
    let index = sequence
        .tracks
        .iter()
        .find_map(|(idx, track)| (track.id == track_id).then_some(*idx))
        .unwrap_or(sequence.tracks.len() as i32);

    sequence.tracks.entry(index).or_insert_with(|| Track {
        id: track_id,
        kind: TrackKind::Video,
        index,
        clips: Vec::new(),
    })
}

fn find_clip_mut(sequence: &mut SequenceGraph, clip_instance_id: Uuid) -> Option<&mut ClipInstance> {
    for track in sequence.tracks.values_mut() {
        if let Some(clip) = track.clips.iter_mut().find(|clip| clip.id == clip_instance_id) {
            return Some(clip);
        }
    }
    None
}

fn ripple_shift(sequence: &mut SequenceGraph, from_tick: Tick, delta_tick: Tick) {
    for track in sequence.tracks.values_mut() {
        for clip in &mut track.clips {
            if clip.start_tick >= from_tick {
                clip.start_tick += delta_tick;
            }
        }
    }
}

fn rebuild_clip_index(sequence: &mut SequenceGraph) {
    sequence.clip_index.clear();
    for (track_index, track) in &sequence.tracks {
        for (clip_position, clip) in track.clips.iter().enumerate() {
            sequence
                .clip_index
                .insert(clip.id, (*track_index, clip_position));
        }
    }
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use serde_json::to_vec;
    use uuid::Uuid;

    use crate::{
        event::{ChangePayload, EventEnvelope},
        replay::replay_sequence,
    };

    #[test]
    fn replay_is_deterministic_for_same_input() {
        let sequence_id = Uuid::new_v4();
        let commit_id = Uuid::new_v4();
        let track_id = Uuid::new_v4();
        let clip_id = Uuid::new_v4();
        let asset_id = Uuid::new_v4();

        let events = vec![
            EventEnvelope {
                event_id: Uuid::new_v4(),
                schema_version: 1,
                event_type: "ClipAdded".to_string(),
                sequence_id,
                commit_id,
                parent_commit_id: None,
                idempotency_key: "k1".to_string(),
                actor: "test".to_string(),
                timestamp: Utc::now(),
                payload: ChangePayload::ClipAdded {
                    clip_instance_id: clip_id,
                    track_id,
                    start_tick: 10,
                    duration_tick: 20,
                    asset_version_id: asset_id,
                    source_in_tick: 0,
                },
            },
            EventEnvelope {
                event_id: Uuid::new_v4(),
                schema_version: 1,
                event_type: "RippleShift".to_string(),
                sequence_id,
                commit_id,
                parent_commit_id: None,
                idempotency_key: "k2".to_string(),
                actor: "test".to_string(),
                timestamp: Utc::now(),
                payload: ChangePayload::RippleShift {
                    from_tick: 5,
                    delta_tick: 15,
                },
            },
        ];

        let one = replay_sequence(None, &events);
        let two = replay_sequence(None, &events);

        assert_eq!(to_vec(&one).unwrap(), to_vec(&two).unwrap());
    }
}
