PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS branches (
  branch_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  head_commit_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS commits (
  commit_id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  parent_commit_id TEXT,
  source_commit_id TEXT,
  created_at TEXT NOT NULL,
  message TEXT NOT NULL,
  author TEXT NOT NULL,
  FOREIGN KEY(branch_id) REFERENCES branches(branch_id)
);

CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  commit_id TEXT NOT NULL,
  sequence_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  actor TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  FOREIGN KEY(commit_id) REFERENCES commits(commit_id)
);

CREATE TABLE IF NOT EXISTS snapshots (
  snapshot_id TEXT PRIMARY KEY,
  sequence_id TEXT NOT NULL,
  commit_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  codec TEXT NOT NULL,
  blob BLOB NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(commit_id) REFERENCES commits(commit_id)
);

CREATE TABLE IF NOT EXISTS assets (
  asset_id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_versions (
  asset_version_id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  path TEXT NOT NULL,
  media_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(asset_id) REFERENCES assets(asset_id)
);

CREATE TABLE IF NOT EXISTS prompt_clips (
  prompt_clip_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  active_asset_version_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_outputs (
  prompt_output_id TEXT PRIMARY KEY,
  prompt_clip_id TEXT NOT NULL,
  asset_version_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(prompt_clip_id) REFERENCES prompt_clips(prompt_clip_id),
  FOREIGN KEY(asset_version_id) REFERENCES asset_versions(asset_version_id)
);

CREATE TABLE IF NOT EXISTS generation_jobs (
  generation_job_id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  external_job_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS linked_folders (
  linked_folder_id TEXT PRIMARY KEY,
  absolute_path TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS linked_folder_events (
  linked_folder_event_id TEXT PRIMARY KEY,
  linked_folder_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  event_kind TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  processed_at TEXT,
  FOREIGN KEY(linked_folder_id) REFERENCES linked_folders(linked_folder_id)
);

CREATE TABLE IF NOT EXISTS semantic_segments (
  segment_id TEXT PRIMARY KEY,
  asset_version_id TEXT NOT NULL,
  start_tick INTEGER NOT NULL,
  end_tick INTEGER NOT NULL,
  transcript TEXT,
  tags_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(asset_version_id) REFERENCES asset_versions(asset_version_id)
);

CREATE TABLE IF NOT EXISTS embeddings (
  embedding_id TEXT PRIMARY KEY,
  segment_id TEXT NOT NULL,
  model TEXT NOT NULL,
  vector_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(segment_id) REFERENCES semantic_segments(segment_id)
);

CREATE INDEX IF NOT EXISTS idx_commits_branch_created ON commits(branch_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_commits_branch_commit ON commits(branch_id, commit_id);
CREATE INDEX IF NOT EXISTS idx_events_sequence_ts ON events(sequence_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_snapshots_sequence_commit ON snapshots(sequence_id, commit_id);
CREATE INDEX IF NOT EXISTS idx_prompt_outputs_prompt ON prompt_outputs(prompt_clip_id, created_at);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_status ON generation_jobs(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_segments_asset_range ON semantic_segments(asset_version_id, start_tick, end_tick);
