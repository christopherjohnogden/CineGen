import type { ScreenplayElement } from '@/lib/director/screenplay';
import type { BeatSheet } from '@/lib/director/beatsheet';

export type ClipLengthSec = 10 | 15 | 20 | 30;
export type DirectorMode = 'source' | 'breakdown' | 'shotlist' | 'generate';
export type BreakdownKind = 'character' | 'location' | 'prop' | 'vehicle';
export type TakeStatus = 'queued' | 'running' | 'done' | 'failed';
export type IsolateMode = 'held' | 'native';

export type IsolateVariant =
  | { kind: 'full' }
  | { kind: 'isolated'; beatN: number; mode: IsolateMode };

export interface DirectorLlmSpend {
  cost: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  requestCount: number;
  lastCost: number;
}

export interface DirectorBreakdownItem {
  id: string;
  kind: BreakdownKind;
  name: string;
  tag: string;
  description: string;
  blurb?: string;
  elementId?: string;
  /** Locations only. Time of day parsed from / recorded on the scene heading. */
  timeOfDay?: string;
  /** Locations only. INT / EXT. */
  intExt?: string;
  /** Characters only. One flowing paragraph of observable behaviour, adapted per clip. */
  actingProfile?: string;
  /** Characters only. Locked vocal identity, pasted verbatim wherever they speak. */
  voice?: string;
  /** When the lazy per-character enrichment (actingProfile+voice) was written. */
  enrichedAt?: number;
  /** True when the deterministic script extractor created this item. Auto items
   *  live and die with the script text: they are reconciled away when an edit
   *  removes what produced them, unless an element link or enrichment has since
   *  invested in them. Manual and LLM items never carry this flag. */
  auto?: boolean;
}

export interface DirectorBeat {
  n: number;
  from: string;
  to: string;
  dur: number;
  text: string;
  cam?: string;
  framing?: string;
  gist?: string;
  quote?: string;
  /** Tag of whoever speaks the quote, so the locked voice reaches the right character. */
  speaker?: string;
}

export interface DirectorTake {
  id: string;
  number: number;
  variantKey: string;
  status: TakeStatus;
  assetId?: string;
  hero?: boolean;
  adapterId: string;
  modelId: string;
  promptSnapshot: string;
  notes?: string;
  error?: string;
  createdAt: string;
  /** Higgsfield job id so a reload can rejoin a take that already finished on their side. */
  jobId?: string;
}

export interface DirectorClip {
  id: string;
  title: string;
  seconds: number;
  sceneId: string;
  beats: DirectorBeat[];
  subject: string;
  location: string;
  intent?: string;
  camera?: string;
  style: string;
  constraints: string;
  lock?: string;
  /** Positions, body facing, gaze targets, depth and landmark proximity. */
  blocking?: string;
  /** Diagonal field of view for the clip, snapped to a CINEDANCE anchor. */
  fov?: number;
  /** Per-character acting tasks for whoever is actually in this clip. */
  acting?: DirectorActingTask[];
  /** Staging reference binding letters to character tags. */
  staging?: DirectorStagingMap;
  elementTags: string[];
  altOf?: string;
  framingRefTag?: string;
  framingRefOn?: boolean;
  activeVariant: IsolateVariant;
  queued?: boolean;
  bodyEdits: Record<string, string>;
  pendingRewrite?: { variantKey: string; body: string };
  takes: DirectorTake[];
}

export interface DirectorScene {
  id: string;
  number: number;
  label: string;
  summary: string;
  elementIds: string[];
  clipIds: string[];
  /** The single event every character in the scene participates in or mirrors. */
  event?: string;
  /** The surface activity the event is played through — the terrain, not the event. */
  physicalAction?: string;
}

/** One character's acting task for one clip, derived from the scene event. */
export interface DirectorActingTask {
  tag: string;
  motive: string;
  goal: string;
  obstacle: string;
  tactic: string;
  moments?: string[];
}

/** A figure on a staging reference. Letters live in prompt text, colours in the image. */
export interface DirectorStagingFigure {
  letter: string;
  color: string;
  tag: string;
  position: string;
  visible?: string;
}

/** tig-diagram staging reference: geometry only, attached after the photo references. */
export interface DirectorStagingMap {
  enabled: boolean;
  stagingTag: string;
  locationTag: string;
  figures: DirectorStagingFigure[];
  /** Set once the schematic has been generated and stored as an asset. */
  assetId?: string;
}

export interface DirectorLookBible {
  filmRefs: string[];
  moodBoards: DirectorMoodBoard[];
  notes: string;
  /** Last auto-built notes. Used so user edits are not clobbered when refs change. */
  autoNotes?: string;
}

export interface DirectorMoodBoard {
  id: string;
  name: string;
  url: string;
}

/** One turn of the Script Assistant chat. Persisted on the show so the thread survives
 *  the panel closing/reopening and app refreshes. */
export interface DirectorChatMessage {
  role: 'user' | 'ai';
  text: string;
}

export interface DirectorShow {
  sourceText: string;
  sourceFileName?: string;
  /** Typed screenplay elements from a structured import (e.g. .fdx). When present, the editor
   *  uses these directly instead of re-parsing sourceText; kept in sync with sourceText. */
  sourceElements?: ScreenplayElement[];
  /** Which document the Script tab is editing. Absent = screenplay. */
  docKind?: 'screenplay' | 'beatsheet';
  /** Beat-sheet store (present when docKind === 'beatsheet'); kept in sync with sourceText. */
  beatSheet?: BeatSheet;
  /** Persisted Script Assistant chat thread — survives panel close/reopen and refresh. */
  chatMessages?: DirectorChatMessage[];
  /** Auto-run breakdown+shotlist after edits. Absent = true (on by default). */
  autoSync?: boolean;
  /** What the cascade has already synced, so it survives reload. */
  syncState?: {
    hashes: Record<string, string>;
    dirty: string[];
    lastRunAt?: number;
  };
  clipLengthSec: ClipLengthSec;
  stylePrefix: string;
  lookBible: DirectorLookBible;
  aspectRatio: string;
  adapterId: string;
  resolution: string;
  generateAudio: boolean;
  genre: string;
  mode: DirectorMode;
  breakdown: DirectorBreakdownItem[];
  breakdownApproved: boolean;
  scenes: DirectorScene[];
  clips: DirectorClip[];
  selectedSceneId?: string;
  selectedClipId?: string;
  selectedTakeId?: string;
  jobStatus?: {
    type: 'breakdown' | 'shotlist' | 'rewrite' | 'generate' | 'look-bible';
    message: string;
    error?: boolean;
    requestId?: string;
  } | null;
  /** Running OpenAI API spend for this show, summed from each Chat Completions
   *  `usage` object (token counts × official Luna rates). */
  llmSpend?: DirectorLlmSpend;
  /** LLM used for breakdown, shotlist, look bible, and rewrite: a local CLI
   *  (Claude / Codex / Gemini), ChatGPT Luna via Codex CLI, OpenAI Luna via
   *  API key, fal.ai's any-llm endpoint, or Higgsfield's llm_text model. */
  llmProvider: 'claude-code' | 'codex' | 'gemini' | 'luna' | 'openai' | 'fal' | 'higgsfield';
  /** Per-scene manual asset overrides (asset tags). sceneIndex -> added/removed. */
  sceneAssetOverrides?: Record<number, { added: string[]; removed: string[] }>;
  /** Background-LLM per-scene asset suggestions (asset tags). sceneIndex -> tags. */
  sceneAssetSuggestions?: Record<number, string[]>;
}

export const CLIP_LENGTHS: ClipLengthSec[] = [10, 15, 20, 30];
export const DEFAULT_DIRECTOR_ADAPTER_ID = 'seedance-2.5';
export const DIRECTOR_GENRES = [
  { id: 'auto', label: 'Auto' },
  { id: 'action', label: 'Action' },
  { id: 'horror', label: 'Horror' },
  { id: 'comedy', label: 'Comedy' },
  { id: 'noir', label: 'Noir' },
  { id: 'drama', label: 'Drama' },
  { id: 'epic', label: 'Epic' },
] as const;
