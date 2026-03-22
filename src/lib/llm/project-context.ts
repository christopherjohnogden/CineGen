import type { Asset, MediaFolder } from '@/types/project';
import type { Element } from '@/types/elements';
import type { Timeline } from '@/types/timeline';
import type { TranscriptSegment, TranscriptWord } from '@/types/workflow';
import { clipEffectiveDuration } from '@/types/timeline';
import { CUT_PLAN_CLOSE, CUT_PLAN_OPEN } from '@/lib/llm/cut-plan';

export type LLMWorkMode = 'ask' | 'search' | 'cut' | 'timeline';

export const LLM_MODE_LABELS: Record<LLMWorkMode, string> = {
  ask: 'Ask',
  search: 'Search',
  cut: 'Cut',
  timeline: 'Timeline',
};

export const LLM_MODE_HELP: Record<LLMWorkMode, string> = {
  ask: 'Project-aware assistant for notes, summaries, prompts, and production questions.',
  search: 'Find quotes, mentions, assets, and timeline moments with citations.',
  cut: 'Propose transcript-driven selects and rough cuts before creating a new timeline.',
  timeline: 'Reason about timelines, clips, structure, trims, tracks, and edit options.',
};

const MAX_TRANSCRIPT_CHARS_PER_ASSET = 1800;
const MAX_TRANSCRIPT_CHARS_TOTAL = 32000;
const MAX_TIMED_TRANSCRIPT_CHARS_PER_ASSET = 14000;
const MAX_TIMED_TRANSCRIPT_CHARS_TOTAL = 90000;
const MAX_TIMED_SEGMENTS_PER_ASSET = 18;
const QUERY_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'around', 'be', 'build', 'clip', 'clips', 'cut', 'cuts', 'edit', 'for',
  'from', 'get', 'give', 'highlight', 'i', 'if', 'in', 'into', 'is', 'it', 'make', 'me', 'my', 'of',
  'on', 'or', 'please', 'pull', 'rough', 'scene', 'select', 'selects', 'shot', 'shots', 'show', 'stringout',
  'that', 'the', 'this', 'timeline', 'to', 'up', 'use', 'want', 'with',
]);

function formatSeconds(seconds?: number): string {
  if (!Number.isFinite(seconds)) return '00:00.0';
  const total = Math.max(0, Number(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${remainder.toFixed(1).padStart(4, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(1).padStart(4, '0')}`;
}

function compactText(value: string, maxChars: number): { text: string; truncated: boolean } {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) {
    return { text: normalized, truncated: false };
  }
  return {
    text: `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`,
    truncated: true,
  };
}

function normalizeTimedWord(word: unknown): TranscriptWord | null {
  if (!word || typeof word !== 'object') return null;
  const record = word as Record<string, unknown>;
  const text = typeof record.word === 'string' ? record.word.trim() : '';
  const start = roundTime(record.start);
  const end = roundTime(record.end);
  if (!text || start === undefined || end === undefined || end < start) return null;
  return {
    word: text,
    start,
    end,
    ...(typeof record.prob === 'number' ? { prob: record.prob } : {}),
    ...(typeof record.speaker === 'string' && record.speaker.trim() ? { speaker: record.speaker.trim() } : {}),
  };
}

function normalizeTranscriptSegment(segment: unknown): TranscriptSegment | null {
  if (!segment || typeof segment !== 'object') return null;
  const record = segment as Record<string, unknown>;
  const text = typeof record.text === 'string' ? record.text.trim() : '';
  const start = roundTime(record.start);
  const end = roundTime(record.end);
  if (start === undefined || end === undefined || end < start) return null;
  const words = Array.isArray(record.words)
    ? record.words.map(normalizeTimedWord).filter((word): word is TranscriptWord => Boolean(word))
    : [];
  return {
    start,
    end,
    text,
    ...(typeof record.speaker === 'string' && record.speaker.trim() ? { speaker: record.speaker.trim() } : {}),
    ...(words.length > 0 ? { words } : {}),
  };
}

function roundTime(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.round(Math.max(0, parsed) * 1000) / 1000;
}

function extractFocusTerms(query: string | undefined): string[] {
  if (!query) return [];
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !QUERY_STOPWORDS.has(term));
  return [...new Set(terms)];
}

function formatTimedWord(word: TranscriptWord): string {
  return `${word.word}@${formatSeconds(word.start)}-${formatSeconds(word.end)}`;
}

function formatTimedSegment(segment: TranscriptSegment): string {
  const header = `${formatSeconds(segment.start)} -> ${formatSeconds(segment.end)} | ${segment.text}`;
  if (!Array.isArray(segment.words) || segment.words.length === 0) return header;
  const wordsLine = segment.words.map(formatTimedWord).join(' ');
  return `${header}\n    Words: ${wordsLine}`;
}

function scoreTimedSegment(segment: TranscriptSegment, focusTerms: string[]): number {
  if (focusTerms.length === 0) return 0;
  const haystack = `${segment.text} ${(segment.words ?? []).map((word) => word.word).join(' ')}`.toLowerCase();
  return focusTerms.reduce((score, term) => (
    haystack.includes(term) ? score + (segment.text.toLowerCase().includes(term) ? 3 : 1) : score
  ), 0);
}

function selectRelevantTimedSegments(segments: TranscriptSegment[], focusTerms: string[]): TranscriptSegment[] {
  if (segments.length === 0) return [];

  if (focusTerms.length === 0) {
    return segments;
  }

  const scored = segments
    .map((segment, index) => ({ segment, index, score: scoreTimedSegment(segment, focusTerms) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  if (scored.length === 0) {
    return segments.slice(0, Math.min(8, segments.length));
  }

  const selectedIndexes = new Set<number>();
  for (const entry of scored.slice(0, Math.min(8, scored.length))) {
    selectedIndexes.add(entry.index);
    if (entry.index > 0) selectedIndexes.add(entry.index - 1);
    if (entry.index < segments.length - 1) selectedIndexes.add(entry.index + 1);
    if (selectedIndexes.size >= MAX_TIMED_SEGMENTS_PER_ASSET) break;
  }

  return [...selectedIndexes]
    .sort((a, b) => a - b)
    .slice(0, MAX_TIMED_SEGMENTS_PER_ASSET)
    .map((index) => segments[index]);
}

function scoreTranscriptForFocus(segments: TranscriptSegment[], focusTerms: string[]): number {
  if (focusTerms.length === 0) return 0;
  return segments.reduce((score, segment) => score + scoreTimedSegment(segment, focusTerms), 0);
}

function isQuoteLookupQuery(query: string | undefined): boolean {
  if (!query) return false;
  const normalized = query.toLowerCase();
  return [
    'where',
    'when',
    'timestamp',
    'timecode',
    'what time',
    'which clip',
    'which asset',
    'who says',
    'say',
    'says',
    'said',
    'mentions',
    'talks about',
    'talk about',
    'find',
  ].some((needle) => normalized.includes(needle));
}

function buildExactSourceCitation(assetName: string, time: number): string {
  return `[asset:${assetName} @ ${formatSeconds(time)}]`;
}

function buildTimelineCitation(timelineName: string, clipName: string, time: number): string {
  return `[timeline:${timelineName} / clip:${clipName} @ ${formatSeconds(time)}]`;
}

function findTimelinePlacementsForAssetSource(params: {
  assetId: string;
  sourceTime: number;
  timelines: Timeline[];
  activeTimelineId: string;
}): Array<{ timelineName: string; clipName: string; timelineTime: number }> {
  const { assetId, sourceTime, timelines, activeTimelineId } = params;
  const epsilon = 0.05;

  return timelines
    .flatMap((timeline, timelineIndex) => timeline.clips.flatMap((clip) => {
      if (clip.assetId !== assetId) return [];
      const sourceStart = clip.trimStart;
      const sourceEnd = Math.max(sourceStart, clip.duration - clip.trimEnd);
      if (sourceTime < sourceStart - epsilon || sourceTime > sourceEnd + epsilon) return [];
      return [{
        timelineId: timeline.id,
        timelineName: timeline.name,
        clipName: clip.name,
        timelineTime: Math.max(0, clip.startTime + ((sourceTime - clip.trimStart) / Math.max(0.0001, clip.speed))),
        timelineIndex,
        clipStartTime: clip.startTime,
      }];
    }))
    .sort((a, b) => {
      const aActive = a.timelineId === activeTimelineId ? 1 : 0;
      const bActive = b.timelineId === activeTimelineId ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      if (a.timelineIndex !== b.timelineIndex) return a.timelineIndex - b.timelineIndex;
      return a.clipStartTime - b.clipStartTime;
    })
    .slice(0, 3)
    .map(({ timelineName, clipName, timelineTime }) => ({ timelineName, clipName, timelineTime }));
}

function getFolderPath(folderId: string | undefined, foldersById: Map<string, MediaFolder>): string {
  if (!folderId) return 'Root';
  const parts: string[] = [];
  let currentId: string | undefined = folderId;
  while (currentId) {
    const folder = foldersById.get(currentId);
    if (!folder) break;
    parts.unshift(folder.name);
    currentId = folder.parentId;
  }
  return parts.length > 0 ? parts.join(' / ') : 'Root';
}

function getTranscriptPayload(asset: Asset): {
  status: string;
  text: string;
  engine?: string;
  language?: string;
  segmentCount: number;
  wordCount: number;
  segments: TranscriptSegment[];
} {
  const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
  const transcription = (metadata.transcription ?? {}) as {
    text?: string;
    engine?: string;
    language?: string;
    segments?: unknown[];
  };

  const segments = Array.isArray(transcription.segments)
    ? transcription.segments.map(normalizeTranscriptSegment).filter((segment): segment is TranscriptSegment => Boolean(segment))
    : [];
  const segmentCount = segments.length;
  const wordCount = segments.reduce((count, segment) => count + (Array.isArray(segment.words) ? segment.words.length : 0), 0);

  const rawText = typeof transcription.text === 'string' ? transcription.text.trim() : '';
  const status = (() => {
    const value = metadata.transcriptionStatus;
    if (value === 'queued' || value === 'transcribing' || value === 'ready' || value === 'failed') return value;
    if (rawText || segmentCount > 0) return 'ready';
    return 'missing';
  })();

  return {
    status,
    text: rawText,
    engine: typeof metadata.transcriptionEngine === 'string' ? metadata.transcriptionEngine : transcription.engine,
    language: transcription.language,
    segmentCount,
    wordCount,
    segments,
  };
}

export function buildModeSystemPrompt(_mode?: LLMWorkMode): string {
  const lines = [
    "You are CineGen\u2019s project copilot for the active project only.",
    "Treat the provided project context as source-of-truth project memory for this response.",
    "When referencing project facts, include compact citations like [asset:AssetName @ 00:12.3] or [timeline:TimelineName / clip:ClipName @ 00:42.0].",
    "Asset citations use source transcript/source media time. Timeline citations use timeline playhead time.",
    "Never use a timeline placement time as if it were a source transcript timestamp.",
    "If the user appears to want an edit action, propose the edit first before assuming approval.",
    "Never claim a clip, quote, or timeline moment exists unless it is grounded in the provided project context.",
    "",
    "## Capabilities",
    "You can handle any of these tasks in a single conversation:",
    "- Answer questions, write summaries, draft narration, and give production-minded recommendations.",
    "- Search across assets, transcripts, and timelines. Return ranked findings with citations and timestamps.",
    "- When QUERY TOP SOURCE MATCHES is present, use those exact source citations. If a matched source moment is on a timeline, prefer the timeline citation and optionally mention the source asset.",
    "- For transcript quote matches, use exact source timestamps from QUERY MATCHED TIMED TRANSCRIPTS when available.",
    "- Build transcript-driven cuts and rough edits. Favor complete thoughts but cut tighter than sentence boundaries when the request calls for it.",
    "- Use exact source_start and source_end from word-level timestamps when available. Prefer precise in/out points at the first/last relevant spoken word.",
    `- When proposing cuts, include one or more JSON objects wrapped in ${CUT_PLAN_OPEN} and ${CUT_PLAN_CLOSE} after the explanation. Use one block per proposed timeline.`,
    '  Shape: {"type":"cut_proposal","summary":"...","timeline_name":"...","should_create_timeline":true,"segments":[{"asset_id":"...","asset_name":"...","source_start":12.3,"source_end":18.7,"note":"optional"}]}.',
    "  Use source clip times, not timeline times. Use asset_id when available. If the user asked for a plan, proposal, options, parts, versions, or previews, set should_create_timeline to false. Only set should_create_timeline to true when the user explicitly asked to create/apply/build the timeline now.",
    "- Reason about timeline structure, clip usage, trims, tracks, pacing, and edit operations. Reference exact clips and timestamps.",
  ];
  return lines.join("\n");
}

function buildCompactProjectContext(params: {
  projectId: string;
  assets: Asset[];
  mediaFolders: MediaFolder[];
  timelines: Timeline[];
  activeTimelineId: string;
  elements: Element[];
  focusQuery?: string;
}): string {
  const { projectId, assets, timelines, activeTimelineId, elements } = params;
  const activeTimeline = timelines.find((t) => t.id === activeTimelineId);
  const assetsById = new Map(assets.map((a) => [a.id, a]));

  const videoCount = assets.filter((a) => a.type === 'video').length;
  const audioCount = assets.filter((a) => a.type === 'audio').length;
  const imageCount = assets.filter((a) => a.type === 'image').length;

  // Asset summary — name + type + duration only
  const assetLines = assets.slice(0, 20).map((a) =>
    `- ${a.name} [${a.id}] (${a.type}, ${formatSeconds(a.duration)})`,
  );
  if (assets.length > 20) assetLines.push(`- ... and ${assets.length - 20} more`);

  // Active timeline clips only
  const clipLines: string[] = [];
  if (activeTimeline) {
    const trackById = new Map(activeTimeline.tracks.map((t) => [t.id, t]));
    const sorted = [...activeTimeline.clips].sort((a, b) => a.startTime - b.startTime);
    for (const clip of sorted.slice(0, 30)) {
      const asset = assetsById.get(clip.assetId);
      const track = trackById.get(clip.trackId);
      clipLines.push(`- ${clip.name} on ${track?.name ?? '?'} at ${formatSeconds(clip.startTime)}–${formatSeconds(clip.startTime + clipEffectiveDuration(clip))} (asset: ${asset?.name ?? clip.assetId})`);
    }
    if (sorted.length > 30) clipLines.push(`- ... and ${sorted.length - 30} more clips`);
  }

  const lines = [
    'PROJECT CONTEXT',
    `Project: ${projectId}`,
    `Active timeline: ${activeTimeline?.name ?? 'None'}`,
    `Assets: ${assets.length} (${videoCount} video, ${audioCount} audio, ${imageCount} image)`,
    `Timelines: ${timelines.length}`,
    '',
    'ASSETS',
    ...assetLines,
  ];

  if (clipLines.length > 0) {
    lines.push('', `ACTIVE TIMELINE: ${activeTimeline!.name}`, ...clipLines);
  }

  if (elements.length > 0) {
    lines.push('', 'ELEMENTS', ...elements.slice(0, 10).map((e) => `- ${e.type}: ${e.name}`));
  }

  return lines.join('\n');
}

export function buildProjectContext(params: {
  projectId: string;
  assets: Asset[];
  mediaFolders: MediaFolder[];
  timelines: Timeline[];
  activeTimelineId: string;
  elements: Element[];
  mode?: LLMWorkMode;
  focusQuery?: string;
  compact?: boolean;
}): string {
  const { projectId, assets, mediaFolders, timelines, activeTimelineId, elements, mode = 'ask', focusQuery } = params;

  // Compact mode: minimal context for local/small models to keep prompt tokens low
  if (params.compact) {
    return buildCompactProjectContext(params);
  }
  const foldersById = new Map(mediaFolders.map((folder) => [folder.id, folder]));
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const activeTimeline = timelines.find((timeline) => timeline.id === activeTimelineId);
  const clipUsageByAsset = new Map<string, string[]>();
  const focusTerms = extractFocusTerms(focusQuery);
  const isQuoteLookup = isQuoteLookupQuery(focusQuery);

  for (const timeline of timelines) {
    const trackById = new Map(timeline.tracks.map((track) => [track.id, track]));
    for (const clip of timeline.clips) {
      const asset = assetsById.get(clip.assetId);
      const track = trackById.get(clip.trackId);
      const usage = `${timeline.name} / ${track?.name ?? clip.trackId} / ${clip.name} at timeline ${formatSeconds(clip.startTime)} for ${formatSeconds(clipEffectiveDuration(clip))}`;
      const current = clipUsageByAsset.get(clip.assetId) ?? [];
      current.push(usage);
      clipUsageByAsset.set(clip.assetId, current);
    }
  }

  let transcriptBudget = MAX_TRANSCRIPT_CHARS_TOTAL;
  const assetLines = assets.map((asset) => {
    const transcript = getTranscriptPayload(asset);
    const usage = clipUsageByAsset.get(asset.id) ?? [];
    const usageLine = usage.length > 0
      ? `Used in timelines: ${usage.slice(0, 6).join(' | ')}${usage.length > 6 ? ` | +${usage.length - 6} more` : ''}`
      : 'Used in timelines: not currently on any timeline';

    let transcriptLine = `Transcript: ${transcript.status}`;
    if (transcript.engine) transcriptLine += ` via ${transcript.engine}`;
    if (transcript.language) transcriptLine += ` (${transcript.language})`;
    if (transcript.segmentCount > 0) transcriptLine += `, ${transcript.segmentCount} segments`;
    if (transcript.wordCount > 0) transcriptLine += `, ${transcript.wordCount} words`;

    let transcriptExcerpt = '';
    if (transcript.text && transcriptBudget > 0) {
      const allowed = Math.min(MAX_TRANSCRIPT_CHARS_PER_ASSET, transcriptBudget);
      const excerpt = compactText(transcript.text, allowed);
      transcriptBudget -= excerpt.text.length;
      transcriptExcerpt = `Transcript excerpt${excerpt.truncated ? ' (truncated)' : ''}: ${excerpt.text}`;
    }

    return [
      `- Asset: ${asset.name} [${asset.id}]`,
      `  Type: ${asset.type}; Folder: ${getFolderPath(asset.folderId, foldersById)}; Duration: ${formatSeconds(asset.duration)}; Status: ${asset.status ?? 'online'}`,
      `  ${transcriptLine}`,
      `  ${usageLine}`,
      ...(transcriptExcerpt ? [`  ${transcriptExcerpt}`] : []),
    ].join('\n');
  });

  const timelineLines = timelines.map((timeline) => {
    const trackById = new Map(timeline.tracks.map((track) => [track.id, track]));
    const clips = [...timeline.clips].sort((a, b) => a.startTime - b.startTime);
    const clipLines = clips.map((clip) => {
      const asset = assetsById.get(clip.assetId);
      const track = trackById.get(clip.trackId);
      const sourceIn = clip.trimStart;
      const sourceOut = Math.max(clip.trimStart, clip.duration - clip.trimEnd);
      return [
        `  - Clip: ${clip.name} [${clip.id}]`,
        `    Asset: ${asset?.name ?? clip.assetId}; Track: ${track?.name ?? clip.trackId}; Timeline in/out: ${formatSeconds(clip.startTime)} to ${formatSeconds(clip.startTime + clipEffectiveDuration(clip))}`,
        `    Source trim: ${formatSeconds(sourceIn)} to ${formatSeconds(sourceOut)}; Speed: ${clip.speed}x; Volume: ${clip.volume}; Linked clips: ${clip.linkedClipIds?.join(', ') ?? 'none'}`,
      ].join('\n');
    });

    return [
      `- Timeline: ${timeline.name} [${timeline.id}]${timeline.id === activeTimelineId ? ' (active)' : ''}`,
      `  Tracks: ${timeline.tracks.map((track) => `${track.name}:${track.kind}`).join(' | ') || 'none'}`,
      `  Clip count: ${timeline.clips.length}; Transition count: ${timeline.transitions.length}`,
      ...clipLines,
    ].join('\n');
  });

  const elementLines = elements.length > 0
    ? elements.map((element) => `- ${element.type}: ${element.name}${element.description ? ` — ${element.description}` : ''}`)
    : ['- No project elements defined'];

  const transcriptReadyCount = assets.filter((asset) => getTranscriptPayload(asset).status === 'ready').length;
  const videoCount = assets.filter((asset) => asset.type === 'video').length;
  const audioCount = assets.filter((asset) => asset.type === 'audio').length;
  const imageCount = assets.filter((asset) => asset.type === 'image').length;
  const wordReadyCount = assets.filter((asset) => getTranscriptPayload(asset).wordCount > 0).length;

  const timedTranscriptLines: string[] = [];
  const topSourceMatchLines: string[] = [];
  const shouldIncludeTimedMatches = mode === 'cut' || mode === 'search' || focusTerms.length > 0;
  if (shouldIncludeTimedMatches) {
    const transcriptAssets = assets
      .map((asset) => ({ asset, transcript: getTranscriptPayload(asset) }))
      .filter(({ transcript }) => transcript.status === 'ready' && transcript.segmentCount > 0)
      .sort((a, b) => {
        const aUsage = clipUsageByAsset.get(a.asset.id)?.length ?? 0;
        const bUsage = clipUsageByAsset.get(b.asset.id)?.length ?? 0;
        const aFocus = focusTerms.some((term) => a.asset.name.toLowerCase().includes(term)) ? 1 : 0;
        const bFocus = focusTerms.some((term) => b.asset.name.toLowerCase().includes(term)) ? 1 : 0;
        const aTranscriptScore = scoreTranscriptForFocus(a.transcript.segments, focusTerms);
        const bTranscriptScore = scoreTranscriptForFocus(b.transcript.segments, focusTerms);
        const aScore = (aFocus * 100) + (aTranscriptScore * 10) + aUsage + a.transcript.wordCount;
        const bScore = (bFocus * 100) + (bTranscriptScore * 10) + bUsage + b.transcript.wordCount;
        return bScore - aScore;
      });

    const topMatches = transcriptAssets
      .flatMap(({ asset, transcript }) => transcript.segments.map((segment, index) => ({
        asset,
        segment,
        index,
        score: scoreTimedSegment(segment, focusTerms),
      })))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.segment.start - b.segment.start)
      .slice(0, 8);

    if (isQuoteLookup && topMatches.length > 0) {
      topSourceMatchLines.push(
        ...topMatches.map((entry, index) => {
          const timelinePlacements = findTimelinePlacementsForAssetSource({
            assetId: entry.asset.id,
            sourceTime: entry.segment.start,
            timelines,
            activeTimelineId,
          });
          const sourceCitation = buildExactSourceCitation(entry.asset.name, entry.segment.start);
          const timelineCitationText = timelinePlacements.length > 0
            ? ` ${timelinePlacements
                .map((placement) => buildTimelineCitation(placement.timelineName, placement.clipName, placement.timelineTime))
                .join(' ')}`
            : '';
          return `- Match ${index + 1}: ${sourceCitation}${timelineCitationText} ${entry.segment.text}`;
        }),
      );
    }

    let timedBudget = MAX_TIMED_TRANSCRIPT_CHARS_TOTAL;
    for (const { asset, transcript } of transcriptAssets) {
      if (timedBudget <= 0) break;
      const selectedSegments = selectRelevantTimedSegments(transcript.segments, focusTerms);
      if (selectedSegments.length === 0) continue;
      if (focusTerms.length > 0 && scoreTranscriptForFocus(selectedSegments, focusTerms) === 0) continue;

      const lines = [
        `- Asset: ${asset.name} [${asset.id}]`,
        `  Timed transcript source: ${transcript.wordCount > 0 ? 'word-level timestamps' : 'segment timestamps only'}`,
      ];

      let assetBudget = Math.min(MAX_TIMED_TRANSCRIPT_CHARS_PER_ASSET, timedBudget);
      for (const segment of selectedSegments) {
        const formatted = `  - ${formatTimedSegment(segment)}`;
        if (formatted.length > assetBudget) break;
        lines.push(formatted);
        assetBudget -= formatted.length;
        timedBudget -= formatted.length;
        if (timedBudget <= 0) break;
      }

      if (lines.length > 2) {
        timedTranscriptLines.push(...lines);
      }
    }
  }

  return [
    'ACTIVE PROJECT CONTEXT',
    `Project ID: ${projectId}`,
    `Active timeline: ${activeTimeline?.name ?? 'None'}`,
    `Assets: ${assets.length} total (${videoCount} video, ${audioCount} audio, ${imageCount} image)`,
    `Transcript-ready assets: ${transcriptReadyCount}`,
    `Word-timestamp-ready assets: ${wordReadyCount}`,
    `Timelines: ${timelines.length}`,
    `Elements: ${elements.length}`,
    ...(focusTerms.length > 0 ? [`Focus terms: ${focusTerms.join(', ')}`] : []),
    '',
    'ELEMENTS',
    ...elementLines,
    '',
    'MEDIA POOL',
    ...assetLines,
    ...(topSourceMatchLines.length > 0
      ? [
          '',
          'QUERY TOP SOURCE MATCHES',
          'For quote-location answers, prefer timeline citations here when available. If no timeline citation is present, use the source asset citation.',
          ...topSourceMatchLines,
        ]
      : []),
    ...(timedTranscriptLines.length > 0
      ? [
          '',
          'QUERY MATCHED TIMED TRANSCRIPTS',
          'Use these exact source timestamps for quote-location answers and cut decisions when available.',
          ...timedTranscriptLines,
        ]
      : []),
    '',
    'TIMELINES',
    ...timelineLines,
  ].join('\n');
}
