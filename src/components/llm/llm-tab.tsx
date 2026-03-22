import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { getApiKey, getCutVisionModel } from '@/lib/utils/api-key';
import type { Asset, MediaFolder } from '@/types/project';
import type { Timeline } from '@/types/timeline';
import type { Element } from '@/types/elements';
import {
  buildModeSystemPrompt,
  buildProjectContext,
  LLM_MODE_LABELS,
  type LLMWorkMode,
} from '@/lib/llm/project-context';
import {
  buildCombinedCutProposal,
  buildTimelineFromCutProposal,
  parseCutProposals,
  type CutProposal,
} from '@/lib/llm/cut-plan';
import {
  buildProjectInsightIndex,
  type ClarifyingQuestion,
  type CutVariant,
  type CutWorkflowResult,
  type EditorialBrief,
  type ProjectInsightIndex,
  type RetrievalSummary,
} from '@/lib/llm/editorial-workflow';

type LLMMode = 'cloud' | 'local';
type ChatRole = 'user' | 'assistant';
type CitationKind = 'asset' | 'timeline';
type MentionTrigger = '/' | '@';
type CutPreviewMode = 'paper' | 'timeline' | 'raw';
type WorkModeSelection = 'auto' | LLMWorkMode;

interface ParsedCitation {
  kind: CitationKind;
  raw: string;
  label: string;
  timestampLabel: string;
  seconds: number;
}

interface TimelineCitationMatch {
  timelineId: string;
  timelineName: string;
  clipName: string;
  timelineSeconds: number;
}

interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
}

interface SessionSideUsage {
  usage?: LLMUsage;
  requestCount: number;
}

interface ChatMessageCutPlan {
  proposal: CutProposal;
  appliedTimelineId?: string;
  appliedTimelineName?: string;
  unresolvedSegmentCount?: number;
  applicationError?: string;
}

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  usage?: LLMUsage;
  cutWorkflow?: ChatCutWorkflowState;
  cutPlans?: ChatMessageCutPlan[];
  combinedTimelineId?: string;
  combinedTimelineName?: string;
  combinedUnresolvedSegmentCount?: number;
  combinedApplicationError?: string;
  cutProposal?: CutProposal;
  appliedTimelineId?: string;
  appliedTimelineName?: string;
  unresolvedSegmentCount?: number;
  applicationError?: string;
}

interface StoredLLMState {
  mode: LLMMode;
  messages: ChatMessage[];
  draft: string;
  systemPrompt: string;
  model: string;
  workMode: LLMWorkMode;
  workModeOverride: WorkModeSelection;
  maxTokens: number;
  temperature: number;
  sideUsage?: SessionSideUsage;
}

interface EditableClarifyingQuestion extends ClarifyingQuestion {
  selectedOptionId?: string;
  customAnswer?: string;
}

interface ChatCutVariantState extends Omit<CutVariant, 'proposals'> {
  plans: ChatMessageCutPlan[];
  combinedTimelineId?: string;
  combinedTimelineName?: string;
  combinedUnresolvedSegmentCount?: number;
  combinedApplicationError?: string;
}

interface ChatCutWorkflowState extends Omit<CutWorkflowResult, 'clarifyingQuestions' | 'variants'> {
  clarifyingQuestions: EditableClarifyingQuestion[];
  variants: ChatCutVariantState[];
}

interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  messageCount: number;
}

interface StoredChatHistory {
  sessions: ChatSession[];
  activeSessionId: string | null;
}

function getChatHistoryKey(projectId: string): string {
  return `cinegen_llm_history:${projectId}`;
}

function getSessionStorageKey(projectId: string, sessionId: string): string {
  return `cinegen_llm_tab:${projectId}:${sessionId}`;
}

function loadChatHistory(projectId: string): StoredChatHistory {
  if (typeof window === 'undefined') return { sessions: [], activeSessionId: null };
  try {
    const raw = localStorage.getItem(getChatHistoryKey(projectId));
    if (!raw) return { sessions: [], activeSessionId: null };
    return JSON.parse(raw) as StoredChatHistory;
  } catch {
    return { sessions: [], activeSessionId: null };
  }
}

function saveChatHistory(projectId: string, history: StoredChatHistory): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(getChatHistoryKey(projectId), JSON.stringify(history)); } catch {}
}

function generateSessionTitle(messages: ChatMessage[]): string {
  const firstUserMsg = messages.find((m) => m.role === 'user');
  if (!firstUserMsg) return 'New chat';
  const text = firstUserMsg.content.trim();
  return text.length > 48 ? text.slice(0, 48) + '\u2026' : text;
}

function getCutPreviewKey(messageId: string, planIndex: number): string {
  return `${messageId}:${planIndex}`;
}

function formatRawCutPlan(proposal: CutProposal): string {
  return `<cinegen-cut-plan>\n${JSON.stringify(proposal, null, 2)}\n</cinegen-cut-plan>`;
}

function inferAutoWorkMode(request: string, messages: ChatMessage[]): LLMWorkMode {
  const normalized = request.trim().toLowerCase();
  if (!normalized) return 'ask';

  const recentMessages = messages.slice(-6);
  const recentText = recentMessages.map((message) => message.content.toLowerCase()).join('\n');
  const hasRecentCutContext = recentMessages.some((message) => Boolean(message.cutWorkflow || message.cutPlans?.length || message.cutProposal));
  const containsAny = (needles: string[]): boolean => needles.some((needle) => normalized.includes(needle));
  const isQuestion = normalized.endsWith('?')
    || /^(what|who|where|when|why|how|which|is|are|do|does|did|can|could|should|would|will)\b/.test(normalized);
  const hasExplicitCutIntent = (
    containsAny([
      'make a cut',
      'build a cut',
      'documentary cut',
      'promo cut',
      'trailer cut',
      'highlight reel',
      'select reel',
      'paper edit',
      'stringout',
      'story arc',
      'rough cut',
      'make a timeline from',
      'build this as a timeline',
      'create a timeline from',
      'edit this into',
      'part 1',
      'part 2',
    ])
    || /\b(cut|promo|trailer|reel|stringout|selects?)\b/.test(normalized)
    || /\b(make|build|create|edit|assemble)\b.+\b(cut|timeline|edit|reel|promo|trailer|stringout)\b/.test(normalized)
  );
  const hasSearchIntent = containsAny([
    'find',
    'where does',
    'where is',
    'when does',
    'who says',
    'who said',
    'mention',
    'mentions',
    'talks about',
    'quote',
    'quotes',
    'timestamp',
    'timecode',
    'which clip',
    'which asset',
  ]);
  const hasTimelineIntent = containsAny([
    'current timeline',
    'current edit',
    'timeline structure',
    'timeline pacing',
    'tracks',
    'track layout',
    'reorder',
    'move this clip',
    'trim this clip',
    'ripple',
    'insert this clip',
    'timeline',
  ]);

  if (hasExplicitCutIntent) {
    return 'cut';
  }

  if (hasSearchIntent) {
    return 'search';
  }

  if (hasTimelineIntent) {
    return 'timeline';
  }

  if (
    hasRecentCutContext
    && (
      containsAny([
        'shorter',
        'longer',
        'tighter',
        'more dramatic',
        'more hype',
        'more emotional',
        'change the hook',
        'change the ending',
        'revise',
        'update the cut',
        'build it',
        'do it',
        'create it',
      ])
      || /^(yes|yeah|yep|ok|okay|sure)\b/.test(normalized)
    )
  ) {
    return 'cut';
  }

  if (hasRecentCutContext && !isQuestion && /cut|timeline|variant|hook|arc|closer|open|ending/.test(recentText)) {
    return 'cut';
  }

  if (isQuestion) {
    return hasSearchIntent ? 'search' : 'ask';
  }

  return 'ask';
}

function hasPlaceholderGenerationMetadata(asset: Asset): boolean {
  const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
  return Boolean(
    metadata.pendingMusic
    || metadata.pendingFillGap
    || metadata.pendingExtend
    || metadata.generating
    || metadata.error,
  );
}

function hasPlaceholderGenerationName(asset: Asset): boolean {
  const normalized = asset.name.trim().toLowerCase();
  return normalized === 'generation failed'
    || normalized === 'generating...'
    || normalized.startsWith('generating ')
    || normalized === 'generate music'
    || normalized === 'generate extension'
    || normalized === 'generate ai fill';
}

function isMentionableMediaPoolAsset(asset: Asset): boolean {
  if (hasPlaceholderGenerationMetadata(asset) || hasPlaceholderGenerationName(asset)) return false;
  return typeof asset.fileRef === 'string' && asset.fileRef.trim().length > 0;
}

function isMentionableTimelineClipAsset(asset: Asset | undefined): asset is Asset {
  if (!asset) return false;
  return !hasPlaceholderGenerationMetadata(asset) && !hasPlaceholderGenerationName(asset);
}

interface LLMTabProps {
  projectId: string;
  assets: Asset[];
  mediaFolders: MediaFolder[];
  timelines: Timeline[];
  activeTimelineId: string;
  elements: Element[];
  onCreateTimelineFromCut: (timeline: Timeline) => void;
  onOpenTimeline: (timelineId: string) => void;
  onNavigateToAssetCitation: (assetId: string, time: number) => void;
  onNavigateToTimelineCitation: (timelineId: string, time: number) => void;
  onUpdateAssetAnalysis: (assetId: string, metadata: Record<string, unknown>) => void;
}

const MODEL_SUGGESTIONS = [
  'google/gemini-2.5-flash',
  'anthropic/claude-sonnet-4.6',
  'anthropic/claude-opus-4.6',
  'anthropic/claude-sonnet-4.5',
  'openai/gpt-4.1',
  'openai/gpt-oss-120b',
  'meta-llama/llama-4-maverick',
];

const LOCAL_MODEL_DEFAULT = 'qwen3.5:latest';

const DEFAULT_SYSTEM_PROMPT = 'You are CineGen\u2019s production copilot. Help with prompts, scripts, shot plans, edit decisions, transcript analysis, and practical creative workflows. Keep answers concise, concrete, and production-minded.';

/* Work mode is now unified — kept for buildProjectContext query weighting */

function createMessage(role: ChatRole, content: string, extras: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
    ...extras,
  };
}

function mergeUsage(base: LLMUsage | undefined, extra: LLMUsage | undefined): LLMUsage | undefined {
  if (!base) return extra;
  if (!extra) return base;
  return {
    promptTokens: base.promptTokens + extra.promptTokens,
    completionTokens: base.completionTokens + extra.completionTokens,
    totalTokens: base.totalTokens + extra.totalTokens,
    cost: base.cost + extra.cost,
  };
}

function mergeSideUsage(base: SessionSideUsage | undefined, extra: LLMUsage | undefined): SessionSideUsage | undefined {
  if (!extra) return base;
  return {
    usage: mergeUsage(base?.usage, extra),
    requestCount: (base?.requestCount ?? 0) + 1,
  };
}

function sanitizeWorkflowMessageContent(content: string, workflow?: ChatCutWorkflowState): string {
  let cleaned = content.trim();
  if (!workflow) return cleaned;

  cleaned = cleaned.replace(/```(?:json)?[\s\S]*?```/gi, '').trim();

  const looksStructured = cleaned.includes('"summaryMessage"')
    || cleaned.includes('"variants"')
    || cleaned.includes('"type": "cut_proposal"')
    || cleaned.includes('"proposals"');

  if (looksStructured) {
    const firstBrace = cleaned.indexOf('{');
    if (firstBrace >= 0) {
      cleaned = cleaned.slice(0, firstBrace).trim();
    }
  }

  if (cleaned) return cleaned;

  if (workflow.stage === 'variants') {
    return workflow.variants.length > 0
      ? 'I generated the cut variants. Review the options below.'
      : 'I hit a formatting issue while packaging the cut variants. Review the brief and try again.';
  }

  return 'I drafted the editorial brief. Review it below.';
}

function toChatCutWorkflow(result: CutWorkflowResult): ChatCutWorkflowState {
  return {
    ...result,
    clarifyingQuestions: result.clarifyingQuestions.map((question) => ({
      ...question,
      selectedOptionId: undefined,
      customAnswer: '',
    })),
    variants: result.variants.map((variant) => ({
      ...variant,
      plans: variant.proposals.map((proposal) => ({ proposal })),
    })),
  };
}

function getStorageKey(projectId: string): string {
  return `cinegen_llm_tab:${projectId}`;
}

function loadStoredState(projectId: string): StoredLLMState {
  const fallback: StoredLLMState = {
    mode: 'cloud',
    messages: [],
    draft: '',
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    model: MODEL_SUGGESTIONS[0],
    workMode: 'ask',
    workModeOverride: 'auto',
    maxTokens: 1200,
    temperature: 0.7,
  };

  if (typeof window === 'undefined') return fallback;

  try {
    const raw = localStorage.getItem(getStorageKey(projectId));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<StoredLLMState>;
    return {
      ...fallback,
      ...parsed,
      messages: Array.isArray(parsed.messages) ? parsed.messages : fallback.messages,
      mode: parsed.mode === 'local' ? 'local' : 'cloud',
      workMode: parsed.workMode === 'search' || parsed.workMode === 'cut' || parsed.workMode === 'timeline'
        ? parsed.workMode
        : 'ask',
      workModeOverride: parsed.workModeOverride === 'ask'
        || parsed.workModeOverride === 'search'
        || parsed.workModeOverride === 'cut'
        || parsed.workModeOverride === 'timeline'
        ? parsed.workModeOverride
        : 'auto',
    };
  } catch {
    return fallback;
  }
}

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

function formatCurrency(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.round(value)));
}

function parseCitationTime(value: string): number | null {
  const parts = value.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  const secs = Number(parts[parts.length - 1]);
  const mins = Number(parts[parts.length - 2]);
  const hrs = parts.length === 3 ? Number(parts[0]) : 0;
  if (![secs, mins, hrs].every(Number.isFinite)) return null;
  return (hrs * 3600) + (mins * 60) + secs;
}

function parseCitationParts(content: string): Array<string | ParsedCitation> {
  // Matches both [asset:name @ 00:12.3] and [asset:name] (no timestamp)
  const pattern = /\[(asset|timeline):(.+?)(?:\s*@\s*([0-9:.]+))?\]/g;
  const parts: Array<string | ParsedCitation> = [];
  let lastIndex = 0;

  for (const match of content.matchAll(pattern)) {
    const [raw, kindRaw, labelRaw, timestampLabel] = match;
    const index = match.index ?? -1;
    if (index < 0) continue;

    if (index > lastIndex) {
      parts.push(content.slice(lastIndex, index));
    }

    const secs = timestampLabel ? parseCitationTime(timestampLabel) : 0;
    parts.push({
      kind: kindRaw === 'timeline' ? 'timeline' : 'asset',
      raw,
      label: labelRaw.trim(),
      timestampLabel: timestampLabel ?? '',
      seconds: secs ?? 0,
    });

    lastIndex = index + raw.length;
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [content];
}

/** Walk React children and replace citation placeholder strings with clickable buttons. */
function injectCitations(
  children: React.ReactNode,
  citations: ParsedCitation[],
  resolveCitation: (c: ParsedCitation) => ParsedCitation,
  assetIdByName: Map<string, string>,
  timelineIdByName: Map<string, string>,
  handleCitationClick: (c: ParsedCitation) => void,
  prefix: string,
): React.ReactNode {
  if (typeof children === 'string') {
    if (!children.includes(prefix)) return children;
    const segments = children.split(new RegExp(`${prefix.replace(/\u200B/g, '\\u200B')}(\\d+)\\u200B\\u200B`));
    return segments.map((seg, i) => {
      if (i % 2 === 1) {
        const cite = citations[parseInt(seg, 10)];
        if (!cite) return seg;
        const resolved = resolveCitation(cite);
        const tLabel = resolved.label.split('/ clip:')[0]?.trim() ?? resolved.label.trim();
        const resolvable = resolved.kind === 'asset'
          ? assetIdByName.has(resolved.label.toLowerCase())
          : timelineIdByName.has(tLabel.toLowerCase());
        if (!resolvable) return resolved.raw;
        return (
          <button
            key={`cite-${i}`}
            type="button"
            className="copilot__citation"
            onClick={() => handleCitationClick(resolved)}
            title={resolved.kind === 'asset' ? 'Jump to timeline moment' : 'Open timeline at this time'}
          >
            {resolved.raw}
          </button>
        );
      }
      return seg || null;
    });
  }
  if (Array.isArray(children)) {
    return children.map((child, i) => (
      <span key={i}>{injectCitations(child, citations, resolveCitation, assetIdByName, timelineIdByName, handleCitationClick, prefix)}</span>
    ));
  }
  return children;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function LLMTab({
  projectId,
  assets,
  mediaFolders,
  timelines,
  activeTimelineId,
  elements,
  onCreateTimelineFromCut,
  onOpenTimeline,
  onNavigateToAssetCitation,
  onNavigateToTimelineCitation,
  onUpdateAssetAnalysis,
}: LLMTabProps) {
  const initialState = useMemo(() => loadStoredState(projectId), [projectId]);
  const [mode, setMode] = useState<LLMMode>(initialState.mode);
  const [messages, setMessages] = useState<ChatMessage[]>(initialState.messages);
  const [draft, setDraft] = useState(initialState.draft);
  const [systemPrompt, setSystemPrompt] = useState(initialState.systemPrompt);
  const [model, setModel] = useState(initialState.model);
  const [workMode, setWorkMode] = useState<LLMWorkMode>(initialState.workMode);
  const [workModeOverride, setWorkModeOverride] = useState<WorkModeSelection>(initialState.workModeOverride);
  const [maxTokens, setMaxTokens] = useState(initialState.maxTokens);
  const [temperature, setTemperature] = useState(initialState.temperature);
  const [isSending, setIsSending] = useState(false);
  const [isEnhancingPrompt, setIsEnhancingPrompt] = useState(false);
  const [error, setError] = useState('');
  const [sideUsage, setSideUsage] = useState<SessionSideUsage | undefined>(initialState.sideUsage);
  const [cutPreviewModes, setCutPreviewModes] = useState<Record<string, CutPreviewMode>>({});
  const [falKey, setFalKey] = useState<string | undefined>(() => getApiKey());
  const [localModel, setLocalModel] = useState(LOCAL_MODEL_DEFAULT);
  const [localModels, setLocalModels] = useState<string[]>([LOCAL_MODEL_DEFAULT]);
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [indexPopover, setIndexPopover] = useState<'assets' | 'transcripts' | 'clips' | null>(null);
  const [workModeMenuOpen, setWorkModeMenuOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState<StoredChatHistory>(() => loadChatHistory(projectId));
  const [activeSessionId, setActiveSessionId] = useState<string | null>(chatHistory.activeSessionId);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionTrigger, setMentionTrigger] = useState<MentionTrigger | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const threadRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const workModeMenuRef = useRef<HTMLDivElement>(null);

  const transcriptReadyCount = useMemo(() => (
    assets.filter((asset) => {
      const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
      const transcription = metadata.transcription as { text?: string; segments?: unknown[] } | undefined;
      if (metadata.transcriptionStatus === 'ready') return true;
      if (typeof transcription?.text === 'string' && transcription.text.trim()) return true;
      return Array.isArray(transcription?.segments) && transcription.segments.length > 0;
    }).length
  ), [assets]);
  const totalClipCount = useMemo(() => timelines.reduce((count, timeline) => count + timeline.clips.length, 0), [timelines]);
  const projectInsightIndex = useMemo<ProjectInsightIndex>(() => buildProjectInsightIndex({
    projectId,
    assets,
    timelines,
    activeTimelineId,
  }), [activeTimelineId, assets, projectId, timelines]);

  const transcriptAssets = useMemo(() => assets.filter((asset) => {
    const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
    const transcription = metadata.transcription as { text?: string; segments?: unknown[] } | undefined;
    if (metadata.transcriptionStatus === 'ready') return true;
    if (typeof transcription?.text === 'string' && transcription.text.trim()) return true;
    return Array.isArray(transcription?.segments) && transcription.segments.length > 0;
  }), [assets]);

  const mediaPoolMentionAssets = useMemo(
    () => assets.filter((asset) => isMentionableMediaPoolAsset(asset)),
    [assets],
  );

  const clipsList = useMemo(() => timelines.flatMap((timeline) =>
    timeline.clips.flatMap((clip) => {
      const asset = assets.find((candidate) => candidate.id === clip.assetId);
      if (!isMentionableTimelineClipAsset(asset)) return [];
      return [{
        id: clip.id,
        clipName: clip.name || asset.name,
        timelineName: timeline.name,
        assetName: asset.name,
        assetType: asset.type,
      }];
    }),
  ), [assets, timelines]);

  const assetNameById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset.name])), [assets]);
  const assetIdByName = useMemo(() => new Map(assets.map((asset) => [asset.name.toLowerCase(), asset.id])), [assets]);
  const timelineIdByName = useMemo(() => new Map(timelines.map((timeline) => [timeline.name.toLowerCase(), timeline.id])), [timelines]);
  const sessionUsage = useMemo(() => messages.reduce((summary, message) => {
    if (!message.usage) return summary;
    summary.promptTokens += message.usage.promptTokens;
    summary.completionTokens += message.usage.completionTokens;
    summary.totalTokens += message.usage.totalTokens;
    summary.cost += message.usage.cost;
    summary.requestCount += 1;
    return summary;
  }, {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cost: 0,
    requestCount: 0,
  }), [messages]);
  const totalSessionUsage = useMemo(() => ({
    promptTokens: sessionUsage.promptTokens + (sideUsage?.usage?.promptTokens ?? 0),
    completionTokens: sessionUsage.completionTokens + (sideUsage?.usage?.completionTokens ?? 0),
    totalTokens: sessionUsage.totalTokens + (sideUsage?.usage?.totalTokens ?? 0),
    cost: sessionUsage.cost + (sideUsage?.usage?.cost ?? 0),
    requestCount: sessionUsage.requestCount + (sideUsage?.requestCount ?? 0),
  }), [sessionUsage, sideUsage]);

  const resolveTimelineCitationForAsset = useCallback((assetId: string, sourceSeconds: number): TimelineCitationMatch | null => {
    const epsilon = 0.05;
    const matches = timelines.flatMap((timeline, timelineIndex) => timeline.clips.flatMap((clip) => {
      if (clip.assetId !== assetId) return [];
      const sourceStart = clip.trimStart;
      const sourceEnd = Math.max(sourceStart, clip.duration - clip.trimEnd);
      if (sourceSeconds < sourceStart - epsilon || sourceSeconds > sourceEnd + epsilon) return [];
      return [{
        timelineId: timeline.id,
        timelineName: timeline.name,
        clipName: clip.name,
        timelineSeconds: Math.max(0, clip.startTime + ((sourceSeconds - clip.trimStart) / Math.max(0.0001, clip.speed))),
        timelineIndex,
        clipStartTime: clip.startTime,
      }];
    }));

    if (matches.length === 0) return null;

    matches.sort((a, b) => {
      const aActive = a.timelineId === activeTimelineId ? 1 : 0;
      const bActive = b.timelineId === activeTimelineId ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      if (a.timelineIndex !== b.timelineIndex) return a.timelineIndex - b.timelineIndex;
      return a.clipStartTime - b.clipStartTime;
    });

    const best = matches[0];
    return {
      timelineId: best.timelineId,
      timelineName: best.timelineName,
      clipName: best.clipName,
      timelineSeconds: best.timelineSeconds,
    };
  }, [activeTimelineId, timelines]);

  const resolveCitation = useCallback((citation: ParsedCitation): ParsedCitation => {
    if (citation.kind !== 'asset') return citation;
    const assetId = assetIdByName.get(citation.label.toLowerCase());
    if (!assetId) return citation;
    const timelineMatch = resolveTimelineCitationForAsset(assetId, citation.seconds);
    if (!timelineMatch) return citation;
    const timestampLabel = formatSeconds(timelineMatch.timelineSeconds);
    return {
      kind: 'timeline',
      raw: `[timeline:${timelineMatch.timelineName} / clip:${timelineMatch.clipName} @ ${timestampLabel}]`,
      label: `${timelineMatch.timelineName} / clip:${timelineMatch.clipName}`,
      timestampLabel,
      seconds: timelineMatch.timelineSeconds,
    };
  }, [assetIdByName, resolveTimelineCitationForAsset]);

  const normalizeAssistantCitations = useCallback((content: string): string => {
    return parseCitationParts(content).map((part) => {
      if (typeof part === 'string') return part;
      return resolveCitation(part).raw;
    }).join('');
  }, [resolveCitation]);

  useEffect(() => {
    const next = loadStoredState(projectId);
    setMode(next.mode);
    setMessages(next.messages);
    setDraft(next.draft);
    setSystemPrompt(next.systemPrompt);
    setModel(next.model);
    setWorkMode(next.workMode);
    setWorkModeOverride(next.workModeOverride);
    setMaxTokens(next.maxTokens);
    setTemperature(next.temperature);
    setSideUsage(next.sideUsage);
    setError('');
    setIsSending(false);
  }, [projectId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const timeout = window.setTimeout(() => {
      try {
        localStorage.setItem(getStorageKey(projectId), JSON.stringify({
          mode,
          messages,
          draft,
          systemPrompt,
          model,
          workMode,
          workModeOverride,
          maxTokens,
          temperature,
          sideUsage,
        } satisfies StoredLLMState));
      } catch {}
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [projectId, mode, messages, draft, systemPrompt, model, workMode, workModeOverride, maxTokens, temperature, sideUsage]);

  useEffect(() => {
    if (!threadRef.current) return;
    threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages, isSending]);

  useEffect(() => {
    const refreshSettings = () => setFalKey(getApiKey());
    window.addEventListener('cinegen:settings-changed', refreshSettings);
    return () => window.removeEventListener('cinegen:settings-changed', refreshSettings);
  }, []);

  // Fetch available Ollama models when switching to local mode
  useEffect(() => {
    if (mode !== 'local') return;
    let cancelled = false;
    window.electronAPI.llm.localModels().then((models: string[]) => {
      if (cancelled) return;
      if (models.length > 0) {
        setLocalModels(models);
        if (!models.includes(localModel)) setLocalModel(models[0]);
      }
    }).catch(() => {/* Ollama may not be running */});
    return () => { cancelled = true; };
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!workModeMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!workModeMenuRef.current?.contains(event.target as Node)) {
        setWorkModeMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [workModeMenuOpen]);

  const applyCutProposal = useCallback((messageId: string, proposal: CutProposal, planIndex = 0) => {
    const applied = buildTimelineFromCutProposal({
      proposal,
      assets,
      existingTimelines: timelines,
    });

    if (!applied) {
      const applicationError = assets.some((asset) => asset.type === 'video' || asset.type === 'audio')
        ? 'Unable to build a timeline from that cut plan.'
        : 'No audio or video assets are available for this cut.';
      setMessages((current) => current.map((message) => {
        if (message.id !== messageId) return message;
        if (Array.isArray(message.cutPlans) && message.cutPlans[planIndex]) {
          return {
            ...message,
            cutPlans: message.cutPlans.map((cutPlan, index) => (
              index === planIndex
                ? { ...cutPlan, applicationError }
                : cutPlan
            )),
          };
        }
        return { ...message, applicationError };
      }));
      return null;
    }

    onCreateTimelineFromCut(applied.timeline);

    setMessages((current) => current.map((message) => {
      if (message.id !== messageId) return message;
      if (Array.isArray(message.cutPlans) && message.cutPlans[planIndex]) {
        return {
          ...message,
          cutPlans: message.cutPlans.map((cutPlan, index) => (
            index === planIndex
              ? {
                  ...cutPlan,
                  appliedTimelineId: applied.timeline.id,
                  appliedTimelineName: applied.timeline.name,
                  unresolvedSegmentCount: applied.unresolvedSegments.length,
                  applicationError: undefined,
                }
              : cutPlan
          )),
        };
      }
      return {
        ...message,
        appliedTimelineId: applied.timeline.id,
        appliedTimelineName: applied.timeline.name,
        unresolvedSegmentCount: applied.unresolvedSegments.length,
        applicationError: undefined,
      };
    }));

    return applied.timeline;
  }, [assets, onCreateTimelineFromCut, timelines]);

  const applyCombinedCutPlans = useCallback((messageId: string, proposals: CutProposal[]) => {
    const combinedProposal = buildCombinedCutProposal(proposals);
    if (!combinedProposal) {
      setMessages((current) => current.map((message) => (
        message.id === messageId
          ? { ...message, combinedApplicationError: 'Unable to combine those cut plans into a single timeline.' }
          : message
      )));
      return null;
    }

    const applied = buildTimelineFromCutProposal({
      proposal: combinedProposal,
      assets,
      existingTimelines: timelines,
    });

    if (!applied) {
      const combinedApplicationError = assets.some((asset) => asset.type === 'video' || asset.type === 'audio')
        ? 'Unable to build a combined timeline from those cut plans.'
        : 'No audio or video assets are available for this combined cut.';
      setMessages((current) => current.map((message) => (
        message.id === messageId
          ? { ...message, combinedApplicationError }
          : message
      )));
      return null;
    }

    onCreateTimelineFromCut(applied.timeline);

    setMessages((current) => current.map((message) => (
      message.id === messageId
        ? {
            ...message,
            combinedTimelineId: applied.timeline.id,
            combinedTimelineName: applied.timeline.name,
            combinedUnresolvedSegmentCount: applied.unresolvedSegments.length,
            combinedApplicationError: undefined,
          }
        : message
    )));

    return applied.timeline;
  }, [assets, onCreateTimelineFromCut, timelines]);

  const handleSend = useCallback(async () => {
    if (isSending) return;

    const content = draft.trim();
    if (!content) return;

    /* ── Local mode: route through Ollama with streaming ── */
    if (mode === 'local') {
      const userMessage = createMessage('user', content);
      const nextMessages = [...messages, userMessage];
      const requestId = crypto.randomUUID();
      const assistantMessage = createMessage('assistant', '');

      setMessages([...nextMessages, assistantMessage]);
      setDraft('');
      setError('');
      setIsSending(true);

      // Listen for streaming tokens
      const removeStreamListener = window.electronAPI.llm.onLocalStream((data) => {
        if (data.requestId !== requestId) return;
        if (data.token) {
          setMessages((current) => {
            const last = current[current.length - 1];
            if (last?.id !== assistantMessage.id) return current;
            return [...current.slice(0, -1), { ...last, content: last.content + data.token }];
          });
        }
      });

      try {
        // Use a compact context for local models to keep prompt tokens low and response fast
        const projectContext = buildProjectContext({
          projectId,
          assets,
          mediaFolders,
          timelines,
          activeTimelineId,
          elements,
          mode: 'ask',
          focusQuery: content,
          compact: true,
        });

        const response = await window.electronAPI.llm.localChat({
          requestId,
          model: localModel,
          systemPrompt: [
            buildModeSystemPrompt('ask'),
            systemPrompt.trim(),
            projectContext,
          ].filter(Boolean).join('\n\n'),
          messages: nextMessages.map((message) => ({ role: message.role, content: message.content })),
          maxTokens,
          temperature,
        });

        // Final update with usage stats
        setMessages((current) => {
          const last = current[current.length - 1];
          if (last?.id !== assistantMessage.id) return current;
          const finalContent = (response.message?.trim() || last.content).trim() || 'No response returned.';
          return [...current.slice(0, -1), { ...last, content: normalizeAssistantCitations(finalContent), ...(response.usage ? { usage: response.usage } : {}) }];
        });
      } catch (chatError) {
        const errMsg = chatError instanceof Error ? chatError.message : 'Failed to send local chat request. Is Ollama running?';
        setError(errMsg);
        // Remove the empty assistant message on error
        setMessages((current) => current.filter((m) => m.id !== assistantMessage.id));
      } finally {
        removeStreamListener();
        setIsSending(false);
      }
      return;
    }

    /* ── Cloud mode ── */
    const inferredWorkMode = inferAutoWorkMode(content, messages);
    const resolvedWorkMode = workModeOverride === 'auto' ? inferredWorkMode : workModeOverride;

    const apiKey = getApiKey();
    setFalKey(apiKey);

    if (!apiKey) {
      setError('Add your fal.ai API key in Settings before using Cloud chat.');
      return;
    }

    const userMessage = createMessage('user', content);
    const nextMessages = [...messages, userMessage];

    setWorkMode(resolvedWorkMode);
    setMessages(nextMessages);
    setDraft('');
    setError('');
    setIsSending(true);

    try {
      if (resolvedWorkMode === 'cut') {
        const response = await window.electronAPI.llm.runCutWorkflow({
          apiKey,
          model,
          systemPrompt,
          request: content,
          projectId,
          activeTimelineId,
          index: projectInsightIndex,
          confirmedBrief: false,
          visionModel: getCutVisionModel(),
        });

        response.visualFindings.forEach((finding) => {
          onUpdateAssetAnalysis(finding.assetId, {
            llmVisualSummary: finding,
            llmVisualSummaryStatus: finding.status,
            llmIndexVersion: 1,
            llmIndexUpdatedAt: new Date().toISOString(),
          });
        });

        const assistantMessage = createMessage(
          'assistant',
          response.summaryMessage,
          {
            cutWorkflow: toChatCutWorkflow(response),
            ...(response.usage ? { usage: response.usage } : {}),
          },
        );

        setMessages((current) => [...current, assistantMessage]);
        return;
      }

      const projectContext = buildProjectContext({
        projectId,
        assets,
        mediaFolders,
        timelines,
        activeTimelineId,
        elements,
        mode: resolvedWorkMode,
        focusQuery: content,
      });

      const response = await window.electronAPI.llm.chat({
        apiKey,
        model,
        systemPrompt: [
          buildModeSystemPrompt(resolvedWorkMode),
          systemPrompt.trim(),
          projectContext,
        ].filter(Boolean).join('\n\n'),
        messages: nextMessages.map((message) => ({ role: message.role, content: message.content })),
        maxTokens,
        temperature,
      });

      const reply = response.message?.trim() || 'No response returned.';
      const normalizedReply = normalizeAssistantCitations(reply);
      const parsedCutSet = parseCutProposals(normalizedReply);
      const assistantMessage = createMessage(
        'assistant',
        parsedCutSet?.cleanedMessage || normalizedReply,
        {
          ...(parsedCutSet
            ? {
                cutPlans: parsedCutSet.proposals.map((proposal) => ({ proposal })),
              }
            : {}),
          ...(response.usage ? { usage: response.usage } : {}),
        },
      );

      setMessages((current) => [...current, assistantMessage]);
    } catch (chatError) {
      const errMsg = chatError instanceof Error ? chatError.message : 'Failed to send chat request.';
      setError(errMsg);
    } finally {
      setIsSending(false);
    }
  }, [activeTimelineId, assets, draft, elements, isSending, localModel, maxTokens, mediaFolders, messages, mode, model, normalizeAssistantCitations, onUpdateAssetAnalysis, projectId, projectInsightIndex, systemPrompt, temperature, timelines, workModeOverride]);

  const handleComposerKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    void handleSend();
  }, [handleSend]);

  // ── Session management ──

  const saveCurrentSession = useCallback(() => {
    if (messages.length === 0 && (sideUsage?.requestCount ?? 0) === 0) return;
    const sessionId = activeSessionId ?? crypto.randomUUID();
    const title = generateSessionTitle(messages);

    // Save session messages
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(
          getSessionStorageKey(projectId, sessionId),
          JSON.stringify({ messages, model, workMode, workModeOverride, systemPrompt, maxTokens, temperature, sideUsage }),
        );
      } catch {}
    }

    // Update history index
    setChatHistory((prev) => {
      const existing = prev.sessions.findIndex((s) => s.id === sessionId);
      const session: ChatSession = {
        id: sessionId,
        title,
        createdAt: existing >= 0 ? prev.sessions[existing].createdAt : new Date().toISOString(),
        messageCount: messages.length,
      };
      const next = existing >= 0
        ? prev.sessions.map((s) => (s.id === sessionId ? session : s))
        : [session, ...prev.sessions];
      const updated = { sessions: next, activeSessionId: sessionId };
      saveChatHistory(projectId, updated);
      return updated;
    });

    if (!activeSessionId) setActiveSessionId(sessionId);
  }, [activeSessionId, maxTokens, messages, model, projectId, sideUsage, systemPrompt, temperature, workMode, workModeOverride]);

  // Auto-save session when messages change
  useEffect(() => {
    if (messages.length > 0 || (sideUsage?.requestCount ?? 0) > 0) saveCurrentSession();
  }, [messages.length, saveCurrentSession, sideUsage?.requestCount]);

  const handleNewChat = useCallback(() => {
    saveCurrentSession();
    setMessages([]);
    setDraft('');
    setError('');
    setSideUsage(undefined);
    setActiveSessionId(null);
  }, [saveCurrentSession]);

  const handleLoadSession = useCallback((sessionId: string) => {
    // Save current first
    if (messages.length > 0 || (sideUsage?.requestCount ?? 0) > 0) saveCurrentSession();

    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(getSessionStorageKey(projectId, sessionId));
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.messages)) setMessages(parsed.messages);
      if (parsed.model) setModel(parsed.model);
      if (parsed.workMode) setWorkMode(parsed.workMode);
      if (parsed.workModeOverride === 'ask' || parsed.workModeOverride === 'search' || parsed.workModeOverride === 'cut' || parsed.workModeOverride === 'timeline') {
        setWorkModeOverride(parsed.workModeOverride);
      } else {
        setWorkModeOverride('auto');
      }
      if (parsed.systemPrompt) setSystemPrompt(parsed.systemPrompt);
      setSideUsage(parsed.sideUsage);
      setActiveSessionId(sessionId);
      setError('');

      // Update active in history
      setChatHistory((prev) => {
        const updated = { ...prev, activeSessionId: sessionId };
        saveChatHistory(projectId, updated);
        return updated;
      });
    } catch {}
  }, [messages.length, projectId, saveCurrentSession, sideUsage?.requestCount]);

  const handleDeleteSession = useCallback((sessionId: string) => {
    if (typeof window !== 'undefined') {
      try { localStorage.removeItem(getSessionStorageKey(projectId, sessionId)); } catch {}
    }
    setChatHistory((prev) => {
      const next = {
        sessions: prev.sessions.filter((s) => s.id !== sessionId),
        activeSessionId: prev.activeSessionId === sessionId ? null : prev.activeSessionId,
      };
      saveChatHistory(projectId, next);
      return next;
    });
    if (activeSessionId === sessionId) {
      setMessages([]);
      setDraft('');
      setActiveSessionId(null);
    }
  }, [activeSessionId, projectId]);

  const handleApplyCutMessage = useCallback((message: ChatMessage, proposal: CutProposal, planIndex = 0) => {
    const messageCutPlan = message.cutPlans?.[planIndex];
    if (messageCutPlan?.appliedTimelineId) return;
    if (!messageCutPlan && message.appliedTimelineId) return;
    applyCutProposal(message.id, proposal, planIndex);
  }, [applyCutProposal]);

  const handleApplyCombinedCutMessage = useCallback((message: ChatMessage, proposals: CutProposal[]) => {
    if (message.combinedTimelineId) return;
    applyCombinedCutPlans(message.id, proposals);
  }, [applyCombinedCutPlans]);

  const handleOpenAppliedTimeline = useCallback((timelineId: string | undefined) => {
    if (!timelineId) return;
    onOpenTimeline(timelineId);
  }, [onOpenTimeline]);

  const handleSetCutPreviewMode = useCallback((messageId: string, planIndex: number, previewMode: CutPreviewMode) => {
    setCutPreviewModes((current) => ({
      ...current,
      [getCutPreviewKey(messageId, planIndex)]: previewMode,
    }));
  }, []);

  const handleUpdateBriefField = useCallback((messageId: string, field: keyof EditorialBrief, value: string | number | boolean) => {
    setMessages((current) => current.map((message) => {
      if (message.id !== messageId || !message.cutWorkflow) return message;
      return {
        ...message,
        cutWorkflow: {
          ...message.cutWorkflow,
          editorialBrief: {
            ...message.cutWorkflow.editorialBrief,
            [field]: value,
          },
        },
      };
    }));
  }, []);

  const handleSelectClarifyingOption = useCallback((messageId: string, questionId: string, optionId: string) => {
    setMessages((current) => current.map((message) => {
      if (message.id !== messageId || !message.cutWorkflow) return message;
      return {
        ...message,
        cutWorkflow: {
          ...message.cutWorkflow,
          clarifyingQuestions: message.cutWorkflow.clarifyingQuestions.map((question) => (
            question.id === questionId
              ? { ...question, selectedOptionId: optionId }
              : question
          )),
        },
      };
    }));
  }, []);

  const handleUpdateClarifyingCustom = useCallback((messageId: string, questionId: string, value: string) => {
    setMessages((current) => current.map((message) => {
      if (message.id !== messageId || !message.cutWorkflow) return message;
      return {
        ...message,
        cutWorkflow: {
          ...message.cutWorkflow,
          clarifyingQuestions: message.cutWorkflow.clarifyingQuestions.map((question) => (
            question.id === questionId
              ? { ...question, customAnswer: value }
              : question
          )),
        },
      };
    }));
  }, []);

  const handleGenerateCutVariants = useCallback(async (messageId: string) => {
    const targetMessage = messages.find((message) => message.id === messageId);
    if (!targetMessage?.cutWorkflow || isSending) return;
    const messageIndex = messages.findIndex((message) => message.id === messageId);
    const sourceRequest = messages
      .slice(0, messageIndex)
      .reverse()
      .find((message) => message.role === 'user')?.content ?? '';

    const variantCount = targetMessage.cutWorkflow.editorialBrief.variantCount ?? 3;
    const questionAnswers = Object.fromEntries(
      targetMessage.cutWorkflow.clarifyingQuestions.flatMap((question) => {
        const selectedOption = question.options.find((option) => option.id === question.selectedOptionId);
        const custom = question.customAnswer?.trim();
        const answer = custom || selectedOption?.label;
        return answer ? [[question.id, answer]] : [];
      }),
    );

    setIsSending(true);
    setError('');
    try {
      const response = await window.electronAPI.llm.runCutWorkflow({
        apiKey: getApiKey(),
        model,
        systemPrompt,
        request: sourceRequest,
        projectId,
        activeTimelineId,
        index: projectInsightIndex,
        confirmedBrief: true,
        briefOverride: {
          ...targetMessage.cutWorkflow.editorialBrief,
          variantCount,
        },
        questionAnswers,
        visionModel: getCutVisionModel(),
      });

      response.visualFindings.forEach((finding) => {
        onUpdateAssetAnalysis(finding.assetId, {
          llmVisualSummary: finding,
          llmVisualSummaryStatus: finding.status,
          llmIndexVersion: 1,
          llmIndexUpdatedAt: new Date().toISOString(),
        });
      });

      setMessages((current) => current.map((message) => (
        message.id === messageId
          ? {
              ...message,
              content: response.summaryMessage,
              usage: mergeUsage(message.usage, response.usage),
              cutWorkflow: toChatCutWorkflow(response),
            }
          : message
      )));
    } catch (cutError) {
      setError(cutError instanceof Error ? cutError.message : 'Failed to generate cut variants.');
    } finally {
      setIsSending(false);
    }
  }, [activeTimelineId, isSending, messages, model, onUpdateAssetAnalysis, projectId, projectInsightIndex, systemPrompt]);

  const handleApplyWorkflowCutPlan = useCallback((messageId: string, variantIndex: number, planIndex: number) => {
    const message = messages.find((entry) => entry.id === messageId);
    const variant = message?.cutWorkflow?.variants[variantIndex];
    const cutPlan = variant?.plans[planIndex];
    if (!variant || !cutPlan || cutPlan.appliedTimelineId) return;

    const applied = buildTimelineFromCutProposal({
      proposal: cutPlan.proposal,
      assets,
      existingTimelines: timelines,
    });

    if (!applied) {
      setMessages((current) => current.map((entry) => (
        entry.id === messageId && entry.cutWorkflow
          ? {
              ...entry,
              cutWorkflow: {
                ...entry.cutWorkflow,
                variants: entry.cutWorkflow.variants.map((existingVariant, existingVariantIndex) => (
                  existingVariantIndex === variantIndex
                    ? {
                        ...existingVariant,
                        plans: existingVariant.plans.map((existingPlan, existingPlanIndex) => (
                          existingPlanIndex === planIndex
                            ? { ...existingPlan, applicationError: 'Unable to build a timeline from that cut plan.' }
                            : existingPlan
                        )),
                      }
                    : existingVariant
                )),
              },
            }
          : entry
      )));
      return;
    }

    onCreateTimelineFromCut(applied.timeline);
    setMessages((current) => current.map((entry) => (
      entry.id === messageId && entry.cutWorkflow
        ? {
            ...entry,
            cutWorkflow: {
              ...entry.cutWorkflow,
              variants: entry.cutWorkflow.variants.map((existingVariant, existingVariantIndex) => (
                existingVariantIndex === variantIndex
                  ? {
                      ...existingVariant,
                      plans: existingVariant.plans.map((existingPlan, existingPlanIndex) => (
                        existingPlanIndex === planIndex
                          ? {
                              ...existingPlan,
                              appliedTimelineId: applied.timeline.id,
                              appliedTimelineName: applied.timeline.name,
                              unresolvedSegmentCount: applied.unresolvedSegments.length,
                              applicationError: undefined,
                            }
                          : existingPlan
                      )),
                    }
                  : existingVariant
              )),
            },
          }
        : entry
    )));
  }, [assets, messages, onCreateTimelineFromCut, timelines]);

  const handleApplyWorkflowCombinedVariant = useCallback((messageId: string, variantIndex: number) => {
    const message = messages.find((entry) => entry.id === messageId);
    const variant = message?.cutWorkflow?.variants[variantIndex];
    if (!variant || variant.combinedTimelineId) return;

    const combinedProposal = buildCombinedCutProposal(variant.plans.map((plan) => plan.proposal));
    if (!combinedProposal) return;

    const applied = buildTimelineFromCutProposal({
      proposal: combinedProposal,
      assets,
      existingTimelines: timelines,
    });

    if (!applied) {
      setMessages((current) => current.map((entry) => (
        entry.id === messageId && entry.cutWorkflow
          ? {
              ...entry,
              cutWorkflow: {
                ...entry.cutWorkflow,
                variants: entry.cutWorkflow.variants.map((existingVariant, existingVariantIndex) => (
                  existingVariantIndex === variantIndex
                    ? { ...existingVariant, combinedApplicationError: 'Unable to build a combined timeline from those cut plans.' }
                    : existingVariant
                )),
              },
            }
          : entry
      )));
      return;
    }

    onCreateTimelineFromCut(applied.timeline);
    setMessages((current) => current.map((entry) => (
      entry.id === messageId && entry.cutWorkflow
        ? {
            ...entry,
            cutWorkflow: {
              ...entry.cutWorkflow,
              variants: entry.cutWorkflow.variants.map((existingVariant, existingVariantIndex) => (
                existingVariantIndex === variantIndex
                  ? {
                      ...existingVariant,
                      combinedTimelineId: applied.timeline.id,
                      combinedTimelineName: applied.timeline.name,
                      combinedUnresolvedSegmentCount: applied.unresolvedSegments.length,
                      combinedApplicationError: undefined,
                    }
                  : existingVariant
              )),
            },
          }
        : entry
    )));
  }, [assets, messages, onCreateTimelineFromCut, timelines]);

  const handleCitationClick = useCallback((citation: ParsedCitation) => {
    const resolvedCitation = resolveCitation(citation);

    if (resolvedCitation.kind === 'asset') {
      const assetId = assetIdByName.get(resolvedCitation.label.toLowerCase());
      if (!assetId) return;
      onNavigateToAssetCitation(assetId, resolvedCitation.seconds);
      return;
    }

    const timelineLabel = resolvedCitation.label.split('/ clip:')[0]?.trim() ?? resolvedCitation.label.trim();
    const timelineId = timelineIdByName.get(timelineLabel.toLowerCase());
    if (!timelineId) return;
    onNavigateToTimelineCitation(timelineId, resolvedCitation.seconds);
  }, [assetIdByName, onNavigateToAssetCitation, onNavigateToTimelineCitation, resolveCitation, timelineIdByName]);

  const renderCitationText = useCallback((text: string) => {
    const parts = parseCitationParts(text);
    if (parts.length === 1 && typeof parts[0] === 'string') return <>{text}</>;
    return (
      <>
        {parts.map((part, index) => {
          if (typeof part === 'string') return <span key={`t-${index}`}>{part}</span>;
          const resolvedPart = resolveCitation(part);
          const timelineLabel = resolvedPart.label.split('/ clip:')[0]?.trim() ?? resolvedPart.label.trim();
          const resolvable = resolvedPart.kind === 'asset'
            ? assetIdByName.has(resolvedPart.label.toLowerCase())
            : timelineIdByName.has(timelineLabel.toLowerCase());
          if (!resolvable) return <span key={`c-${index}`}>{resolvedPart.raw}</span>;
          return (
            <button
              key={`c-${index}`}
              type="button"
              className="copilot__citation"
              onClick={() => handleCitationClick(resolvedPart)}
              title={resolvedPart.kind === 'asset' ? 'Jump to timeline moment' : 'Open timeline at this time'}
            >
              {resolvedPart.raw}
            </button>
          );
        })}
      </>
    );
  }, [assetIdByName, handleCitationClick, resolveCitation, timelineIdByName]);

  const markdownComponents = useMemo(() => ({
    p: ({ children }: { children?: React.ReactNode }) => <p className="copilot__md-p">{children}</p>,
    strong: ({ children }: { children?: React.ReactNode }) => <strong className="copilot__md-strong">{children}</strong>,
    em: ({ children }: { children?: React.ReactNode }) => <em className="copilot__md-em">{children}</em>,
    h1: ({ children }: { children?: React.ReactNode }) => <h3 className="copilot__md-h">{children}</h3>,
    h2: ({ children }: { children?: React.ReactNode }) => <h3 className="copilot__md-h">{children}</h3>,
    h3: ({ children }: { children?: React.ReactNode }) => <h3 className="copilot__md-h">{children}</h3>,
    h4: ({ children }: { children?: React.ReactNode }) => <h4 className="copilot__md-h copilot__md-h--sm">{children}</h4>,
    ul: ({ children }: { children?: React.ReactNode }) => <ul className="copilot__md-ul">{children}</ul>,
    ol: ({ children }: { children?: React.ReactNode }) => <ol className="copilot__md-ol">{children}</ol>,
    li: ({ children }: { children?: React.ReactNode }) => <li className="copilot__md-li">{children}</li>,
    hr: () => <hr className="copilot__md-hr" />,
    blockquote: ({ children }: { children?: React.ReactNode }) => <blockquote className="copilot__md-blockquote">{children}</blockquote>,
    code: ({ className, children }: { className?: string; children?: React.ReactNode }) => {
      const isBlock = className?.startsWith('language-');
      if (isBlock) return <pre className="copilot__md-pre"><code>{children}</code></pre>;
      return <code className="copilot__md-code">{children}</code>;
    },
    pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  }), []);

  const renderMessageContent = useCallback((content: string, role: ChatRole = 'assistant') => {
    if (role === 'user') {
      return renderCitationText(content);
    }

    // For assistant messages: replace citations with placeholders, render markdown, then restore
    const citations: ParsedCitation[] = [];
    const PLACEHOLDER_PREFIX = '\u200B\u200BCITE_';
    const processed = content.replace(
      /\[(asset|timeline):(.+?)(?:\s*@\s*([0-9:.]+))?\]/g,
      (raw, kindRaw, labelRaw, timestampLabel) => {
        const idx = citations.length;
        citations.push({
          kind: kindRaw === 'timeline' ? 'timeline' : 'asset',
          raw,
          label: labelRaw.trim(),
          timestampLabel: timestampLabel ?? '',
          seconds: (timestampLabel ? parseCitationTime(timestampLabel) : 0) ?? 0,
        });
        return `${PLACEHOLDER_PREFIX}${idx}\u200B\u200B`;
      },
    );

    const citationComponents = {
      ...markdownComponents,
      p: ({ children }: { children?: React.ReactNode }) => (
        <p className="copilot__md-p">{injectCitations(children, citations, resolveCitation, assetIdByName, timelineIdByName, handleCitationClick, PLACEHOLDER_PREFIX)}</p>
      ),
      li: ({ children }: { children?: React.ReactNode }) => (
        <li className="copilot__md-li">{injectCitations(children, citations, resolveCitation, assetIdByName, timelineIdByName, handleCitationClick, PLACEHOLDER_PREFIX)}</li>
      ),
      strong: ({ children }: { children?: React.ReactNode }) => (
        <strong className="copilot__md-strong">{injectCitations(children, citations, resolveCitation, assetIdByName, timelineIdByName, handleCitationClick, PLACEHOLDER_PREFIX)}</strong>
      ),
      em: ({ children }: { children?: React.ReactNode }) => (
        <em className="copilot__md-em">{injectCitations(children, citations, resolveCitation, assetIdByName, timelineIdByName, handleCitationClick, PLACEHOLDER_PREFIX)}</em>
      ),
    };

    return <ReactMarkdown components={citationComponents}>{processed}</ReactMarkdown>;
  }, [assetIdByName, handleCitationClick, markdownComponents, renderCitationText, resolveCitation, timelineIdByName]);

  const hasMessages = messages.length > 0 || isSending;

  // ── @-mention autocomplete ──

  const slashMentionItems = useMemo(() => {
    const items: Array<{ id: string; label: string; type: string }> = [];
    for (const asset of mediaPoolMentionAssets) {
      items.push({ id: asset.id, label: asset.name, type: asset.type });
    }
    for (const clip of clipsList) {
      items.push({ id: clip.id, label: clip.clipName, type: 'clip' });
    }
    return items;
  }, [clipsList, mediaPoolMentionAssets]);

  const elementMentionItems = useMemo(() => (
    elements.map((element) => ({
      id: element.id,
      label: element.name,
      type: element.type,
    }))
  ), [elements]);

  const mentionItems = useMemo(() => {
    if (mentionTrigger === '@') return elementMentionItems;
    if (mentionTrigger === '/') return slashMentionItems;
    return [];
  }, [elementMentionItems, mentionTrigger, slashMentionItems]);

  const deferredMentionQuery = useDeferredValue(mentionQuery);

  const mentionResults = useMemo(() => {
    if (deferredMentionQuery === null) return [];
    if (deferredMentionQuery === '') return mentionItems;
    const q = deferredMentionQuery.toLowerCase();
    return mentionItems.filter((item) => item.label.toLowerCase().includes(q));
  }, [deferredMentionQuery, mentionItems]);

  const clearMention = useCallback(() => {
    setMentionQuery(null);
    setMentionTrigger(null);
    setMentionIndex(0);
  }, []);

  const resizeComposerTextarea = useCallback(() => {
    const el = composerRef.current;
    if (!el) return;
    const styles = window.getComputedStyle(el);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 22.5;
    const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0;
    const borderTop = Number.parseFloat(styles.borderTopWidth) || 0;
    const borderBottom = Number.parseFloat(styles.borderBottomWidth) || 0;
    const minHeight = lineHeight + paddingTop + paddingBottom + borderTop + borderBottom;
    const maxHeight = (lineHeight * 3) + paddingTop + paddingBottom + borderTop + borderBottom;

    el.style.height = 'auto';
    const nextHeight = Math.min(Math.max(el.scrollHeight, minHeight), maxHeight);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, []);

  useEffect(() => {
    resizeComposerTextarea();
  }, [draft, resizeComposerTextarea]);

  const handleEnhancePrompt = useCallback(async () => {
    if (mode !== 'cloud' || isSending || isEnhancingPrompt) return;

    const content = draft.trim();
    if (!content) return;

    const apiKey = getApiKey();
    setFalKey(apiKey);

    if (!apiKey) {
      setError('Add your fal.ai API key in Settings before enhancing prompts.');
      return;
    }

    setError('');
    setIsEnhancingPrompt(true);

    try {
      const routedMode = inferAutoWorkMode(content, messages);
      const projectContext = buildProjectContext({
        projectId,
        assets,
        mediaFolders,
        timelines,
        activeTimelineId,
        elements,
        mode: routedMode,
      });

      const response = await window.electronAPI.llm.chat({
        apiKey,
        model,
        systemPrompt: [
          'You rewrite rough user requests into stronger CineGen prompts.',
          'Preserve the user intent, requested duration, deliverable, assets, and creative goal.',
          'Preserve any /asset mentions and @element mentions exactly as written.',
          'Do not invent footage, facts, structure, or constraints that the user did not provide.',
          'Keep the rewritten prompt concise, direct, and immediately usable.',
          'Return only the rewritten prompt text with no explanation.',
          projectContext,
        ].filter(Boolean).join('\n\n'),
        messages: [{ role: 'user', content }],
        maxTokens: 400,
        temperature: 0.35,
      });

      const rewritten = response.message?.trim();
      if (!rewritten) throw new Error('No enhanced prompt returned.');

      setSideUsage((current) => mergeSideUsage(current, response.usage));
      setDraft(rewritten);
      requestAnimationFrame(() => {
        resizeComposerTextarea();
        composerRef.current?.focus();
        composerRef.current?.setSelectionRange(0, 0);
        if (composerRef.current) composerRef.current.scrollTop = 0;
      });
    } catch (enhanceError) {
      setError(enhanceError instanceof Error ? enhanceError.message : 'Failed to enhance prompt.');
    } finally {
      setIsEnhancingPrompt(false);
    }
  }, [
    activeTimelineId,
    assets,
    draft,
    elements,
    isEnhancingPrompt,
    isSending,
    mediaFolders,
    messages,
    mode,
    model,
    projectId,
    resizeComposerTextarea,
    timelines,
  ]);

  const insertComposerToken = useCallback((prefix: MentionTrigger, label: string) => {
    setDraft((current) => `${current}${current && !current.endsWith(' ') ? ' ' : ''}${prefix}${label} `);
    setIndexPopover(null);
    requestAnimationFrame(() => {
      resizeComposerTextarea();
      composerRef.current?.focus();
    });
  }, [resizeComposerTextarea]);

  const handleComposerInput = useCallback((source?: HTMLTextAreaElement | null) => {
    const el = source ?? composerRef.current;
    if (!el) return;
    const pos = el.selectionStart;
    const text = el.value.slice(0, pos);
    const triggers: MentionTrigger[] = ['/', '@'];
    for (const candidate of triggers
      .map((trigger) => ({ trigger, index: text.lastIndexOf(trigger) }))
      .sort((a, b) => b.index - a.index)) {
      if (candidate.index < 0) continue;
      if (candidate.index !== 0 && !/\s/.test(text[candidate.index - 1])) continue;
      const query = text.slice(candidate.index + 1);
      if (!query.includes(' ') && !query.includes('\n')) {
        setMentionQuery(query);
        setMentionTrigger(candidate.trigger);
        setMentionIndex(0);
        return;
      }
    }
    clearMention();
  }, [clearMention]);

  const applyMention = useCallback((label: string) => {
    const el = composerRef.current;
    if (!el || !mentionTrigger) return;
    const pos = el.selectionStart;
    const text = draft;
    const before = text.slice(0, pos);
    const triggerIndex = before.lastIndexOf(mentionTrigger);
    if (triggerIndex < 0) return;
    const newText = text.slice(0, triggerIndex) + mentionTrigger + label + ' ' + text.slice(pos);
    setDraft(newText);
    clearMention();
    requestAnimationFrame(() => {
      const newPos = triggerIndex + label.length + 2;
      el.setSelectionRange(newPos, newPos);
      el.focus();
    });
  }, [clearMention, draft, mentionTrigger]);

  const modePromptExamples = [
    'Summarize the strongest themes across my transcripts',
    'Find every clip where she mentions budget',
    'Build a 45-second highlight reel from the best quotes',
    'Describe the pacing of the current edit',
  ];
  const routedWorkMode = useMemo(
    () => inferAutoWorkMode(draft, messages),
    [draft, messages],
  );
  const displayedWorkMode = draft.trim()
    ? (workModeOverride === 'auto' ? routedWorkMode : workModeOverride)
    : (workModeOverride === 'auto' ? workMode : workModeOverride);

  const renderedMessages = useMemo(() => messages.map((message) => {
    const workflow = message.cutWorkflow;
    const legacyParsedCutSet = !message.cutPlans && !message.cutProposal && message.role === 'assistant'
      ? parseCutProposals(message.content)
      : null;
    const messageCutPlans: ChatMessageCutPlan[] = message.cutPlans ?? (message.cutProposal ? [{
      proposal: message.cutProposal,
      appliedTimelineId: message.appliedTimelineId,
      appliedTimelineName: message.appliedTimelineName,
      unresolvedSegmentCount: message.unresolvedSegmentCount,
      applicationError: message.applicationError,
    }] : legacyParsedCutSet?.proposals.map((proposal) => ({ proposal })) ?? []);
    const messageBodyContent = sanitizeWorkflowMessageContent(
      legacyParsedCutSet?.cleanedMessage || message.content,
      workflow,
    );
    const canCreateCombinedTimeline = messageCutPlans.length > 1;

    return (
      <article key={message.id} className={`copilot__msg copilot__msg--${message.role}`}>
        {message.role === 'user' ? (
          <div className="copilot__msg-bubble">{renderMessageContent(message.content, 'user')}</div>
        ) : (
          <div className="copilot__msg-open">
            <div className="copilot__msg-body">{renderMessageContent(messageBodyContent, 'assistant')}</div>
            {message.usage && (
              <div className="copilot__msg-usage">
                <span>{formatCurrency(message.usage.cost)}</span>
                <span className="copilot__msg-usage-sep" />
                <span>{formatCount(message.usage.totalTokens)} tokens</span>
              </div>
            )}
          </div>
        )}

        {workflow && (
          <div className="copilot__workflow">
            <div className="copilot__workflow-head">
              <div>
                <div className="copilot__workflow-title">Editorial Brief</div>
                <div className="copilot__workflow-sub">{workflow.retrievalSummary.note}</div>
              </div>
              <span className={`copilot__workflow-stage copilot__workflow-stage--${workflow.stage}`}>
                {workflow.stage === 'brief' ? 'Brief' : 'Variants'}
              </span>
            </div>

            <div className="copilot__brief-grid">
              <label className="copilot__brief-field">
                <span>Piece Type</span>
                <input
                  value={workflow.editorialBrief.pieceType}
                  onChange={(event) => handleUpdateBriefField(message.id, 'pieceType', event.target.value)}
                />
              </label>
              <label className="copilot__brief-field">
                <span>Audience</span>
                <input
                  value={workflow.editorialBrief.audience}
                  onChange={(event) => handleUpdateBriefField(message.id, 'audience', event.target.value)}
                />
              </label>
              <label className="copilot__brief-field">
                <span>Tone</span>
                <input
                  value={workflow.editorialBrief.tone}
                  onChange={(event) => handleUpdateBriefField(message.id, 'tone', event.target.value)}
                />
              </label>
              <label className="copilot__brief-field">
                <span>Pacing</span>
                <input
                  value={workflow.editorialBrief.pacing}
                  onChange={(event) => handleUpdateBriefField(message.id, 'pacing', event.target.value)}
                />
              </label>
              <label className="copilot__brief-field">
                <span>Duration (sec)</span>
                <input
                  type="number"
                  min={5}
                  value={workflow.editorialBrief.targetDurationSeconds}
                  onChange={(event) => handleUpdateBriefField(message.id, 'targetDurationSeconds', Math.max(5, Number(event.target.value) || 30))}
                />
              </label>
              <label className="copilot__brief-field">
                <span>Variants</span>
                <select
                  value={workflow.editorialBrief.variantCount ?? 3}
                  onChange={(event) => handleUpdateBriefField(message.id, 'variantCount', Number(event.target.value) <= 1 ? 1 : 3)}
                >
                  <option value={1}>Single</option>
                  <option value={3}>Multiple (3)</option>
                </select>
              </label>
              <label className="copilot__brief-field">
                <span>Persona</span>
                <select
                  value={workflow.editorialBrief.persona}
                  onChange={(event) => handleUpdateBriefField(message.id, 'persona', event.target.value)}
                >
                  <option value="documentary-editor">Documentary Editor</option>
                  <option value="promo-trailer-editor">Promo / Trailer Editor</option>
                  <option value="brand-storyteller">Brand Storyteller</option>
                  <option value="social-shortform-editor">Social Shortform Editor</option>
                  <option value="interview-producer">Interview Producer</option>
                </select>
              </label>
              <label className="copilot__brief-field copilot__brief-field--wide">
                <span>Story Goal</span>
                <textarea
                  rows={2}
                  value={workflow.editorialBrief.storyGoal}
                  onChange={(event) => handleUpdateBriefField(message.id, 'storyGoal', event.target.value)}
                />
              </label>
              <label className="copilot__brief-field copilot__brief-field--wide">
                <span>Hook</span>
                <textarea
                  rows={2}
                  value={workflow.editorialBrief.hook}
                  onChange={(event) => handleUpdateBriefField(message.id, 'hook', event.target.value)}
                />
              </label>
              <label className="copilot__brief-field copilot__brief-field--wide">
                <span>Reference Timeline</span>
                <select
                  value={workflow.editorialBrief.referenceTimelineId ?? ''}
                  onChange={(event) => {
                    const timeline = timelines.find((entry) => entry.id === event.target.value);
                    handleUpdateBriefField(message.id, 'referenceTimelineId', timeline?.id ?? '');
                    handleUpdateBriefField(message.id, 'referenceTimelineName', timeline?.name ?? '');
                  }}
                >
                  <option value="">None</option>
                  {timelines.map((timeline) => (
                    <option key={timeline.id} value={timeline.id}>{timeline.name}</option>
                  ))}
                </select>
              </label>
            </div>

            {workflow.clarifyingQuestions.length > 0 && (
              <div className="copilot__questions">
                <div className="copilot__questions-title">Need a little more direction</div>
                {workflow.clarifyingQuestions.map((question) => (
                  <div key={question.id} className="copilot__question">
                    <div className="copilot__question-text">{question.question}</div>
                    {question.help && <div className="copilot__question-help">{question.help}</div>}
                    <div className="copilot__question-options">
                      {question.options.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          className={`copilot__question-chip${question.selectedOptionId === option.id ? ' copilot__question-chip--active' : ''}`}
                          onClick={() => handleSelectClarifyingOption(message.id, question.id, option.id)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    {question.allowCustom !== false && (
                      <input
                        className="copilot__question-custom"
                        placeholder="Custom answer"
                        value={question.customAnswer ?? ''}
                        onChange={(event) => handleUpdateClarifyingCustom(message.id, question.id, event.target.value)}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            {workflow.stage === 'brief' ? (
              <div className="copilot__workflow-actions">
                {(() => {
                  const variantCount = workflow.editorialBrief.variantCount ?? 3;
                  return (
                    <button className="copilot__btn copilot__btn--accent" onClick={() => void handleGenerateCutVariants(message.id)}>
                      {variantCount === 1 ? 'Generate Variant' : `Generate ${variantCount} Variants`}
                    </button>
                  );
                })()}
                <span className="copilot__workflow-confidence">
                  Confidence {Math.round(workflow.editorialBrief.confidence * 100)}%
                </span>
              </div>
            ) : (
              <div className="copilot__workflow-variants">
                {workflow.variants.map((variant, variantIndex) => (
                  <div key={`${message.id}-${variant.id}`} className="copilot__variant">
                    <div className="copilot__variant-head">
                      <div>
                        <div className="copilot__variant-title">
                          {variantIndex === 0 && <span className="copilot__variant-rank">Top Pick</span>}
                          {variant.title}
                        </div>
                        <div className="copilot__variant-strategy">{variant.strategy}</div>
                      </div>
                      <div className="copilot__variant-score">{Math.round(variant.scorecard.overall)}</div>
                    </div>
                    <div className="copilot__variant-summary">{variant.summary}</div>
                    <div className="copilot__variant-rationale">{variant.rationale}</div>
                    <div className="copilot__variant-metrics">
                      <span>Story {Math.round(variant.scorecard.storyArc)}</span>
                      <span>Pacing {Math.round(variant.scorecard.pacing)}</span>
                      <span>Clarity {Math.round(variant.scorecard.clarity)}</span>
                      <span>Visual {Math.round(variant.scorecard.visualFit)}</span>
                      <span>Format {Math.round(variant.scorecard.formatFit)}</span>
                    </div>
                    {variant.scorecard.strengths.length > 0 && (
                      <div className="copilot__variant-notes">
                        <strong>Why it works:</strong> {variant.scorecard.strengths.join(' • ')}
                      </div>
                    )}
                    {variant.plans.length > 1 && (
                      <div className="copilot__cut-bundle">
                        <div className="copilot__cut-bundle-copy">
                          <span className="copilot__cut-bundle-title">Multi-part variant</span>
                          <span className="copilot__cut-bundle-desc">Create the parts individually or build one combined timeline.</span>
                        </div>
                        <div className="copilot__cut-bundle-actions">
                          {variant.combinedTimelineId ? (
                            <>
                              <span className="copilot__cut-applied">{variant.combinedTimelineName ?? 'Combined timeline'}</span>
                              <button className="copilot__btn copilot__btn--ghost" onClick={() => handleOpenAppliedTimeline(variant.combinedTimelineId)}>Open Combined</button>
                            </>
                          ) : (
                            <button className="copilot__btn copilot__btn--ghost" onClick={() => handleApplyWorkflowCombinedVariant(message.id, variantIndex)}>
                              Create Combined Timeline
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {variant.plans.map((cutPlan, planIndex) => {
                      const previewKey = getCutPreviewKey(message.id, (variantIndex * 100) + planIndex);
                      const previewMode = cutPreviewModes[previewKey] ?? 'paper';
                      const totalDuration = cutPlan.proposal.segments.reduce((sum, segment) => (
                        sum + Math.max(0, segment.source_end - segment.source_start)
                      ), 0);
                      const rawPlanText = formatRawCutPlan(cutPlan.proposal);
                      return (
                        <div key={`${message.id}-${variant.id}-plan-${planIndex}`} className="copilot__cut">
                          <div className="copilot__cut-head">
                            <div>
                              <div className="copilot__cut-name">{cutPlan.proposal.timeline_name}</div>
                              <div className="copilot__cut-desc">{cutPlan.proposal.summary}</div>
                            </div>
                            <span className="copilot__cut-count">{cutPlan.proposal.segments.length}</span>
                          </div>
                          <div className="copilot__cut-toolbar">
                            <div className="copilot__cut-preview-toggle" role="tablist" aria-label="Cut preview mode">
                              <button type="button" className={`copilot__cut-preview-btn${previewMode === 'paper' ? ' copilot__cut-preview-btn--active' : ''}`} onClick={() => handleSetCutPreviewMode(message.id, (variantIndex * 100) + planIndex, 'paper')}>Paper Edit</button>
                              <button type="button" className={`copilot__cut-preview-btn${previewMode === 'timeline' ? ' copilot__cut-preview-btn--active' : ''}`} onClick={() => handleSetCutPreviewMode(message.id, (variantIndex * 100) + planIndex, 'timeline')}>Visual Preview</button>
                              <button type="button" className={`copilot__cut-preview-btn${previewMode === 'raw' ? ' copilot__cut-preview-btn--active' : ''}`} onClick={() => handleSetCutPreviewMode(message.id, (variantIndex * 100) + planIndex, 'raw')}>Raw Plan</button>
                            </div>
                            <span className="copilot__cut-duration">{formatSeconds(totalDuration)} planned</span>
                          </div>
                          {previewMode === 'timeline' ? (
                            <div className="copilot__cut-timeline-preview">
                              <div className="copilot__cut-track">
                                {cutPlan.proposal.segments.map((segment, index) => {
                                  const segmentDuration = Math.max(0.1, segment.source_end - segment.source_start);
                                  const widthPercent = totalDuration > 0 ? (segmentDuration / totalDuration) * 100 : 0;
                                  return (
                                    <div key={`${message.id}-${variant.id}-${planIndex}-timeline-${index}`} className="copilot__cut-block" style={{ width: `${widthPercent}%` }} title={`${formatSeconds(segment.source_start)} – ${formatSeconds(segment.source_end)}${segment.note ? ` • ${segment.note}` : ''}`}>
                                      <span className="copilot__cut-block-num">{index + 1}</span>
                                    </div>
                                  );
                                })}
                              </div>
                              <div className="copilot__cut-block-list">
                                {cutPlan.proposal.segments.map((segment, index) => (
                                  <div key={`${message.id}-${variant.id}-${planIndex}-timeline-copy-${index}`} className="copilot__cut-block-row">
                                    <span className="copilot__cut-block-row-num">{String(index + 1).padStart(2, '0')}</span>
                                    <span className="copilot__cut-block-row-copy">
                                      {formatSeconds(segment.source_start)} {'\u2013'} {formatSeconds(segment.source_end)}
                                      {segment.note ? ` • ${segment.note}` : ''}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : previewMode === 'paper' ? (
                            <div className="copilot__cut-segments">
                              {cutPlan.proposal.segments.map((segment, index) => {
                                const assetLabel = segment.asset_name
                                  || (segment.asset_id ? assetNameById.get(segment.asset_id) : undefined)
                                  || segment.asset_id
                                  || 'Unknown asset';
                                return (
                                  <div key={`${message.id}-${variant.id}-${planIndex}-${index}`} className="copilot__cut-seg">
                                    <span className="copilot__cut-seg-num">{String(index + 1).padStart(2, '0')}</span>
                                    <div className="copilot__cut-seg-info">
                                      <span className="copilot__cut-seg-asset">{assetLabel}</span>
                                      <span className="copilot__cut-seg-tc">{formatSeconds(segment.source_start)} {'\u2013'} {formatSeconds(segment.source_end)}</span>
                                      {segment.note && <span className="copilot__cut-seg-note">{segment.note}</span>}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="copilot__cut-raw-wrap">
                              <pre className="copilot__cut-raw"><code>{rawPlanText}</code></pre>
                            </div>
                          )}
                          {typeof cutPlan.unresolvedSegmentCount === 'number' && cutPlan.unresolvedSegmentCount > 0 && (
                            <div className="copilot__alert copilot__alert--warn copilot__alert--inline">
                              Skipped {cutPlan.unresolvedSegmentCount} segment{cutPlan.unresolvedSegmentCount === 1 ? '' : 's'} {'\u2014'} asset not resolved.
                            </div>
                          )}
                          {cutPlan.applicationError && (
                            <div className="copilot__alert copilot__alert--error copilot__alert--inline">{cutPlan.applicationError}</div>
                          )}
                          <div className="copilot__cut-actions">
                            {cutPlan.appliedTimelineId ? (
                              <>
                                <span className="copilot__cut-applied">{cutPlan.appliedTimelineName ?? 'New timeline'}</span>
                                <button className="copilot__btn copilot__btn--ghost" onClick={() => handleOpenAppliedTimeline(cutPlan.appliedTimelineId)}>Open in Edit</button>
                              </>
                            ) : (
                              <button className="copilot__btn copilot__btn--accent" onClick={() => handleApplyWorkflowCutPlan(message.id, variantIndex, planIndex)}>Create Timeline</button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!workflow && canCreateCombinedTimeline && (
          <div className="copilot__cut-bundle">
            <div className="copilot__cut-bundle-copy">
              <span className="copilot__cut-bundle-title">Multi-part cut</span>
              <span className="copilot__cut-bundle-desc">Create each part separately, or build one combined timeline from all proposed parts.</span>
            </div>
            <div className="copilot__cut-bundle-actions">
              {message.combinedTimelineId ? (
                <>
                  <span className="copilot__cut-applied">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    {message.combinedTimelineName ?? 'Combined timeline'}
                  </span>
                  <button className="copilot__btn copilot__btn--ghost" onClick={() => handleOpenAppliedTimeline(message.combinedTimelineId)}>Open Combined</button>
                </>
              ) : (
                <button className="copilot__btn copilot__btn--ghost" onClick={() => handleApplyCombinedCutMessage(message, messageCutPlans.map((cutPlan) => cutPlan.proposal))}>
                  Create Combined Timeline
                </button>
              )}
            </div>
          </div>
        )}

        {!workflow && messageCutPlans.map((cutPlan, planIndex) => {
          const previewKey = getCutPreviewKey(message.id, planIndex);
          const previewMode = cutPreviewModes[previewKey] ?? 'paper';
          const totalDuration = cutPlan.proposal.segments.reduce((sum, segment) => (
            sum + Math.max(0, segment.source_end - segment.source_start)
          ), 0);
          const rawPlanText = formatRawCutPlan(cutPlan.proposal);

          return (
            <div key={`${message.id}-cut-${planIndex}`} className="copilot__cut">
              <div className="copilot__cut-head">
                <div>
                  <div className="copilot__cut-name">{cutPlan.proposal.timeline_name}</div>
                  <div className="copilot__cut-desc">{cutPlan.proposal.summary}</div>
                </div>
                <span className="copilot__cut-count">{cutPlan.proposal.segments.length}</span>
              </div>

              <div className="copilot__cut-toolbar">
                <div className="copilot__cut-preview-toggle" role="tablist" aria-label="Cut preview mode">
                  <button
                    type="button"
                    className={`copilot__cut-preview-btn${previewMode === 'paper' ? ' copilot__cut-preview-btn--active' : ''}`}
                    onClick={() => handleSetCutPreviewMode(message.id, planIndex, 'paper')}
                  >
                    Paper Edit
                  </button>
                  <button
                    type="button"
                    className={`copilot__cut-preview-btn${previewMode === 'timeline' ? ' copilot__cut-preview-btn--active' : ''}`}
                    onClick={() => handleSetCutPreviewMode(message.id, planIndex, 'timeline')}
                  >
                    Visual Preview
                  </button>
                  <button
                    type="button"
                    className={`copilot__cut-preview-btn${previewMode === 'raw' ? ' copilot__cut-preview-btn--active' : ''}`}
                    onClick={() => handleSetCutPreviewMode(message.id, planIndex, 'raw')}
                  >
                    Raw Plan
                  </button>
                </div>
                <span className="copilot__cut-duration">{formatSeconds(totalDuration)} planned</span>
              </div>

              {previewMode === 'timeline' ? (
                <div className="copilot__cut-timeline-preview">
                  <div className="copilot__cut-track">
                    {cutPlan.proposal.segments.map((segment, index) => {
                      const segmentDuration = Math.max(0.1, segment.source_end - segment.source_start);
                      const widthPercent = totalDuration > 0 ? (segmentDuration / totalDuration) * 100 : 0;
                      return (
                        <div
                          key={`${message.id}-${planIndex}-timeline-${index}`}
                          className="copilot__cut-block"
                          style={{ width: `${widthPercent}%` }}
                          title={`${formatSeconds(segment.source_start)} – ${formatSeconds(segment.source_end)}${segment.note ? ` • ${segment.note}` : ''}`}
                        >
                          <span className="copilot__cut-block-num">{index + 1}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="copilot__cut-block-list">
                    {cutPlan.proposal.segments.map((segment, index) => (
                      <div key={`${message.id}-${planIndex}-timeline-copy-${index}`} className="copilot__cut-block-row">
                        <span className="copilot__cut-block-row-num">{String(index + 1).padStart(2, '0')}</span>
                        <span className="copilot__cut-block-row-copy">
                          {formatSeconds(segment.source_start)} {'\u2013'} {formatSeconds(segment.source_end)}
                          {segment.note ? ` • ${segment.note}` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : previewMode === 'paper' ? (
                <div className="copilot__cut-segments">
                  {cutPlan.proposal.segments.map((segment, index) => {
                    const assetLabel = segment.asset_name
                      || (segment.asset_id ? assetNameById.get(segment.asset_id) : undefined)
                      || segment.asset_id
                      || 'Unknown asset';
                    return (
                      <div key={`${message.id}-${planIndex}-${index}`} className="copilot__cut-seg">
                        <span className="copilot__cut-seg-num">{String(index + 1).padStart(2, '0')}</span>
                        <div className="copilot__cut-seg-info">
                          <span className="copilot__cut-seg-asset">{assetLabel}</span>
                          <span className="copilot__cut-seg-tc">
                            {formatSeconds(segment.source_start)} {'\u2013'} {formatSeconds(segment.source_end)}
                          </span>
                          {segment.note && <span className="copilot__cut-seg-note">{segment.note}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="copilot__cut-raw-wrap">
                  <pre className="copilot__cut-raw"><code>{rawPlanText}</code></pre>
                </div>
              )}

              {typeof cutPlan.unresolvedSegmentCount === 'number' && cutPlan.unresolvedSegmentCount > 0 && (
                <div className="copilot__alert copilot__alert--warn copilot__alert--inline">
                  Skipped {cutPlan.unresolvedSegmentCount} segment{cutPlan.unresolvedSegmentCount === 1 ? '' : 's'} {'\u2014'} asset not resolved.
                </div>
              )}
              {cutPlan.applicationError && (
                <div className="copilot__alert copilot__alert--error copilot__alert--inline">{cutPlan.applicationError}</div>
              )}
              <div className="copilot__cut-actions">
                {cutPlan.appliedTimelineId ? (
                  <>
                    <span className="copilot__cut-applied">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      {cutPlan.appliedTimelineName ?? 'New timeline'}
                    </span>
                    <button className="copilot__btn copilot__btn--ghost" onClick={() => handleOpenAppliedTimeline(cutPlan.appliedTimelineId)}>Open in Edit</button>
                  </>
                ) : (
                  <button className="copilot__btn copilot__btn--accent" onClick={() => handleApplyCutMessage(message, cutPlan.proposal, planIndex)}>Create Timeline</button>
                )}
              </div>
            </div>
          );
        })}
      </article>
    );
  }), [
    assetNameById,
    cutPreviewModes,
    handleApplyCombinedCutMessage,
    handleApplyCutMessage,
    handleApplyWorkflowCombinedVariant,
    handleApplyWorkflowCutPlan,
    handleGenerateCutVariants,
    handleOpenAppliedTimeline,
    handleSelectClarifyingOption,
    handleSetCutPreviewMode,
    handleUpdateBriefField,
    handleUpdateClarifyingCustom,
    messages,
    renderMessageContent,
    timelines,
  ]);

  /* ── Composer ── */
  const composerBar = (
    <div className={`copilot__composer${hasMessages ? '' : ' copilot__composer--hero'}`}>
      <div className={`copilot__composer-surface${isEnhancingPrompt ? ' copilot__composer-surface--enhancing' : ''}`}>
        <textarea
          ref={composerRef}
          className="copilot__composer-input"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            handleComposerInput(event.currentTarget);
          }}
          onKeyDown={(event) => {
            // Mention dropdown keyboard nav
            if (mentionQuery !== null && mentionResults.length > 0) {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setMentionIndex((i) => Math.min(i + 1, mentionResults.length - 1));
                return;
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setMentionIndex((i) => Math.max(i - 1, 0));
                return;
              }
              if (event.key === 'Enter' || event.key === 'Tab') {
                event.preventDefault();
                applyMention(mentionResults[mentionIndex].label);
                return;
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                clearMention();
                return;
              }
            }
            handleComposerKeyDown(event);
          }}
          onBlur={() => { setTimeout(clearMention, 150); }}
          placeholder={hasMessages ? 'Reply\u2026' : 'How can I help you today?'}
          disabled={isSending || isEnhancingPrompt}
          rows={1}
        />
        {mentionQuery !== null && mentionResults.length > 0 && (
          <div className="copilot__mention-dropdown">
            {mentionResults.map((item, i) => (
              <button
                key={`${item.type}-${item.id}`}
                className={`copilot__mention-item${i === mentionIndex ? ' copilot__mention-item--active' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); applyMention(item.label); }}
                onMouseEnter={() => setMentionIndex(i)}
              >
                <span className="copilot__mention-name">{item.label}</span>
                <span className="copilot__mention-type">{item.type}</span>
              </button>
            ))}
          </div>
        )}
        <div className="copilot__composer-footer">
          <div className="copilot__composer-actions">
            <button
              type="button"
              className={`copilot__composer-enhance${draft.trim() && falKey ? ' copilot__composer-enhance--ready' : ''}`}
              onClick={() => void handleEnhancePrompt()}
              disabled={!draft.trim() || isSending || isEnhancingPrompt || !falKey || mode !== 'cloud'}
            >
              {isEnhancingPrompt ? 'Enhancing\u2026' : 'Enhance Prompt'}
            </button>
          </div>
          <div className="copilot__composer-end">
            <div className="copilot__composer-model">
              {mode === 'cloud' ? (
                <select
                  className="copilot__model-select"
                  value={MODEL_SUGGESTIONS.includes(model) ? model : ''}
                  onChange={(event) => setModel(event.target.value)}
                >
                  {MODEL_SUGGESTIONS.map((suggestion) => (
                    <option key={suggestion} value={suggestion}>
                      {suggestion.split('/').pop()}
                    </option>
                  ))}
                  {!MODEL_SUGGESTIONS.includes(model) && (
                    <option value={model}>{model}</option>
                  )}
                </select>
              ) : (
                <select
                  className="copilot__model-select"
                  value={localModel}
                  onChange={(event) => setLocalModel(event.target.value)}
                >
                  {localModels.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              )}
            </div>
            <button
              className={`copilot__composer-send${draft.trim() && (mode === 'local' || falKey) ? ' copilot__composer-send--ready' : ''}`}
              onClick={() => void handleSend()}
              disabled={!draft.trim() || isSending || isEnhancingPrompt || (mode === 'cloud' && !falKey)}
              aria-label="Send message"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
            </button>
          </div>
        </div>
      </div>
      <div className="copilot__composer-shortcuts" aria-hidden>
        <span className="copilot__composer-shortcut">
          <kbd className="copilot__composer-kbd">@</kbd>
          <span>elements</span>
        </span>
        <span className="copilot__composer-shortcut-sep">•</span>
        <span className="copilot__composer-shortcut">
          <kbd className="copilot__composer-kbd">/</kbd>
          <span>media assets and timeline clips</span>
        </span>
      </div>
    </div>
  );

  return (
    <div className={`copilot${hasMessages ? ' copilot--active' : ''}`}>
      {/* ── Left Sidebar (chat history) ── */}
      <aside className={`copilot__sidebar${sidebarOpen ? '' : ' copilot__sidebar--closed'}`}>
        <div className="copilot__sidebar-head">
          <button className="copilot__sidebar-new" onClick={handleNewChat} title="New chat">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New chat
          </button>
          <button className="copilot__sidebar-collapse" onClick={() => setSidebarOpen(false)} title="Collapse sidebar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
          </button>
        </div>

        {chatHistory.sessions.length > 0 && (
          <div className="copilot__sidebar-section">
            <span className="copilot__sidebar-label">Recents</span>
          </div>
        )}

        <nav className="copilot__sidebar-list">
          {chatHistory.sessions.map((session) => (
            <div
              key={session.id}
              className={`copilot__sidebar-item${activeSessionId === session.id ? ' copilot__sidebar-item--active' : ''}`}
              onClick={() => handleLoadSession(session.id)}
              title={session.title}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') handleLoadSession(session.id); }}
            >
              <span className="copilot__sidebar-item-text">{session.title}</span>
              <button
                className="copilot__sidebar-item-delete"
                onClick={(e) => { e.stopPropagation(); handleDeleteSession(session.id); }}
                title="Delete chat"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          ))}
        </nav>

        <div className="copilot__sidebar-footer">
          <div className="copilot__sidebar-usage">
            <div className="copilot__sidebar-usage-row">
              <span>Spend</span>
              <span className="copilot__sidebar-usage-val copilot__sidebar-usage-val--accent">{formatCurrency(totalSessionUsage.cost)}</span>
            </div>
            <div className="copilot__sidebar-usage-row">
              <span>Tokens</span>
              <span className="copilot__sidebar-usage-val">{formatCount(totalSessionUsage.totalTokens)}</span>
            </div>
            <div className="copilot__sidebar-usage-row">
              <span>Requests</span>
              <span className="copilot__sidebar-usage-val">{formatCount(totalSessionUsage.requestCount)}</span>
            </div>
          </div>
          <button
            className="copilot__sidebar-settings-btn"
            onClick={() => setShowSettings(!showSettings)}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
            Settings
          </button>
        </div>
      </aside>

      {/* ── Main Area ── */}
      <div className="copilot__main">
        <div className="copilot__shell">
          {/* Sidebar toggle for landing state */}
          {!hasMessages && !sidebarOpen && (
            <button className="copilot__landing-sidebar-btn" onClick={() => setSidebarOpen(true)} title="Open sidebar">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
            </button>
          )}

          {/* ── Empty State (centered greeting) ── */}
          {!hasMessages && mode === 'cloud' && (
            <div className="copilot__landing">
              <div className="copilot__greeting">
                <span className="copilot__greeting-icon">&#x2726;</span>
                <h1 className="copilot__greeting-text">{getGreeting()}</h1>
              </div>

              {!falKey && (
                <div className="copilot__alert copilot__alert--warn">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                  Add your fal.ai API key in Settings to use Cloud chat.
                </div>
              )}

              {composerBar}

              <div className="copilot__suggestions">
                {modePromptExamples.map((example) => (
                  <button
                    key={example}
                    className="copilot__suggestion"
                    onClick={() => { setDraft(example); composerRef.current?.focus(); }}
                  >
                    {example}
                  </button>
                ))}
              </div>

              <div className="copilot__landing-index">
                <span>{assets.length} assets</span>
                <span className="copilot__landing-index-dot" />
                <span>{transcriptReadyCount} transcripts</span>
                <span className="copilot__landing-index-dot" />
                <span>{projectInsightIndex.stats.wordTimestampReadyCount} word-ready</span>
                <span className="copilot__landing-index-dot" />
                <span>{projectInsightIndex.stats.visualSummaryReadyCount} visual summaries</span>
                <span className="copilot__landing-index-dot" />
                <span>{totalClipCount} clips</span>
                <span className="copilot__landing-index-dot" />
                <span>{timelines.length} timelines</span>
              </div>
            </div>
          )}

          {/* ── Empty State (local mode) ── */}
          {!hasMessages && mode === 'local' && (
            <div className="copilot__landing">
              <div className="copilot__greeting">
                <h1 className="copilot__greeting-text">Local Runtime</h1>
              </div>
              <p className="copilot__landing-sub">
                Running <strong>{localModel}</strong> via Ollama. {localModels.length > 1 ? `${localModels.length} models available.` : ''} Chat is fully local — no API key needed.
              </p>
            </div>
          )}

          {/* ── Conversation State ── */}
          {hasMessages && (
            <>
              {/* Slim top bar */}
              <header className="copilot__topbar">
                <div className="copilot__topbar-left">
                  {!sidebarOpen && (
                    <button className="copilot__topbar-btn" onClick={() => setSidebarOpen(true)} title="Open sidebar">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
                    </button>
                  )}
                  <span className="copilot__topbar-label">Copilot</span>
                  <div className="copilot__topbar-mode-menu" ref={workModeMenuRef}>
                    <button
                      type="button"
                      className={`copilot__topbar-mode-badge copilot__topbar-mode-badge--button${workModeMenuOpen ? ' copilot__topbar-mode-badge--open' : ''}`}
                      title={workModeOverride === 'auto' ? 'Auto-routed workflow' : 'Manual workflow override'}
                      onClick={() => setWorkModeMenuOpen((current) => !current)}
                    >
                      {LLM_MODE_LABELS[displayedWorkMode]}
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                    {workModeMenuOpen && (
                      <div className="copilot__index-popover copilot__index-popover--mode">
                        <button
                          type="button"
                          className="copilot__index-popover-head copilot__index-popover-head--btn"
                          onClick={() => {
                            setWorkModeOverride('auto');
                            setWorkModeMenuOpen(false);
                          }}
                        >
                          <span className="copilot__index-popover-title">Auto</span>
                          <span className="copilot__index-popover-meta">{LLM_MODE_LABELS[displayedWorkMode]}</span>
                        </button>
                        <div className="copilot__index-popover-list">
                          {(['ask', 'search', 'cut', 'timeline'] as LLMWorkMode[]).map((option) => (
                            <button
                              key={option}
                              type="button"
                              className={`copilot__index-popover-item${workModeOverride === option ? ' copilot__index-popover-item--active' : ''}`}
                              onClick={() => {
                                setWorkModeOverride(option);
                                setWorkMode(option);
                                setWorkModeMenuOpen(false);
                              }}
                            >
                              <span className="copilot__index-popover-name">{LLM_MODE_LABELS[option]}</span>
                              <span className="copilot__index-popover-meta">Override</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="copilot__topbar-right">
                  {totalSessionUsage.requestCount > 0 && (
                    <span className="copilot__topbar-cost">{formatCurrency(totalSessionUsage.cost)}</span>
                  )}
                  <div className="copilot__topbar-index">
                    <button
                      className={`copilot__topbar-stat${indexPopover === 'assets' ? ' copilot__topbar-stat--active' : ''}`}
                      onClick={() => setIndexPopover(indexPopover === 'assets' ? null : 'assets')}
                    >{assets.length} assets</button>
                    <span className="copilot__topbar-dot" />
                    <button
                      className={`copilot__topbar-stat${indexPopover === 'transcripts' ? ' copilot__topbar-stat--active' : ''}`}
                      onClick={() => setIndexPopover(indexPopover === 'transcripts' ? null : 'transcripts')}
                    >{transcriptReadyCount} transcripts</button>
                    <span className="copilot__topbar-dot" />
                    <button
                      className={`copilot__topbar-stat${indexPopover === 'clips' ? ' copilot__topbar-stat--active' : ''}`}
                      onClick={() => setIndexPopover(indexPopover === 'clips' ? null : 'clips')}
                    >{totalClipCount} clips</button>
                    <span className="copilot__topbar-dot" />
                    <span className="copilot__topbar-stat">{projectInsightIndex.stats.visualSummaryReadyCount} visuals</span>
                  </div>

                  {/* Index popover */}
                  {indexPopover && (
                    <div className="copilot__index-popover">
                      <div className="copilot__index-popover-head">
                        <span className="copilot__index-popover-title">
                          {indexPopover === 'assets' && 'Assets'}
                          {indexPopover === 'transcripts' && 'Transcripts'}
                          {indexPopover === 'clips' && 'Clips'}
                        </span>
                        <button className="copilot__index-popover-close" onClick={() => setIndexPopover(null)}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                      </div>
                      <div className="copilot__index-popover-list">
                        {indexPopover === 'assets' && mediaPoolMentionAssets.map((asset) => (
                          <button
                            key={asset.id}
                            className="copilot__index-popover-item"
                            onClick={() => insertComposerToken('/', asset.name)}
                          >
                            <span className="copilot__index-popover-name">{asset.name}</span>
                            <span className="copilot__index-popover-meta">{asset.type}</span>
                          </button>
                        ))}
                        {indexPopover === 'transcripts' && transcriptAssets.map((asset) => (
                          <button
                            key={asset.id}
                            className="copilot__index-popover-item"
                            onClick={() => insertComposerToken('/', asset.name)}
                          >
                            <span className="copilot__index-popover-name">{asset.name}</span>
                            <span className="copilot__index-popover-meta">{asset.type}</span>
                          </button>
                        ))}
                        {indexPopover === 'clips' && clipsList.map((clip) => (
                          <button
                            key={clip.id}
                            className="copilot__index-popover-item"
                            onClick={() => insertComposerToken('/', clip.clipName)}
                          >
                            <span className="copilot__index-popover-name">{clip.clipName}</span>
                            <span className="copilot__index-popover-meta">{clip.assetName} &middot; {clip.timelineName}</span>
                          </button>
                        ))}
                        {((indexPopover === 'assets' && mediaPoolMentionAssets.length === 0) ||
                          (indexPopover === 'transcripts' && transcriptAssets.length === 0) ||
                          (indexPopover === 'clips' && clipsList.length === 0)) && (
                          <div className="copilot__index-popover-empty">None yet</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </header>

              {error && (
                <div className="copilot__alert copilot__alert--error copilot__alert--bar">{error}</div>
              )}

              {/* Thread */}
              <div className="copilot__thread" ref={threadRef}>
                <div className="copilot__thread-inner">
                  {renderedMessages}

                  {isSending && (mode === 'cloud' || !messages[messages.length - 1]?.content) && (
                    <article className="copilot__msg copilot__msg--assistant">
                      <div className="copilot__msg-open">
                        <div className="copilot__thinking">
                          <span className="copilot__thinking-dot" />
                          <span className="copilot__thinking-dot" />
                          <span className="copilot__thinking-dot" />
                        </div>
                      </div>
                    </article>
                  )}
                </div>
              </div>

              {composerBar}
            </>
          )}
        </div>

        {/* ── Settings Overlay ── */}
        {showSettings && (
          <div className="copilot__settings" onClick={(e) => { if (e.target === e.currentTarget) setShowSettings(false); }}>
            <div className="copilot__settings-panel">
              <div className="copilot__settings-header">
                <span className="copilot__settings-title">Settings</span>
                <button className="copilot__settings-close" onClick={() => setShowSettings(false)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              <div className="copilot__settings-grid">
                <div className="copilot__settings-cell">
                  <label className="copilot__settings-label">Backend</label>
                  <div className="copilot__backend-toggle" role="tablist">
                    <button className={`copilot__backend-btn${mode === 'cloud' ? ' copilot__backend-btn--active' : ''}`} onClick={() => setMode('cloud')} role="tab" aria-selected={mode === 'cloud'}>Cloud</button>
                    <button className={`copilot__backend-btn${mode === 'local' ? ' copilot__backend-btn--active' : ''}`} onClick={() => setMode('local')} role="tab" aria-selected={mode === 'local'}>Local</button>
                  </div>
                </div>
                <div className="copilot__settings-cell">
                  <label className="copilot__settings-label">Model</label>
                  {mode === 'cloud' ? (
                    <select className="copilot__settings-input" value={MODEL_SUGGESTIONS.includes(model) ? model : ''} onChange={(e) => setModel(e.target.value)}>
                      {MODEL_SUGGESTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                      {!MODEL_SUGGESTIONS.includes(model) && <option value={model}>{model}</option>}
                    </select>
                  ) : (
                    <select className="copilot__settings-input" value={localModel} onChange={(e) => setLocalModel(e.target.value)}>
                      {localModels.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  )}
                </div>
                <div className="copilot__settings-cell copilot__settings-cell--wide">
                  <label className="copilot__settings-label">System Prompt</label>
                  <textarea className="copilot__settings-textarea" value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={3} />
                </div>
                <div className="copilot__settings-cell">
                  <label className="copilot__settings-label">Max Tokens <span className="copilot__settings-val">{maxTokens}</span></label>
                  <input className="copilot__settings-range" type="range" min={64} max={8192} step={64} value={maxTokens} onChange={(e) => setMaxTokens(Math.max(64, Number(e.target.value) || 1200))} />
                </div>
                <div className="copilot__settings-cell">
                  <label className="copilot__settings-label">Temperature <span className="copilot__settings-val">{temperature.toFixed(1)}</span></label>
                  <input className="copilot__settings-range" type="range" min={0} max={2} step={0.1} value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} />
                </div>
              </div>
              {totalSessionUsage.requestCount > 0 && (
                <div className="copilot__settings-usage">
                  Session: {formatCurrency(totalSessionUsage.cost)} across {formatCount(totalSessionUsage.requestCount)} requests ({formatCount(totalSessionUsage.totalTokens)} tokens)
                </div>
              )}
            </div>
          </div>
        )}

        {/* Backend toggle (visible on landing) */}
        {!hasMessages && (
          <div className="copilot__landing-backend">
            <button className={`copilot__landing-toggle${mode === 'cloud' ? ' copilot__landing-toggle--active' : ''}`} onClick={() => setMode('cloud')}>Cloud</button>
            <button className={`copilot__landing-toggle${mode === 'local' ? ' copilot__landing-toggle--active' : ''}`} onClick={() => setMode('local')}>Local</button>
          </div>
        )}
      </div>
    </div>
  );
}
