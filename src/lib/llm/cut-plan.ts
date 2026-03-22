import type { Asset } from '@/types/project';
import type { Clip, Timeline } from '@/types/timeline';
import { DEFAULT_AUDIO_COLOR, DEFAULT_VIDEO_COLOR } from '@/types/timeline';
import { createDefaultTimeline } from '@/lib/editor/timeline-operations';
import { generateId } from '@/lib/utils/ids';

export interface CutPlanSegment {
  asset_id?: string;
  asset_name?: string;
  source_start: number;
  source_end: number;
  note?: string;
}

export interface CutProposal {
  type: 'cut_proposal';
  summary: string;
  timeline_name: string;
  should_create_timeline: boolean;
  segments: CutPlanSegment[];
}

export interface ParsedCutProposal {
  proposal: CutProposal;
  cleanedMessage: string;
}

export interface ParsedCutProposalSet {
  proposals: CutProposal[];
  cleanedMessage: string;
}

export interface AppliedCutTimeline {
  timeline: Timeline;
  unresolvedSegments: CutPlanSegment[];
}

export const CUT_PLAN_OPEN = '<cinegen-cut-plan>';
export const CUT_PLAN_CLOSE = '</cinegen-cut-plan>';

function normalizePositiveNumber(value: unknown): number | null {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, num);
}

function normalizeSegment(segment: unknown): CutPlanSegment | null {
  if (!segment || typeof segment !== 'object') return null;
  const record = segment as Record<string, unknown>;
  const sourceStart = normalizePositiveNumber(record.source_start);
  const sourceEnd = normalizePositiveNumber(record.source_end);
  if (sourceStart === null || sourceEnd === null || sourceEnd <= sourceStart) return null;

  const assetId = typeof record.asset_id === 'string' && record.asset_id.trim() ? record.asset_id.trim() : undefined;
  const assetName = typeof record.asset_name === 'string' && record.asset_name.trim() ? record.asset_name.trim() : undefined;
  if (!assetId && !assetName) return null;

  return {
    ...(assetId ? { asset_id: assetId } : {}),
    ...(assetName ? { asset_name: assetName } : {}),
    source_start: sourceStart,
    source_end: sourceEnd,
    ...(typeof record.note === 'string' && record.note.trim() ? { note: record.note.trim() } : {}),
  };
}

function normalizeProposal(value: unknown): CutProposal | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const segments = Array.isArray(record.segments)
    ? record.segments.map(normalizeSegment).filter((segment): segment is CutPlanSegment => Boolean(segment))
    : [];
  if (segments.length === 0) return null;

  const summary = typeof record.summary === 'string' && record.summary.trim()
    ? record.summary.trim()
    : `Proposed ${segments.length} cut segments.`;
  const timelineName = typeof record.timeline_name === 'string' && record.timeline_name.trim()
    ? record.timeline_name.trim()
    : 'AI Cut';
  const shouldCreateTimeline = typeof record.should_create_timeline === 'boolean'
    ? record.should_create_timeline
    : true;

  return {
    type: 'cut_proposal',
    summary,
    timeline_name: timelineName,
    should_create_timeline: shouldCreateTimeline,
    segments,
  };
}

function extractJsonBlocks(raw: string): { jsonTexts: string[]; cleanedMessage: string } | null {
  const jsonTexts: string[] = [];
  const cleanedParts: string[] = [];
  let searchIndex = 0;

  while (true) {
    const openIndex = raw.indexOf(CUT_PLAN_OPEN, searchIndex);
    if (openIndex === -1) break;
    const closeIndex = raw.indexOf(CUT_PLAN_CLOSE, openIndex + CUT_PLAN_OPEN.length);
    if (closeIndex === -1 || closeIndex <= openIndex) return null;

    const before = raw.slice(searchIndex, openIndex).trim();
    if (before) cleanedParts.push(before);

    const jsonText = raw.slice(openIndex + CUT_PLAN_OPEN.length, closeIndex).trim();
    if (jsonText) jsonTexts.push(jsonText);

    searchIndex = closeIndex + CUT_PLAN_CLOSE.length;
  }

  if (jsonTexts.length === 0) return null;

  const after = raw.slice(searchIndex).trim();
  if (after) cleanedParts.push(after);

  return {
    jsonTexts,
    cleanedMessage: cleanedParts.join('\n\n').trim(),
  };
}

export function parseCutProposals(raw: string): ParsedCutProposalSet | null {
  const extracted = extractJsonBlocks(raw);
  const candidates = extracted
    ? extracted.jsonTexts
    : [raw.trim()];
  const proposals: CutProposal[] = [];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const proposal = normalizeProposal(parsed);
      if (!proposal) continue;
      proposals.push(proposal);
    } catch {
      continue;
    }
  }

  if (proposals.length === 0) return null;

  return {
    proposals,
    cleanedMessage: extracted?.cleanedMessage || (proposals.length === 1
      ? proposals[0].summary
      : `Proposed ${proposals.length} cut plans.`),
  };
}

export function parseCutProposal(raw: string): ParsedCutProposal | null {
  const parsed = parseCutProposals(raw);
  if (!parsed || parsed.proposals.length === 0) return null;
  return {
    proposal: parsed.proposals[0],
    cleanedMessage: parsed.cleanedMessage,
  };
}

function buildCombinedTimelineName(proposals: CutProposal[]): string {
  const firstName = proposals[0]?.timeline_name?.trim() || 'AI Cut';
  const stripped = firstName
    .replace(/\bpart\s*\d+\b.*$/i, '')
    .replace(/[-–—:]\s*$/, '')
    .trim();
  return `${stripped || firstName} Combined`;
}

export function buildCombinedCutProposal(proposals: CutProposal[]): CutProposal | null {
  const validProposals = proposals.filter((proposal) => proposal.segments.length > 0);
  if (validProposals.length === 0) return null;
  if (validProposals.length === 1) return validProposals[0];

  return {
    type: 'cut_proposal',
    summary: `Combined cut built from ${validProposals.length} proposed timelines.`,
    timeline_name: buildCombinedTimelineName(validProposals),
    should_create_timeline: false,
    segments: validProposals.flatMap((proposal) => proposal.segments),
  };
}

function resolveAsset(segment: CutPlanSegment, assets: Asset[]): Asset | undefined {
  if (segment.asset_id) {
    const byId = assets.find((asset) => asset.id === segment.asset_id);
    if (byId) return byId;
  }

  if (segment.asset_name) {
    const lowerName = segment.asset_name.toLowerCase();
    return assets.find((asset) => asset.name.toLowerCase() === lowerName);
  }

  return undefined;
}

function uniqueTimelineName(baseName: string, existingTimelines: Timeline[]): string {
  const trimmed = baseName.trim() || 'AI Cut';
  const existing = new Set(existingTimelines.map((timeline) => timeline.name.toLowerCase()));
  if (!existing.has(trimmed.toLowerCase())) return trimmed;

  let index = 2;
  while (existing.has(`${trimmed} ${index}`.toLowerCase())) {
    index += 1;
  }
  return `${trimmed} ${index}`;
}

function createLinkedVideoAudioClips(params: {
  asset: Asset;
  startTime: number;
  sourceStart: number;
  sourceEnd: number;
  videoTrackId: string;
  audioTrackId: string;
}): Clip[] {
  const { asset, startTime, sourceStart, sourceEnd, videoTrackId, audioTrackId } = params;
  const assetDuration = asset.duration ?? sourceEnd;
  const trimStart = sourceStart;
  const trimEnd = Math.max(0, assetDuration - sourceEnd);
  const videoClipId = generateId();
  const audioClipId = generateId();

  return [
    {
      id: videoClipId,
      assetId: asset.id,
      trackId: videoTrackId,
      name: asset.name,
      startTime,
      duration: assetDuration,
      trimStart,
      trimEnd,
      speed: 1,
      opacity: 1,
      volume: 1,
      flipH: false,
      flipV: false,
      keyframes: [],
      linkedClipIds: [audioClipId],
    },
    {
      id: audioClipId,
      assetId: asset.id,
      trackId: audioTrackId,
      name: `${asset.name} (audio)`,
      startTime,
      duration: assetDuration,
      trimStart,
      trimEnd,
      speed: 1,
      opacity: 1,
      volume: 1,
      flipH: false,
      flipV: false,
      keyframes: [],
      linkedClipIds: [videoClipId],
    },
  ];
}

function createAudioOnlyClip(params: {
  asset: Asset;
  startTime: number;
  sourceStart: number;
  sourceEnd: number;
  audioTrackId: string;
}): Clip {
  const { asset, startTime, sourceStart, sourceEnd, audioTrackId } = params;
  const assetDuration = asset.duration ?? sourceEnd;
  return {
    id: generateId(),
    assetId: asset.id,
    trackId: audioTrackId,
    name: asset.name,
    startTime,
    duration: assetDuration,
    trimStart: sourceStart,
    trimEnd: Math.max(0, assetDuration - sourceEnd),
    speed: 1,
    opacity: 1,
    volume: 1,
    flipH: false,
    flipV: false,
    keyframes: [],
  };
}

export function buildTimelineFromCutProposal(params: {
  proposal: CutProposal;
  assets: Asset[];
  existingTimelines: Timeline[];
}): AppliedCutTimeline | null {
  const { proposal, assets, existingTimelines } = params;
  const validAssets = assets.filter((asset) => asset.type === 'video' || asset.type === 'audio');
  if (validAssets.length === 0) return null;

  const timeline = createDefaultTimeline(uniqueTimelineName(proposal.timeline_name, existingTimelines));
  timeline.tracks = timeline.tracks.map((track) => {
    if (track.name === 'V2') return { ...track, color: DEFAULT_VIDEO_COLOR };
    if (track.name === 'A2') return { ...track, color: DEFAULT_AUDIO_COLOR };
    return track;
  });

  const videoTrackId = timeline.tracks.find((track) => track.kind === 'video' && track.name === 'V2')?.id
    ?? timeline.tracks.find((track) => track.kind === 'video')?.id;
  const audioTrackId = timeline.tracks.find((track) => track.kind === 'audio' && track.name === 'A2')?.id
    ?? timeline.tracks.find((track) => track.kind === 'audio')?.id;

  if (!audioTrackId) return null;

  const clips: Clip[] = [];
  const unresolvedSegments: CutPlanSegment[] = [];
  let cursor = 0;

  for (const segment of proposal.segments) {
    const asset = resolveAsset(segment, validAssets);
    if (!asset) {
      unresolvedSegments.push(segment);
      continue;
    }

    const assetDuration = asset.duration ?? segment.source_end;
    const sourceStart = Math.min(segment.source_start, assetDuration);
    const sourceEnd = Math.min(Math.max(segment.source_end, sourceStart), assetDuration);
    if (sourceEnd <= sourceStart) {
      unresolvedSegments.push(segment);
      continue;
    }

    if (asset.type === 'video' && videoTrackId) {
      clips.push(...createLinkedVideoAudioClips({
        asset,
        startTime: cursor,
        sourceStart,
        sourceEnd,
        videoTrackId,
        audioTrackId,
      }));
    } else {
      clips.push(createAudioOnlyClip({
        asset,
        startTime: cursor,
        sourceStart,
        sourceEnd,
        audioTrackId,
      }));
    }

    cursor += sourceEnd - sourceStart;
  }

  if (clips.length === 0) return null;

  timeline.clips = clips;
  timeline.duration = cursor;

  return {
    timeline,
    unresolvedSegments,
  };
}
