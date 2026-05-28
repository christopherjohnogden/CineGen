import type { Asset } from '@/types/project';
import type { Clip, Timeline } from '@/types/timeline';
import { resolveExistingLocalPath } from '@/lib/media/asset-local-storage';

const MAX_AUTO_VISUAL_REFS = 5;

const VISUAL_ANALYSIS_INTENT_PATTERN = /\b(visually|visual(?:ly)?|what do you see|what'?s in (?:the )?(?:video|clip|shot|frame|footage)|describe (?:what (?:you )?see|the (?:video|footage|clip|shot|scene|visuals?))|analyze (?:the )?(?:video|clip|footage)|look at (?:the )?(?:video|clip|footage)|watch (?:the )?(?:video|clip)|see in (?:the )?(?:video|clip|timeline|footage)|on[- ]screen|frame[- ]by[- ]frame)\b/i;

/** Natural clip/timeline describe questions without saying "visually". */
const CLIP_MEDIA_ANALYSIS_INTENT_PATTERN = /\b(?:describe|explain|tell me about|summarize|what(?:'s| is) (?:in|happening in|going on in)|what happens in|what do you see in)\b[\s\S]{0,80}\b(?:(?:first|second|third|fourth|fifth|\d+(?:st|nd|rd|th)?)\s+)?(?:clip|shot|video|footage)(?:\s+in\s+(?:the\s+)?timeline)?\b/i;

const ALL_CLIPS_INTENT_PATTERN = /\b(all|each|every|entire)\b[\s\S]{0,40}\b(clips?|shots?|videos?)\b/i;

const TIMELINE_CITATION_PATTERN = /\[timeline:([^/\]]+?)\s*\/\s*clip:([^\]@]+?)(?:\s*@\s*([^\]]+))?\]/gi;

const ORDINAL_CLIP_INDEX: Record<string, number> = {
  first: 0,
  second: 1,
  third: 2,
  fourth: 3,
  fifth: 4,
  '1st': 0,
  '2nd': 1,
  '3rd': 2,
  '4th': 3,
  '5th': 4,
};

interface TimelineClipEntry {
  timeline: Timeline;
  clip: Clip;
  asset: Asset;
}

interface TimelineClipCitation {
  timelineName: string;
  clipName: string;
  timeLabel?: string;
}

export interface CopilotVisualRefInput {
  label: string;
  kind: 'asset' | 'clip';
  mediaType: 'image' | 'video';
  fileRef: string;
  trimStartSec?: number;
  trimDurationSec?: number;
  framePaths?: string[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractSlashReferenceLabels(
  text: string,
  knownLabels: readonly string[],
): string[] {
  const sorted = [...knownLabels].sort((a, b) => b.length - a.length);
  const matched: string[] = [];
  const seen = new Set<string>();

  for (const label of sorted) {
    if (!label.trim()) continue;
    const pattern = new RegExp(`/${escapeRegExp(label)}(?=\\s|$|[.,!?;:])`, 'i');
    if (!pattern.test(text)) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    matched.push(label);
  }

  return matched;
}

function resolveLocalMediaPath(asset: Asset): string | undefined {
  return resolveExistingLocalPath(asset) ?? undefined;
}

export function detectVisualAnalysisIntent(text: string): boolean {
  const trimmed = text.trim();
  return VISUAL_ANALYSIS_INTENT_PATTERN.test(trimmed)
    || CLIP_MEDIA_ANALYSIS_INTENT_PATTERN.test(trimmed);
}

export function extractTimelineClipCitations(text: string): TimelineClipCitation[] {
  const citations: TimelineClipCitation[] = [];
  const pattern = new RegExp(TIMELINE_CITATION_PATTERN.source, 'gi');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    citations.push({
      timelineName: match[1].trim(),
      clipName: match[2].trim(),
      timeLabel: match[3]?.trim(),
    });
  }
  return citations;
}

function parseOrdinalClipIndex(text: string): number | null {
  const lower = text.toLowerCase();
  for (const [word, index] of Object.entries(ORDINAL_CLIP_INDEX)) {
    if (new RegExp(`\\b${word}\\b[\\s\\S]{0,24}\\bclips?\\b`, 'i').test(lower)) return index;
    if (new RegExp(`\\bclips?\\s*(?:#|number)?\\s*${word}\\b`, 'i').test(lower)) return index;
  }
  const numbered = lower.match(/\bclip\s*(?:#|number)?\s*(\d+)\b/);
  if (numbered) return Math.max(0, Number.parseInt(numbered[1], 10) - 1);
  return null;
}

function findClipNamesInText(text: string, clipNames: readonly string[]): string[] {
  const sorted = [...clipNames].sort((a, b) => b.length - a.length);
  const matched: string[] = [];
  const seen = new Set<string>();
  for (const name of sorted) {
    if (!name.trim()) continue;
    const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i');
    if (!pattern.test(text)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    matched.push(name);
  }
  return matched;
}

function collectVisualTimelineClipEntries(
  timelines: Timeline[],
  assets: Asset[],
  preferTimelineId?: string,
): TimelineClipEntry[] {
  const orderedTimelines = [...timelines].sort((a, b) => {
    if (preferTimelineId && a.id === preferTimelineId) return -1;
    if (preferTimelineId && b.id === preferTimelineId) return 1;
    return 0;
  });

  const entries: TimelineClipEntry[] = [];
  for (const timeline of orderedTimelines) {
    const sortedClips = [...timeline.clips].sort((a, b) => a.startTime - b.startTime);
    for (const clip of sortedClips) {
      const asset = assets.find((candidate) => candidate.id === clip.assetId);
      if (!asset || (asset.type !== 'video' && asset.type !== 'image')) continue;
      const track = timeline.tracks.find((candidate) => candidate.id === clip.trackId);
      if (asset.type === 'video' && track?.kind === 'audio') continue;
      entries.push({ timeline, clip, asset });
    }
  }
  return entries;
}

function buildClipVisualRef(
  label: string,
  clip: Clip,
  asset: Asset,
): CopilotVisualRefInput | null {
  const fileRef = resolveLocalMediaPath(asset);
  if (!fileRef) return null;
  return {
    label,
    kind: 'clip',
    mediaType: asset.type === 'image' ? 'image' : 'video',
    fileRef,
    ...(asset.type === 'video'
      ? {
        trimStartSec: clip.trimStart,
        trimDurationSec: Math.max(0.1, clip.duration - clip.trimStart - clip.trimEnd),
      }
      : {}),
    framePaths: buildFramePaths(asset),
  };
}

function buildFramePaths(asset: Asset): string[] {
  const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
  const filmstrip = Array.isArray(metadata.filmstrip)
    ? metadata.filmstrip.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  const thumbnail = typeof asset.thumbnailUrl === 'string' && asset.thumbnailUrl.trim()
    ? asset.thumbnailUrl.trim()
    : undefined;
  return [...new Set([...filmstrip, ...(thumbnail ? [thumbnail] : [])])].slice(0, 6);
}

export function resolveCopilotVisualRefs(params: {
  text: string;
  assets: Asset[];
  timelines: Timeline[];
  mentionableAssetNames: readonly string[];
  mentionableClipNames: readonly string[];
}): CopilotVisualRefInput[] {
  const labels = extractSlashReferenceLabels(params.text, [
    ...params.mentionableClipNames,
    ...params.mentionableAssetNames,
  ]);
  if (labels.length === 0) return [];

  const assetsByName = new Map(params.assets.map((asset) => [asset.name.toLowerCase(), asset]));
  const clipEntries = params.timelines.flatMap((timeline) => (
    timeline.clips.map((clip) => {
      const asset = params.assets.find((candidate) => candidate.id === clip.assetId);
      return { clip, asset, timelineName: timeline.name };
    })
  ));

  const refs: CopilotVisualRefInput[] = [];
  const seen = new Set<string>();

  for (const label of labels) {
    const clipMatch = clipEntries.find(({ clip, asset }) => {
      const clipLabel = (clip.name || asset?.name || '').trim();
      return clipLabel.toLowerCase() === label.toLowerCase();
    });

    if (clipMatch?.asset) {
      const { clip, asset } = clipMatch;
      const ref = buildClipVisualRef(label, clip, asset);
      if (!ref) continue;
      const key = `clip:${clip.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push(ref);
      continue;
    }

    const asset = assetsByName.get(label.toLowerCase());
    if (!asset) continue;
    const fileRef = resolveLocalMediaPath(asset);
    if (!fileRef || (asset.type !== 'video' && asset.type !== 'image')) continue;
    const key = `asset:${asset.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({
      label,
      kind: 'asset',
      mediaType: asset.type === 'image' ? 'image' : 'video',
      fileRef,
      framePaths: buildFramePaths(asset),
    });
  }

  return refs;
}

function resolveAutoCopilotVisualRefs(params: {
  text: string;
  assets: Asset[];
  timelines: Timeline[];
  activeTimelineId?: string;
  mentionableClipNames: readonly string[];
  conversationContext?: readonly string[];
}): CopilotVisualRefInput[] {
  const combinedText = [params.text, ...(params.conversationContext ?? [])].join('\n');
  if (!detectVisualAnalysisIntent(params.text) && !detectVisualAnalysisIntent(combinedText)) {
    return [];
  }

  const clipEntries = collectVisualTimelineClipEntries(
    params.timelines,
    params.assets,
    params.activeTimelineId,
  );
  if (clipEntries.length === 0) return [];

  const refs: CopilotVisualRefInput[] = [];
  const seen = new Set<string>();

  const pushEntry = (entry: TimelineClipEntry, label?: string) => {
    const clipLabel = label ?? (entry.clip.name || entry.asset.name).trim();
    const ref = buildClipVisualRef(clipLabel, entry.clip, entry.asset);
    if (!ref) return;
    const key = `clip:${entry.clip.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  };

  const citations = [
    ...extractTimelineClipCitations(params.text),
    ...extractTimelineClipCitations(combinedText),
  ];
  for (const citation of citations) {
    const entry = clipEntries.find(({ timeline, clip, asset }) => {
      if (timeline.name.toLowerCase() !== citation.timelineName.toLowerCase()) return false;
      const clipLabel = (clip.name || asset.name).trim();
      return clipLabel.toLowerCase() === citation.clipName.toLowerCase();
    });
    if (entry) pushEntry(entry, citation.clipName);
    if (refs.length >= MAX_AUTO_VISUAL_REFS) return refs;
  }
  if (refs.length > 0) return refs;

  const ordinal = parseOrdinalClipIndex(params.text) ?? parseOrdinalClipIndex(combinedText);
  if (ordinal !== null) {
    const activeEntries = params.activeTimelineId
      ? clipEntries.filter(({ timeline }) => timeline.id === params.activeTimelineId)
      : clipEntries;
    const entry = activeEntries[ordinal] ?? clipEntries[ordinal];
    if (entry) pushEntry(entry);
    if (refs.length > 0) return refs;
  }

  const namedClips = findClipNamesInText(params.text, params.mentionableClipNames);
  for (const clipName of namedClips) {
    const entry = clipEntries.find(({ clip, asset }) => {
      const clipLabel = (clip.name || asset.name).trim();
      return clipLabel.toLowerCase() === clipName.toLowerCase();
    });
    if (entry) pushEntry(entry, clipName);
    if (refs.length >= MAX_AUTO_VISUAL_REFS) return refs;
  }
  if (refs.length > 0) return refs;

  const attachMany = ALL_CLIPS_INTENT_PATTERN.test(params.text);
  const activeEntries = params.activeTimelineId
    ? clipEntries.filter(({ timeline }) => timeline.id === params.activeTimelineId)
    : clipEntries;
  const targets = attachMany ? activeEntries.slice(0, MAX_AUTO_VISUAL_REFS) : activeEntries.slice(0, 1);
  for (const entry of targets) {
    pushEntry(entry);
  }

  return refs;
}

/** Resolve slash references first; otherwise auto-attach timeline clips for visual-analysis questions. */
export function resolveCopilotVisualRefsForMessage(params: {
  text: string;
  assets: Asset[];
  timelines: Timeline[];
  activeTimelineId?: string;
  mentionableAssetNames: readonly string[];
  mentionableClipNames: readonly string[];
  conversationContext?: readonly string[];
}): CopilotVisualRefInput[] {
  const slashRefs = resolveCopilotVisualRefs({
    text: params.text,
    assets: params.assets,
    timelines: params.timelines,
    mentionableAssetNames: params.mentionableAssetNames,
    mentionableClipNames: params.mentionableClipNames,
  });
  if (slashRefs.length > 0) return slashRefs;

  return resolveAutoCopilotVisualRefs({
    text: params.text,
    assets: params.assets,
    timelines: params.timelines,
    activeTimelineId: params.activeTimelineId,
    mentionableClipNames: params.mentionableClipNames,
    conversationContext: params.conversationContext,
  });
}

export function hasCopilotVisualRefs(refs: readonly CopilotVisualRefInput[]): boolean {
  return refs.length > 0;
}

export function isPrimaryVisualDescribeQuestion(text: string): boolean {
  if (!detectVisualAnalysisIntent(text)) return false;
  if (/\b(trim|cut|edit|split|remove|suggest|how should|what should|create|apply|workflow|gap|marker|export|multi prompt)\b/i.test(text)) {
    return false;
  }
  return true;
}

export function isGeminiVideoAnalysisRefusal(text: string): boolean {
  return /\b(cannot|can't|do not have the ability|unable to|not able to)\b[\s\S]{0,100}\b(video|visual|auditory|mp4|mov|footage|media file)\b/i.test(text)
    || /\btools do not allow\b[\s\S]{0,60}\b(video|visual|auditory|mp4)\b/i.test(text);
}

export function formatVisualAnalysisReply(
  analyses: ReadonlyArray<{ label: string; analysis: string }>,
): string {
  if (analyses.length === 1) {
    return analyses[0].analysis.trim();
  }
  return analyses
    .map((entry, index) => `### ${index + 1}. ${entry.label}\n\n${entry.analysis.trim()}`)
    .join('\n\n');
}

export function describeVisualRefSummary(ref: CopilotVisualRefInput): string {
  if (ref.kind === 'clip' && ref.trimDurationSec !== undefined) {
    return `${ref.label} (${ref.mediaType} clip, ${ref.trimDurationSec.toFixed(1)}s)`;
  }
  return `${ref.label} (${ref.mediaType})`;
}
