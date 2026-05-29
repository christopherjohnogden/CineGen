import type { Asset } from '@/types/project';
import type { Timeline } from '@/types/timeline';
import { clipEffectiveDuration } from '@/types/timeline';
import type { CutProposal } from '@/lib/llm/cut-plan';
import type { AcousticSegment, SilenceInterval } from '@/lib/llm/acoustic-analysis';
import { scoreMomentPerformance, type ScoringContext } from '@/lib/llm/selection';

export type EditorialPersona =
  | 'documentary-editor'
  | 'promo-trailer-editor'
  | 'brand-storyteller'
  | 'social-shortform-editor'
  | 'interview-producer';

export type EditorialQualityGoal = 'auto' | 'story' | 'retention' | 'clarity';
export type WorkflowStage = 'brief' | 'variants';
export type VisualSummaryStatus = 'missing' | 'queued' | 'analyzing' | 'ready' | 'failed';

export interface TimelinePlacement {
  timelineId: string;
  timelineName: string;
  clipId: string;
  clipName: string;
  timelineTime: number;
  clipStartTime: number;
}

export interface InsightMoment {
  id: string;
  assetId: string;
  assetName: string;
  text: string;
  sourceStart: number;
  sourceEnd: number;
  words: Array<{ word: string; start: number; end: number }>;
  timelinePlacements: TimelinePlacement[];
  delivery?: string;
  emotion?: string;
  energy?: string;
  pace?: string;
  notable?: string[];
  silenceBefore?: SilenceInterval;
  silenceAfter?: SilenceInterval;
}

export interface TimelineReferenceProfile {
  timelineId: string;
  timelineName: string;
  duration: number;
  clipCount: number;
  primaryAssets: string[];
  structureSummary: string;
  isActive: boolean;
}

export interface AssetVisualInput {
  assetId: string;
  assetName: string;
  assetType: Asset['type'];
  thumbnailPath?: string;
  framePaths: string[];
  storedSummary?: AssetVisualSummary;
}

export interface AssetVisualSummary {
  assetId: string;
  status: VisualSummaryStatus;
  summary?: string;
  tone?: string[];
  pacing?: string;
  shotTypes?: string[];
  subjects?: string[];
  brollIdeas?: string[];
  updatedAt?: string;
  model?: string;
  confidence?: number;
  sourceFrameCount?: number;
  error?: string;
}

export interface EditorialBrief {
  pieceType: string;
  deliverable: string;
  audience: string;
  tone: string;
  pacing: string;
  targetDurationSeconds: number;
  variantCount: 1 | 3;
  persona: EditorialPersona;
  storyGoal: string;
  hook: string;
  formatNotes: string;
  qualityGoal: EditorialQualityGoal;
  referenceTimelineId?: string;
  referenceTimelineName?: string;
  useBrollPlaceholders: boolean;
  confidence: number;
  rationale: string;
}

export interface ClarifyingQuestionOption {
  id: string;
  label: string;
  description?: string;
}

export interface ClarifyingQuestion {
  id: string;
  question: string;
  help?: string;
  allowCustom?: boolean;
  options: ClarifyingQuestionOption[];
}

export interface RetrievedMoment {
  id: string;
  assetId: string;
  assetName: string;
  text: string;
  sourceStart: number;
  sourceEnd: number;
  words: Array<{ word: string; start: number; end: number }>;
  timelinePlacements: TimelinePlacement[];
  score: number;
  reason: string;
}

export interface RetrievalSummary {
  topMoments: RetrievedMoment[];
  referenceTimelines: TimelineReferenceProfile[];
  visualSummaryStatus: 'ready' | 'partial' | 'none';
  note: string;
}

export interface CutScorecard {
  overall: number;
  storyArc: number;
  pacing: number;
  clarity: number;
  visualFit: number;
  completeness: number;
  formatFit: number;
  strengths: string[];
  cautions: string[];
  rationale: string;
}

export interface CutVariant {
  id: string;
  title: string;
  strategy: string;
  summary: string;
  rationale: string;
  scorecard: CutScorecard;
  proposals: CutProposal[];
}

export interface CutWorkflowUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
}

export interface CutWorkflowResult {
  stage: WorkflowStage;
  summaryMessage: string;
  editorialBrief: EditorialBrief;
  clarifyingQuestions: ClarifyingQuestion[];
  retrievalSummary: RetrievalSummary;
  visualFindings: AssetVisualSummary[];
  variants: CutVariant[];
  usage?: CutWorkflowUsage;
}

export interface ProjectInsightIndex {
  projectId: string;
  activeTimelineId: string;
  builtAt: string;
  stats: {
    assetCount: number;
    transcriptReadyCount: number;
    wordTimestampReadyCount: number;
    videoCount: number;
    audioCount: number;
    visualSummaryReadyCount: number;
  };
  moments: InsightMoment[];
  referenceTimelines: TimelineReferenceProfile[];
  visualInputs: AssetVisualInput[];
}

function roundTime(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.round(Math.max(0, parsed) * 1000) / 1000;
}

function extractTranscriptSegments(asset: Asset): Array<{
  text: string;
  start: number;
  end: number;
  words: Array<{ word: string; start: number; end: number }>;
}> {
  const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
  const transcription = (metadata.transcription ?? {}) as { segments?: unknown[] };
  if (!Array.isArray(transcription.segments)) return [];

  return transcription.segments.flatMap((segment, index) => {
    if (!segment || typeof segment !== 'object') return [];
    const record = segment as Record<string, unknown>;
    const text = typeof record.text === 'string' ? record.text.trim() : '';
    const start = roundTime(record.start);
    const end = roundTime(record.end);
    if (!text || start === undefined || end === undefined || end <= start) return [];

    const words = Array.isArray(record.words)
      ? record.words.flatMap((word) => {
          if (!word || typeof word !== 'object') return [];
          const wordRecord = word as Record<string, unknown>;
          const wordText = typeof wordRecord.word === 'string' ? wordRecord.word.trim() : '';
          const wordStart = roundTime(wordRecord.start);
          const wordEnd = roundTime(wordRecord.end);
          if (!wordText || wordStart === undefined || wordEnd === undefined || wordEnd < wordStart) return [];
          return [{ word: wordText, start: wordStart, end: wordEnd }];
        })
      : [];

    return [{
      text,
      start,
      end,
      words,
      index,
    }];
  });
}

export function extractAcousticSegments(asset: Asset): AcousticSegment[] {
  const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
  const analysis = metadata.analysis as Record<string, unknown> | undefined;
  if (!analysis || analysis.status !== 'ready') return [];
  const segments = Array.isArray(analysis.segments) ? analysis.segments : [];
  return segments.flatMap((entry): AcousticSegment[] => {
    if (!entry || typeof entry !== 'object') return [];
    const r = entry as Record<string, unknown>;
    const start = roundTime(r.start);
    const end = roundTime(r.end);
    if (start === undefined || end === undefined || end <= start) return [];
    return [{
      start,
      end,
      delivery: typeof r.delivery === 'string' ? r.delivery : undefined,
      emotion: typeof r.emotion === 'string' ? r.emotion : undefined,
      energy: typeof r.energy === 'string' ? r.energy : undefined,
      pace: typeof r.pace === 'string' ? r.pace : undefined,
      notable: Array.isArray(r.notable) ? r.notable.filter((v): v is string => typeof v === 'string') : undefined,
      content: typeof r.content === 'string' ? r.content : undefined,
      shotType: typeof r.shotType === 'string' ? r.shotType : undefined,
      cutawayCandidate: typeof r.cutawayCandidate === 'boolean' ? r.cutawayCandidate : undefined,
      confidence: Number.isFinite(Number(r.confidence)) ? Number(r.confidence) : undefined,
    }];
  });
}

export function extractSilenceMap(asset: Asset): SilenceInterval[] {
  const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
  const analysis = metadata.analysis as Record<string, unknown> | undefined;
  if (!analysis || analysis.status !== 'ready') return [];
  const map = Array.isArray(analysis.silenceMap) ? analysis.silenceMap : [];
  return map.flatMap((entry): SilenceInterval[] => {
    if (!entry || typeof entry !== 'object') return [];
    const r = entry as Record<string, unknown>;
    const start = roundTime(r.start);
    const end = roundTime(r.end);
    if (start === undefined || end === undefined || end <= start) return [];
    return [{ start, end }];
  });
}

function bestOverlap(
  segmentStart: number,
  segmentEnd: number,
  acoustic: AcousticSegment[],
): AcousticSegment | undefined {
  let best: AcousticSegment | undefined;
  let bestOverlapAmount = 0;
  for (const a of acoustic) {
    const overlap = Math.min(segmentEnd, a.end) - Math.max(segmentStart, a.start);
    if (overlap > bestOverlapAmount) {
      bestOverlapAmount = overlap;
      best = a;
    }
  }
  return bestOverlapAmount > 0 ? best : undefined;
}

function nearestSilence(time: number, silenceMap: SilenceInterval[], side: 'before' | 'after'): SilenceInterval | undefined {
  const epsilon = 0.25;
  if (side === 'before') {
    return silenceMap.filter((s) => s.end <= time + epsilon).sort((x, y) => y.end - x.end)[0];
  }
  return silenceMap.filter((s) => s.start >= time - epsilon).sort((x, y) => x.start - y.start)[0];
}

function findTimelinePlacements(assetId: string, sourceTime: number, timelines: Timeline[], activeTimelineId: string): TimelinePlacement[] {
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
        clipId: clip.id,
        clipName: clip.name,
        timelineTime: Math.max(0, clip.startTime + ((sourceTime - clip.trimStart) / Math.max(0.0001, clip.speed))),
        clipStartTime: clip.startTime,
        timelineIndex,
      }];
    }))
    .sort((a, b) => {
      const aActive = a.timelineId === activeTimelineId ? 1 : 0;
      const bActive = b.timelineId === activeTimelineId ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      if (a.timelineIndex !== b.timelineIndex) return a.timelineIndex - b.timelineIndex;
      return a.clipStartTime - b.clipStartTime;
    })
    .map(({ timelineId, timelineName, clipId, clipName, timelineTime, clipStartTime }) => ({
      timelineId,
      timelineName,
      clipId,
      clipName,
      timelineTime,
      clipStartTime,
    }))
    .slice(0, 4);
}

function getStoredVisualSummary(asset: Asset): AssetVisualSummary | undefined {
  const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
  const normalizeStatus = (value: unknown): VisualSummaryStatus | undefined => (
    value === 'missing' || value === 'queued' || value === 'analyzing' || value === 'ready' || value === 'failed'
      ? value
      : undefined
  );
  const fallbackStatus = normalizeStatus(metadata.llmVisualSummaryStatus);
  const summary = metadata.llmVisualSummary;
  if (!summary || typeof summary !== 'object') {
    return fallbackStatus ? { assetId: asset.id, status: fallbackStatus } : undefined;
  }
  const record = summary as Record<string, unknown>;
  const status = normalizeStatus(record.status) ?? fallbackStatus;
  if (!status) return undefined;
  return {
    assetId: asset.id,
    status,
    summary: typeof record.summary === 'string' ? record.summary : undefined,
    tone: Array.isArray(record.tone) ? record.tone.filter((value): value is string => typeof value === 'string') : undefined,
    pacing: typeof record.pacing === 'string' ? record.pacing : undefined,
    shotTypes: Array.isArray(record.shotTypes) ? record.shotTypes.filter((value): value is string => typeof value === 'string') : undefined,
    subjects: Array.isArray(record.subjects) ? record.subjects.filter((value): value is string => typeof value === 'string') : undefined,
    brollIdeas: Array.isArray(record.brollIdeas) ? record.brollIdeas.filter((value): value is string => typeof value === 'string') : undefined,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : undefined,
    model: typeof record.model === 'string' ? record.model : undefined,
    confidence: typeof record.confidence === 'number' && Number.isFinite(record.confidence) ? record.confidence : undefined,
    sourceFrameCount: typeof record.sourceFrameCount === 'number' && Number.isFinite(record.sourceFrameCount) ? record.sourceFrameCount : undefined,
    error: typeof record.error === 'string' ? record.error : undefined,
  };
}

function getVisualInput(asset: Asset): AssetVisualInput | null {
  const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
  const framePaths = Array.isArray(metadata.filmstrip)
    ? metadata.filmstrip.filter((value): value is string => typeof value === 'string' && value.length > 0).slice(0, 6)
    : [];
  const filmstripSprite = typeof metadata.filmstripUrl === 'string' && metadata.filmstripUrl.trim()
    ? metadata.filmstripUrl.trim()
    : undefined;
  const thumbnailPath = typeof asset.thumbnailUrl === 'string' && asset.thumbnailUrl.trim()
    ? asset.thumbnailUrl.trim()
    : undefined;
  const uniqueFrames = [...new Set([
    ...framePaths,
    ...(filmstripSprite ? [filmstripSprite] : []),
    ...(thumbnailPath ? [thumbnailPath] : []),
  ])].slice(0, 6);

  if (asset.type !== 'video' && asset.type !== 'image') return null;
  if (uniqueFrames.length === 0) return null;

  return {
    assetId: asset.id,
    assetName: asset.name,
    assetType: asset.type,
    thumbnailPath,
    framePaths: uniqueFrames,
    storedSummary: getStoredVisualSummary(asset),
  };
}

function buildTimelineReferenceProfile(timeline: Timeline, assetsById: Map<string, Asset>, activeTimelineId: string): TimelineReferenceProfile {
  const clips = [...timeline.clips].sort((a, b) => a.startTime - b.startTime);
  const assetCounts = new Map<string, number>();
  for (const clip of clips) {
    const asset = assetsById.get(clip.assetId);
    if (!asset) continue;
    assetCounts.set(asset.name, (assetCounts.get(asset.name) ?? 0) + 1);
  }

  const primaryAssets = [...assetCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name]) => name);

  const audioClipCount = clips.filter((clip) => assetsById.get(clip.assetId)?.type === 'audio').length;
  const videoClipCount = clips.filter((clip) => assetsById.get(clip.assetId)?.type === 'video').length;
  const avgClipDuration = clips.length > 0
    ? clips.reduce((sum, clip) => sum + clipEffectiveDuration(clip), 0) / clips.length
    : 0;

  return {
    timelineId: timeline.id,
    timelineName: timeline.name,
    duration: timeline.duration,
    clipCount: clips.length,
    primaryAssets,
    structureSummary: `${clips.length} clips, avg ${avgClipDuration.toFixed(1)}s, ${videoClipCount} video, ${audioClipCount} audio`,
    isActive: timeline.id === activeTimelineId,
  };
}

export function buildProjectInsightIndex(params: {
  projectId: string;
  assets: Asset[];
  timelines: Timeline[];
  activeTimelineId: string;
}): ProjectInsightIndex {
  const { projectId, assets, timelines, activeTimelineId } = params;
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));

  const moments: InsightMoment[] = assets.flatMap((asset) => {
    const acoustic = extractAcousticSegments(asset);
    const silenceMap = extractSilenceMap(asset);
    return extractTranscriptSegments(asset).map((segment, index) => {
      const match = bestOverlap(segment.start, segment.end, acoustic);
      return {
        id: `${asset.id}:${index}:${segment.start.toFixed(3)}`,
        assetId: asset.id,
        assetName: asset.name,
        text: segment.text,
        sourceStart: segment.start,
        sourceEnd: segment.end,
        words: segment.words,
        timelinePlacements: findTimelinePlacements(asset.id, segment.words[0]?.start ?? segment.start, timelines, activeTimelineId),
        delivery: match?.delivery,
        emotion: match?.emotion,
        energy: match?.energy,
        pace: match?.pace,
        notable: match?.notable,
        silenceBefore: nearestSilence(segment.start, silenceMap, 'before'),
        silenceAfter: nearestSilence(segment.end, silenceMap, 'after'),
      };
    });
  });

  const referenceTimelines = timelines.map((timeline) => buildTimelineReferenceProfile(timeline, assetsById, activeTimelineId));
  const visualInputs = assets.flatMap((asset) => {
    const input = getVisualInput(asset);
    return input ? [input] : [];
  });

  const transcriptReadyCount = assets.filter((asset) => extractTranscriptSegments(asset).length > 0).length;
  const wordTimestampReadyCount = assets.filter((asset) => extractTranscriptSegments(asset).some((segment) => segment.words.length > 0)).length;
  const visualSummaryReadyCount = visualInputs.filter((input) => input.storedSummary?.status === 'ready').length;

  return {
    projectId,
    activeTimelineId,
    builtAt: new Date().toISOString(),
    stats: {
      assetCount: assets.length,
      transcriptReadyCount,
      wordTimestampReadyCount,
      videoCount: assets.filter((asset) => asset.type === 'video').length,
      audioCount: assets.filter((asset) => asset.type === 'audio').length,
      visualSummaryReadyCount,
    },
    moments,
    referenceTimelines,
    visualInputs,
  };
}

export function extractQueryTerms(query: string): string[] {
  return [...new Set(query
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3)
  )];
}

/** Emotion words a query might use, so retrieval can boost moments carrying that emotion. */
const QUERY_EMOTION_WORDS = [
  'emotional', 'emotion', 'sad', 'happy', 'angry', 'excited', 'reflective', 'tense',
  'funny', 'nervous', 'calm', 'proud', 'hopeful', 'vulnerable', 'somber', 'wistful',
];

function extractQueryEmotions(query: string): string[] {
  const lower = query.toLowerCase();
  return QUERY_EMOTION_WORDS.filter((word) => lower.includes(word));
}

export interface RetrieveOptions {
  limit?: number;
  persona?: EditorialPersona;
}

export function retrieveRelevantMoments(
  index: ProjectInsightIndex,
  query: string,
  optsOrLimit: RetrieveOptions | number = 24,
): RetrievedMoment[] {
  const opts: RetrieveOptions = typeof optsOrLimit === 'number' ? { limit: optsOrLimit } : optsOrLimit;
  const limit = opts.limit ?? 24;
  const terms = extractQueryTerms(query);
  const ctx: ScoringContext = {
    activeTimelineId: index.activeTimelineId,
    persona: opts.persona,
    queryEmotions: extractQueryEmotions(query),
  };

  return index.moments
    .map((moment) => ({ moment, ...scoreMomentPerformance(moment, terms, ctx) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.moment.sourceStart - b.moment.sourceStart)
    .slice(0, limit)
    .map(({ moment, score, reasons }) => ({
      id: moment.id,
      assetId: moment.assetId,
      assetName: moment.assetName,
      text: moment.text,
      sourceStart: moment.sourceStart,
      sourceEnd: moment.sourceEnd,
      words: moment.words.slice(0, 32),
      timelinePlacements: moment.timelinePlacements,
      score,
      reason: reasons.length > 0
        ? `${reasons.slice(0, 3).join('; ')}.`
        : `${moment.words.length > 0 ? 'Word-level' : 'Segment-level'} transcript candidate.`,
    }));
}

export function formatSeconds(seconds?: number): string {
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
