import { ipcMain, BrowserWindow } from 'electron';
import { fal } from '@fal-ai/client';
import {
  type ClarifyingQuestion,
  type CutScorecard,
  type CutVariant,
  type CutWorkflowResult,
  type CutWorkflowUsage,
  type EditorialBrief,
  type EditorialPersona,
  type ProjectInsightIndex,
  retrieveRelevantMoments,
  type AssetVisualSummary,
  type RetrievedMoment,
  type RetrievalSummary,
} from '@/lib/llm/editorial-workflow';
import type { CutPlanSegment, CutProposal } from '@/lib/llm/cut-plan';
import { analyzeAssetVisualSummary } from './vision.js';

interface LLMChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface LLMChatParams {
  apiKey?: string;
  model?: string;
  systemPrompt?: string;
  messages?: LLMChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

interface LLMUsageSummary {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
}

interface CutWorkflowParams {
  apiKey?: string;
  model?: string;
  systemPrompt?: string;
  request: string;
  projectId: string;
  activeTimelineId: string;
  index: ProjectInsightIndex;
  confirmedBrief?: boolean;
  briefOverride?: Partial<EditorialBrief>;
  questionAnswers?: Record<string, string>;
  visionModel?: string;
}

const DEFAULT_TEXT_MODEL = 'anthropic/claude-sonnet-4.6';

function parseFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseUsage(value: unknown): LLMUsageSummary | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const usage = value as Record<string, unknown>;
  const promptTokens = parseFiniteNumber(usage.prompt_tokens) ?? 0;
  const completionTokens = parseFiniteNumber(usage.completion_tokens) ?? 0;
  const totalTokens = parseFiniteNumber(usage.total_tokens) ?? (promptTokens + completionTokens);
  const cost = parseFiniteNumber(usage.cost) ?? 0;
  if (promptTokens <= 0 && completionTokens <= 0 && totalTokens <= 0 && cost <= 0) return undefined;
  return { promptTokens, completionTokens, totalTokens, cost };
}

function mergeUsage(base: LLMUsageSummary | undefined, extra: LLMUsageSummary | undefined): LLMUsageSummary | undefined {
  if (!base) return extra;
  if (!extra) return base;
  return {
    promptTokens: base.promptTokens + extra.promptTokens,
    completionTokens: base.completionTokens + extra.completionTokens,
    totalTokens: base.totalTokens + extra.totalTokens,
    cost: base.cost + extra.cost,
  };
}

function buildConversationPrompt(messages: LLMChatMessage[]): string {
  return messages
    .filter((message) => message.role !== 'system' && message.content.trim())
    .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}:\n${message.content.trim()}`)
    .join('\n\n')
    .concat('\n\nAssistant:\n');
}

async function callTextLLM(params: {
  apiKey: string;
  model?: string;
  systemPrompt?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<{ message: string; usage?: LLMUsageSummary }> {
  fal.config({ credentials: params.apiKey });

  const input: Record<string, unknown> = {
    model: params.model?.trim() || DEFAULT_TEXT_MODEL,
    prompt: params.prompt,
    max_tokens: Number.isFinite(params.maxTokens) ? Math.max(1, Math.floor(params.maxTokens as number)) : 1600,
  };

  if (typeof params.systemPrompt === 'string' && params.systemPrompt.trim()) {
    input.system_prompt = params.systemPrompt.trim();
  }

  if (typeof params.temperature === 'number' && Number.isFinite(params.temperature)) {
    input.temperature = params.temperature;
  }

  const result = await fal.subscribe('openrouter/router', { input: input as any, logs: true });
  const data = result.data as Record<string, unknown>;
  const output = typeof data.output === 'string'
    ? data.output
    : typeof data.text === 'string'
      ? data.text
      : '';
  return {
    message: output.trim(),
    usage: parseUsage(data.usage),
  };
}

function extractJsonText(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // continue
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      return null;
    }
  }
  return null;
}

function sanitizeCutSummaryMessage(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  let cleaned = value.trim();
  if (!cleaned) return fallback;
  cleaned = cleaned.replace(/```(?:json)?/gi, '').trim();

  const embeddedJson = extractJsonText(cleaned);
  if (embeddedJson && embeddedJson.length < cleaned.length) {
    cleaned = cleaned.replace(embeddedJson, '').trim();
  }

  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
  return cleaned || fallback;
}

function normalizePersona(value: unknown): EditorialPersona {
  switch (value) {
    case 'documentary-editor':
    case 'promo-trailer-editor':
    case 'brand-storyteller':
    case 'social-shortform-editor':
    case 'interview-producer':
      return value;
    default:
      return 'documentary-editor';
  }
}

function normalizeVariantCount(value: unknown, fallback: 1 | 3 = 3): 1 | 3 {
  const parsed = parseFiniteNumber(value);
  if (parsed === null) return fallback;
  return parsed <= 1 ? 1 : 3;
}

function fallbackEditorialBrief(request: string, index: ProjectInsightIndex): EditorialBrief {
  const lower = request.toLowerCase();
  const isPromo = /promo|trailer|hype|teaser|sizzle|ad|commercial/.test(lower);
  const isSocial = /tiktok|reel|short|vertical|social/.test(lower);
  const pieceType = isPromo ? 'promo' : isSocial ? 'social short' : 'documentary interview';
  const persona = isPromo
    ? 'promo-trailer-editor'
    : isSocial
      ? 'social-shortform-editor'
      : 'documentary-editor';
  const activeReference = index.referenceTimelines.find((timeline) => timeline.timelineId === index.activeTimelineId);
  return {
    pieceType,
    deliverable: pieceType,
    audience: isPromo ? 'broad promotional audience' : 'documentary/story audience',
    tone: isPromo ? 'energetic and emotionally propulsive' : 'grounded, human, story-first',
    pacing: isPromo ? 'punchy' : 'measured',
    targetDurationSeconds: isSocial ? 30 : 180,
    variantCount: 3,
    persona,
    storyGoal: isPromo ? 'Hook quickly, escalate energy, and land a strong final beat.' : 'Find the emotional spine and shape it into a clear arc.',
    hook: isPromo ? 'Open with the strongest visual or emotional hook.' : 'Open on the most emotionally revealing line.',
    formatNotes: 'Use word-level timestamps when available and prefer complete thoughts.',
    qualityGoal: 'auto',
    referenceTimelineId: activeReference?.timelineId,
    referenceTimelineName: activeReference?.timelineName,
    useBrollPlaceholders: true,
    confidence: 0.55,
    rationale: 'Fallback brief inferred from request keywords and active project context.',
  };
}

function normalizeClarifyingQuestions(value: unknown): ClarifyingQuestion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const question = typeof record.question === 'string' ? record.question.trim() : '';
    if (!question) return [];
    const options = Array.isArray(record.options)
      ? record.options.flatMap((option, optionIndex) => {
          if (!option || typeof option !== 'object') return [];
          const optionRecord = option as Record<string, unknown>;
          const label = typeof optionRecord.label === 'string' ? optionRecord.label.trim() : '';
          if (!label) return [];
          return [{
            id: typeof optionRecord.id === 'string' && optionRecord.id.trim() ? optionRecord.id.trim() : `opt_${index + 1}_${optionIndex + 1}`,
            label,
            description: typeof optionRecord.description === 'string' ? optionRecord.description.trim() : undefined,
          }];
        })
      : [];
    return [{
      id: typeof record.id === 'string' && record.id.trim() ? record.id.trim() : `question_${index + 1}`,
      question,
      help: typeof record.help === 'string' ? record.help.trim() : undefined,
      allowCustom: record.allowCustom !== false,
      options,
    }];
  });
}

function normalizeEditorialBrief(value: unknown, fallback: EditorialBrief): { brief: EditorialBrief; clarifyingQuestions: ClarifyingQuestion[] } {
  if (!value || typeof value !== 'object') {
    return { brief: fallback, clarifyingQuestions: [] };
  }

  const record = value as Record<string, unknown>;
  const brief: EditorialBrief = {
    pieceType: typeof record.pieceType === 'string' && record.pieceType.trim() ? record.pieceType.trim() : fallback.pieceType,
    deliverable: typeof record.deliverable === 'string' && record.deliverable.trim() ? record.deliverable.trim() : fallback.deliverable,
    audience: typeof record.audience === 'string' && record.audience.trim() ? record.audience.trim() : fallback.audience,
    tone: typeof record.tone === 'string' && record.tone.trim() ? record.tone.trim() : fallback.tone,
    pacing: typeof record.pacing === 'string' && record.pacing.trim() ? record.pacing.trim() : fallback.pacing,
    targetDurationSeconds: Math.max(5, parseFiniteNumber(record.targetDurationSeconds) ?? fallback.targetDurationSeconds),
    variantCount: normalizeVariantCount(record.variantCount, fallback.variantCount),
    persona: normalizePersona(record.persona),
    storyGoal: typeof record.storyGoal === 'string' && record.storyGoal.trim() ? record.storyGoal.trim() : fallback.storyGoal,
    hook: typeof record.hook === 'string' && record.hook.trim() ? record.hook.trim() : fallback.hook,
    formatNotes: typeof record.formatNotes === 'string' && record.formatNotes.trim() ? record.formatNotes.trim() : fallback.formatNotes,
    qualityGoal: record.qualityGoal === 'story' || record.qualityGoal === 'retention' || record.qualityGoal === 'clarity' || record.qualityGoal === 'auto'
      ? record.qualityGoal
      : fallback.qualityGoal,
    referenceTimelineId: typeof record.referenceTimelineId === 'string' && record.referenceTimelineId.trim() ? record.referenceTimelineId.trim() : fallback.referenceTimelineId,
    referenceTimelineName: typeof record.referenceTimelineName === 'string' && record.referenceTimelineName.trim() ? record.referenceTimelineName.trim() : fallback.referenceTimelineName,
    useBrollPlaceholders: typeof record.useBrollPlaceholders === 'boolean' ? record.useBrollPlaceholders : fallback.useBrollPlaceholders,
    confidence: Math.min(1, Math.max(0, parseFiniteNumber(record.confidence) ?? fallback.confidence)),
    rationale: typeof record.rationale === 'string' && record.rationale.trim() ? record.rationale.trim() : fallback.rationale,
  };

  return {
    brief,
    clarifyingQuestions: normalizeClarifyingQuestions(record.clarifyingQuestions),
  };
}

function mergeEditorialBrief(base: EditorialBrief, override: Partial<EditorialBrief> | undefined, answers: Record<string, string> | undefined): EditorialBrief {
  const next = { ...base, ...(override ?? {}) };
  if (answers) {
    const answerLines = Object.entries(answers)
      .map(([key, value]) => `${key}: ${value}`)
      .filter((line) => !line.endsWith(': '));
    if (answerLines.length > 0) {
      next.formatNotes = `${next.formatNotes}\nClarifications:\n${answerLines.join('\n')}`.trim();
      next.rationale = `${next.rationale} Clarifications were provided by the user.`;
    }
  }
  return next;
}

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

function normalizeProposal(value: unknown, fallbackName: string): CutProposal | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const segments = Array.isArray(record.segments)
    ? record.segments.map(normalizeSegment).filter((segment): segment is CutPlanSegment => Boolean(segment))
    : [];
  if (segments.length === 0) return null;
  return {
    type: 'cut_proposal',
    summary: typeof record.summary === 'string' && record.summary.trim() ? record.summary.trim() : `Proposed ${segments.length} cut segments.`,
    timeline_name: typeof record.timeline_name === 'string' && record.timeline_name.trim() ? record.timeline_name.trim() : fallbackName,
    should_create_timeline: typeof record.should_create_timeline === 'boolean' ? record.should_create_timeline : false,
    segments,
  };
}

function normalizeCutVariants(value: unknown): CutVariant[] {
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.variants)) return [];
  return record.variants.flatMap((variant, variantIndex) => {
    if (!variant || typeof variant !== 'object') return [];
    const variantRecord = variant as Record<string, unknown>;
    const proposals = Array.isArray(variantRecord.proposals)
      ? variantRecord.proposals.map((proposal) => normalizeProposal(proposal, `AI Cut ${variantIndex + 1}`)).filter((proposal): proposal is CutProposal => Boolean(proposal))
      : [];
    if (proposals.length === 0) return [];
    return [{
      id: typeof variantRecord.id === 'string' && variantRecord.id.trim() ? variantRecord.id.trim() : `variant_${variantIndex + 1}`,
      title: typeof variantRecord.title === 'string' && variantRecord.title.trim() ? variantRecord.title.trim() : `Variant ${variantIndex + 1}`,
      strategy: typeof variantRecord.strategy === 'string' && variantRecord.strategy.trim() ? variantRecord.strategy.trim() : 'Balanced editorial approach',
      summary: typeof variantRecord.summary === 'string' && variantRecord.summary.trim() ? variantRecord.summary.trim() : proposals[0]?.summary ?? 'Proposed edit.',
      rationale: typeof variantRecord.rationale === 'string' && variantRecord.rationale.trim() ? variantRecord.rationale.trim() : 'Generated from editorial brief, retrieval hits, and project context.',
      proposals,
      scorecard: {
        overall: 0,
        storyArc: 0,
        pacing: 0,
        clarity: 0,
        visualFit: 0,
        completeness: 0,
        formatFit: 0,
        strengths: [],
        cautions: [],
        rationale: '',
      },
    }];
  });
}

function normalizeScorecards(value: unknown, variants: CutVariant[]): CutVariant[] {
  if (!value || typeof value !== 'object') return variants;
  const record = value as Record<string, unknown>;
  const scorecards = Array.isArray(record.scorecards) ? record.scorecards : [];
  const scorecardById = new Map<string, CutScorecard>();

  for (const scorecard of scorecards) {
    if (!scorecard || typeof scorecard !== 'object') continue;
    const item = scorecard as Record<string, unknown>;
    const variantId = typeof item.variant_id === 'string' ? item.variant_id.trim() : '';
    if (!variantId) continue;
    scorecardById.set(variantId, {
      overall: parseFiniteNumber(item.overall) ?? 78,
      storyArc: parseFiniteNumber(item.storyArc) ?? 78,
      pacing: parseFiniteNumber(item.pacing) ?? 78,
      clarity: parseFiniteNumber(item.clarity) ?? 78,
      visualFit: parseFiniteNumber(item.visualFit) ?? 78,
      completeness: parseFiniteNumber(item.completeness) ?? 78,
      formatFit: parseFiniteNumber(item.formatFit) ?? 78,
      strengths: Array.isArray(item.strengths) ? item.strengths.filter((entry): entry is string => typeof entry === 'string') : [],
      cautions: Array.isArray(item.cautions) ? item.cautions.filter((entry): entry is string => typeof entry === 'string') : [],
      rationale: typeof item.rationale === 'string' ? item.rationale.trim() : '',
    });
  }

  const rankedIds = Array.isArray(record.ranked_variant_ids)
    ? record.ranked_variant_ids.filter((entry): entry is string => typeof entry === 'string')
    : variants.map((variant) => variant.id);

  const ranked = [...variants].map((variant, index) => ({
    ...variant,
    scorecard: scorecardById.get(variant.id) ?? {
      overall: 78 - index,
      storyArc: 78 - index,
      pacing: 78 - index,
      clarity: 78 - index,
      visualFit: 78 - index,
      completeness: 78 - index,
      formatFit: 78 - index,
      strengths: ['No judge score available; kept generation order.'],
      cautions: [],
      rationale: 'Judge pass was unavailable, so the generation order was preserved.',
    },
  }));

  ranked.sort((a, b) => {
    const aRank = rankedIds.indexOf(a.id);
    const bRank = rankedIds.indexOf(b.id);
    if (aRank === -1 && bRank === -1) return b.scorecard.overall - a.scorecard.overall;
    if (aRank === -1) return 1;
    if (bRank === -1) return -1;
    return aRank - bRank;
  });

  return ranked;
}

function summarizeReferenceTimelines(index: ProjectInsightIndex): string {
  return index.referenceTimelines
    .slice(0, 5)
    .map((timeline) => `- ${timeline.timelineName}${timeline.isActive ? ' (active)' : ''}: ${timeline.structureSummary}; primary assets: ${timeline.primaryAssets.join(', ') || 'none'}`)
    .join('\n');
}

function summarizeRetrievedMoments(moments: RetrievedMoment[]): string {
  return moments
    .slice(0, 18)
    .map((moment, index) => {
      const placement = moment.timelinePlacements[0];
      const placementText = placement
        ? ` | timeline: ${placement.timelineName} @ ${placement.timelineTime.toFixed(1)}`
        : '';
      const wordTimingText = moment.words.length > 0
        ? `\n   Word timings: ${moment.words.slice(0, 18).map((word) => `${word.word}@${word.start.toFixed(1)}-${word.end.toFixed(1)}`).join(' ')}`
        : '';
      return `${index + 1}. ${moment.assetName} ${moment.sourceStart.toFixed(1)}-${moment.sourceEnd.toFixed(1)}${placementText}\n   ${moment.text}\n   Reason: ${moment.reason}${wordTimingText}`;
    })
    .join('\n');
}

function summarizeVisualFindings(findings: AssetVisualSummary[]): string {
  return findings
    .filter((finding) => finding.status === 'ready' && finding.summary)
    .slice(0, 6)
    .map((finding) => [
      `- Asset ${finding.assetId}: ${finding.summary}`,
      finding.tone && finding.tone.length > 0 ? `  Tone: ${finding.tone.join(', ')}` : '',
      finding.pacing ? `  Pacing: ${finding.pacing}` : '',
      finding.shotTypes && finding.shotTypes.length > 0 ? `  Shot types: ${finding.shotTypes.join(', ')}` : '',
      finding.brollIdeas && finding.brollIdeas.length > 0 ? `  B-roll ideas: ${finding.brollIdeas.join(', ')}` : '',
    ].filter(Boolean).join('\n'))
    .join('\n');
}

async function analyzeVisualContext(params: {
  apiKey: string;
  visualCandidates: ProjectInsightIndex['visualInputs'];
  retrievedMoments: RetrievedMoment[];
  model?: string;
}): Promise<AssetVisualSummary[]> {
  const assetIds = new Set(params.retrievedMoments.map((moment) => moment.assetId));
  const candidates = params.visualCandidates
    .filter((candidate) => assetIds.has(candidate.assetId))
    .slice(0, 4);

  const findings: AssetVisualSummary[] = [];
  for (const candidate of candidates) {
    if (candidate.storedSummary?.status === 'ready' && (!params.model || candidate.storedSummary.model === params.model)) {
      findings.push(candidate.storedSummary);
      continue;
    }
    findings.push(await analyzeAssetVisualSummary({
      apiKey: params.apiKey,
      assetId: candidate.assetId,
      assetName: candidate.assetName,
      framePaths: candidate.framePaths,
      model: params.model,
    }));
  }

  return findings;
}

async function inferEditorialBrief(params: {
  apiKey: string;
  model?: string;
  customSystemPrompt?: string;
  request: string;
  index: ProjectInsightIndex;
}): Promise<{ brief: EditorialBrief; clarifyingQuestions: ClarifyingQuestion[]; usage?: LLMUsageSummary }> {
  const fallback = fallbackEditorialBrief(params.request, params.index);
  const prompt = [
    'You are CineGen\'s senior editorial strategist.',
    'Infer the best editable cut brief for this request from the active project context.',
    'Return JSON only with this shape:',
    '{"pieceType":"...","deliverable":"...","audience":"...","tone":"...","pacing":"...","targetDurationSeconds":180,"variantCount":3,"persona":"documentary-editor","storyGoal":"...","hook":"...","formatNotes":"...","qualityGoal":"auto","referenceTimelineId":"optional","referenceTimelineName":"optional","useBrollPlaceholders":true,"confidence":0.84,"rationale":"...","clarifyingQuestions":[{"id":"...","question":"...","help":"...","allowCustom":true,"options":[{"id":"...","label":"...","description":"..."}]}]}',
    'Only include clarifying questions if the request is ambiguous or materially underspecified.',
    '',
    `User request: ${params.request}`,
    '',
    'Project context:',
    `- Assets: ${params.index.stats.assetCount}`,
    `- Transcript-ready assets: ${params.index.stats.transcriptReadyCount}`,
    `- Word-timestamp-ready assets: ${params.index.stats.wordTimestampReadyCount}`,
    `- Visual-summary-ready assets: ${params.index.stats.visualSummaryReadyCount}`,
    'Reference timelines:',
    summarizeReferenceTimelines(params.index),
  ].join('\n');

  const response = await callTextLLM({
    apiKey: params.apiKey,
    model: params.model,
    systemPrompt: [
      'You produce concise, grounded editorial briefs for film and promo editors.',
      params.customSystemPrompt?.trim() || '',
    ].filter(Boolean).join('\n\n'),
    prompt,
    maxTokens: 900,
    temperature: 0.35,
  });

  const jsonText = extractJsonText(response.message);
  if (!jsonText) {
    return { brief: fallback, clarifyingQuestions: [], usage: response.usage };
  }

  try {
    const parsed = JSON.parse(jsonText);
    const normalized = normalizeEditorialBrief(parsed, fallback);
    return { ...normalized, usage: response.usage };
  } catch {
    return { brief: fallback, clarifyingQuestions: [], usage: response.usage };
  }
}

function buildRetrievalSummary(index: ProjectInsightIndex, request: string, brief: EditorialBrief, visualFindings: AssetVisualSummary[]): RetrievalSummary {
  const retrievalQuery = [request, brief.storyGoal, brief.hook, brief.tone, brief.audience].join(' ');
  const topMoments = retrieveRelevantMoments(index, retrievalQuery, 20);
  const visualReadyCount = visualFindings.filter((finding) => finding.status === 'ready').length;
  return {
    topMoments,
    referenceTimelines: index.referenceTimelines.slice(0, 4),
    visualSummaryStatus: visualReadyCount <= 0 ? 'none' : visualReadyCount < Math.max(1, topMoments.length) ? 'partial' : 'ready',
    note: topMoments.length > 0
      ? `Retrieved ${topMoments.length} transcript-driven source moments${visualReadyCount > 0 ? ` and ${visualReadyCount} visual summaries` : ''}.`
      : 'No high-confidence transcript moments were retrieved; generation should stay conservative.',
  };
}

async function generateCutVariants(params: {
  apiKey: string;
  model?: string;
  customSystemPrompt?: string;
  request: string;
  brief: EditorialBrief;
  retrievalSummary: RetrievalSummary;
  visualFindings: AssetVisualSummary[];
}): Promise<{ variants: CutVariant[]; summaryMessage: string; usage?: LLMUsageSummary }> {
  const parseSingleVariantResponse = (rawMessage: string, usage?: LLMUsageSummary) => {
    const jsonText = extractJsonText(rawMessage);
    if (!jsonText) return null;

    try {
      const parsed = JSON.parse(jsonText) as Record<string, unknown>;
      const normalized = normalizeCutVariants({ variants: [parsed] });
      const variant = normalized[0];
      if (!variant) return null;
      return {
        variant,
        usage,
      };
    } catch {
      return null;
    }
  };

  const repairSingleVariant = async (rawMessage: string, variantIndex: number) => {
    const repairPrompt = [
      `Repair this malformed cut-variant response into valid JSON for variant ${variantIndex + 1}.`,
      'Return JSON only with this shape:',
      '{"id":"variant_1","title":"...","strategy":"...","summary":"...","rationale":"...","proposals":[{"type":"cut_proposal","summary":"...","timeline_name":"...","should_create_timeline":false,"segments":[{"asset_id":"...","asset_name":"...","source_start":12.3,"source_end":18.7,"note":"..."}]}]}',
      'Do not add commentary before or after the JSON.',
      'If part of the raw output was truncated, salvage one valid variant.',
      '',
      'Malformed response:',
      rawMessage,
    ].join('\n');

    const repairResponse = await callTextLLM({
      apiKey: params.apiKey,
      model: params.model,
      systemPrompt: 'You repair malformed structured editor outputs. Return strict JSON only.',
      prompt: repairPrompt,
      maxTokens: 4200,
      temperature: 0.1,
    });

    const repaired = parseSingleVariantResponse(repairResponse.message, repairResponse.usage);
    if (repaired) return repaired;

    return {
      variant: null,
      usage: repairResponse.usage,
    };
  };

  const variantCount = params.brief.variantCount;
  const lowerBrief = `${params.brief.pieceType} ${params.brief.deliverable} ${params.brief.tone}`.toLowerCase();
  const strategyTemplates = /promo|trailer|social|teaser|hype/.test(lowerBrief)
    ? [
        'Hook-first build: open with the strongest reveal, escalate momentum, and land a clean payoff.',
        'Character-first build: anchor emotionally first, then accelerate into the strongest theme beat.',
        'Payoff-first reverse build: tease the outcome early, then build toward why it matters.',
      ]
    : [
        'Chronological emotional arc: move from foundation into escalation and close on the strongest emotional beat.',
        'Theme-first structure: organize around the core idea instead of strict chronology, favoring emotional clarity.',
        'Cold-open documentary structure: open on the strongest line, then rewind and build a layered arc.',
      ];
  const chosenStrategies = strategyTemplates.slice(0, variantCount);

  let usage: LLMUsageSummary | undefined;
  const variants: CutVariant[] = [];

  for (let index = 0; index < chosenStrategies.length; index += 1) {
    const strategyPrompt = chosenStrategies[index];
    const prompt = [
      'You are CineGen\'s lead editor creating one high-quality cut proposal.',
      `Generate exactly one editorial variant using this strategy: ${strategyPrompt}`,
      'Use the retrieved moments and visual findings as evidence. Do not invent content outside them.',
      'Use word-level source timings when possible and cut tighter than sentence edges when the request calls for it.',
      'Do not include any prose before or after the JSON.',
      'Keep notes concise and practical.',
      'Return JSON only with this shape:',
      '{"id":"variant_1","title":"...","strategy":"...","summary":"...","rationale":"...","proposals":[{"type":"cut_proposal","summary":"...","timeline_name":"...","should_create_timeline":false,"segments":[{"asset_id":"...","asset_name":"...","source_start":12.3,"source_end":18.7,"note":"..."}]}]}',
      'If the user asked for multiple parts, the variant may include multiple proposals, one per part.',
      variants.length > 0 ? `Already generated variants (do something meaningfully different):\n${JSON.stringify(variants.map((variant) => ({ title: variant.title, strategy: variant.strategy, summary: variant.summary })), null, 2)}` : '',
      '',
      'Editorial brief:',
      JSON.stringify(params.brief, null, 2),
      '',
      'Retrieved moments:',
      summarizeRetrievedMoments(params.retrievalSummary.topMoments),
      '',
      'Reference timelines:',
      params.retrievalSummary.referenceTimelines.map((timeline) => `- ${timeline.timelineName}: ${timeline.structureSummary}`).join('\n') || '- none',
      '',
      'Visual findings:',
      summarizeVisualFindings(params.visualFindings) || '- none',
      '',
      `Original request: ${params.request}`,
    ].filter(Boolean).join('\n');

    const response = await callTextLLM({
      apiKey: params.apiKey,
      model: params.model,
      systemPrompt: [
        'You are a world-class editor. Make proposals that feel genuinely cuttable, not generic.',
        'When the brief reads documentary/interview, think like a documentary filmmaker shaping a story arc.',
        'When the brief reads promo/trailer/social, think like a promo editor optimizing hook, pacing, and payoff.',
        params.customSystemPrompt?.trim() || '',
      ].filter(Boolean).join('\n\n'),
      prompt,
      maxTokens: 2400,
      temperature: 0.45,
    });
    usage = mergeUsage(usage, response.usage);

    const parsed = parseSingleVariantResponse(response.message, response.usage);
    if (parsed?.variant) {
      variants.push({
        ...parsed.variant,
        id: `variant_${index + 1}`,
      });
      continue;
    }

    const repaired = await repairSingleVariant(response.message, index);
    usage = mergeUsage(usage, repaired.usage);
    if (repaired.variant) {
      variants.push({
        ...repaired.variant,
        id: `variant_${index + 1}`,
      });
    }
  }

  if (variants.length === 0) {
    return {
      variants: [],
      summaryMessage: 'I hit a formatting issue while packaging the cut variants. Review the brief and try again.',
      usage,
    };
  }

  return {
    variants,
    summaryMessage: variants.length === 1
      ? 'I generated one cut variant. Review it below.'
      : `I generated ${variants.length} cut variants. Review the options below.`,
    usage,
  };
}

async function judgeCutVariants(params: {
  apiKey: string;
  model?: string;
  customSystemPrompt?: string;
  brief: EditorialBrief;
  retrievalSummary: RetrievalSummary;
  variants: CutVariant[];
}): Promise<{ variants: CutVariant[]; usage?: LLMUsageSummary }> {
  if (params.variants.length === 0) return { variants: [] };

  const prompt = [
    'You are CineGen\'s finishing editor and quality judge.',
    'Score these variants against the brief. Prefer genuinely strong editorial structure over generic balance.',
    'Return JSON only with this shape:',
    '{"ranked_variant_ids":["variant_2","variant_1","variant_3"],"scorecards":[{"variant_id":"variant_2","overall":92,"storyArc":94,"pacing":90,"clarity":89,"visualFit":88,"completeness":91,"formatFit":93,"strengths":["..."],"cautions":["..."],"rationale":"..."}]}',
    '',
    'Editorial brief:',
    JSON.stringify(params.brief, null, 2),
    '',
    'Retrieved evidence summary:',
    summarizeRetrievedMoments(params.retrievalSummary.topMoments.slice(0, 10)),
    '',
    'Variants:',
    JSON.stringify(params.variants.map((variant) => ({
      id: variant.id,
      title: variant.title,
      strategy: variant.strategy,
      summary: variant.summary,
      rationale: variant.rationale,
      proposalSummaries: variant.proposals.map((proposal) => ({
        timeline_name: proposal.timeline_name,
        summary: proposal.summary,
        segmentCount: proposal.segments.length,
        firstSegments: proposal.segments.slice(0, 4),
      })),
    })), null, 2),
  ].join('\n');

  const response = await callTextLLM({
    apiKey: params.apiKey,
    model: params.model,
    systemPrompt: [
      'Be decisive. Prefer the best usable cut, not the safest explanation.',
      params.customSystemPrompt?.trim() || '',
    ].filter(Boolean).join('\n\n'),
    prompt,
    maxTokens: 1600,
    temperature: 0.2,
  });

  const jsonText = extractJsonText(response.message);
  if (!jsonText) return { variants: params.variants, usage: response.usage };

  try {
    const parsed = JSON.parse(jsonText);
    return {
      variants: normalizeScorecards(parsed, params.variants),
      usage: response.usage,
    };
  } catch {
    return { variants: params.variants, usage: response.usage };
  }
}

async function runCutWorkflow(params: CutWorkflowParams): Promise<CutWorkflowResult> {
  if (!params.apiKey) throw new Error('No fal.ai API key provided.');
  const index = params.index;
  const request = params.request.trim();
  if (!request) throw new Error('No cut request provided.');

  let usage: LLMUsageSummary | undefined;
  const briefInference = await inferEditorialBrief({
    apiKey: params.apiKey,
    model: params.model,
    customSystemPrompt: params.systemPrompt,
    request,
    index,
  });
  usage = mergeUsage(usage, briefInference.usage);

  const mergedBrief = mergeEditorialBrief(briefInference.brief, params.briefOverride, params.questionAnswers);
  const retrievalSummary = buildRetrievalSummary(index, request, mergedBrief, []);

  if (!params.confirmedBrief) {
    return {
      stage: 'brief',
      summaryMessage: briefInference.clarifyingQuestions.length > 0
        ? 'I drafted an editorial brief and I need a bit of guidance before generating the cut variants.'
        : 'I drafted the editorial brief. Review it, adjust anything you want, then generate the cut variants.',
      editorialBrief: mergedBrief,
      clarifyingQuestions: briefInference.clarifyingQuestions,
      retrievalSummary,
      visualFindings: [],
      variants: [],
      ...(usage ? { usage } : {}),
    };
  }

  const visualFindings = await analyzeVisualContext({
    apiKey: params.apiKey,
    visualCandidates: index.visualInputs,
    retrievedMoments: retrievalSummary.topMoments,
    model: params.visionModel,
  });
  const refreshedRetrievalSummary = buildRetrievalSummary(index, request, mergedBrief, visualFindings);

  const generation = await generateCutVariants({
    apiKey: params.apiKey,
    model: params.model,
    customSystemPrompt: params.systemPrompt,
    request,
    brief: mergedBrief,
    retrievalSummary: refreshedRetrievalSummary,
    visualFindings,
  });
  usage = mergeUsage(usage, generation.usage);

  if (generation.variants.length === 0) {
    return {
      stage: 'brief',
      summaryMessage: generation.summaryMessage,
      editorialBrief: mergedBrief,
      clarifyingQuestions: briefInference.clarifyingQuestions,
      retrievalSummary: refreshedRetrievalSummary,
      visualFindings,
      variants: [],
      ...(usage ? { usage } : {}),
    };
  }

  const judged = await judgeCutVariants({
    apiKey: params.apiKey,
    model: params.model,
    customSystemPrompt: params.systemPrompt,
    brief: mergedBrief,
    retrievalSummary: refreshedRetrievalSummary,
    variants: generation.variants,
  });
  usage = mergeUsage(usage, judged.usage);

  return {
    stage: 'variants',
    summaryMessage: generation.summaryMessage,
    editorialBrief: mergedBrief,
    clarifyingQuestions: briefInference.clarifyingQuestions,
    retrievalSummary: refreshedRetrievalSummary,
    visualFindings,
    variants: judged.variants,
    ...(usage ? { usage } : {}),
  };
}

/* ── Ollama local chat ── */

const OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

interface OllamaLocalChatParams {
  model?: string;
  systemPrompt?: string;
  messages?: LLMChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

function getMainWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
}

async function streamOllamaChat(
  requestId: string,
  params: OllamaLocalChatParams,
): Promise<{ message: string; usage?: LLMUsageSummary }> {
  const model = params.model?.trim() || 'qwen3.5:latest';
  const messages: Array<{ role: string; content: string }> = [];

  if (params.systemPrompt?.trim()) {
    messages.push({ role: 'system', content: params.systemPrompt.trim() });
  }

  for (const msg of params.messages ?? []) {
    if (msg.content.trim()) {
      messages.push({ role: msg.role, content: msg.content.trim() });
    }
  }

  if (messages.length === 0 || messages.every((m) => m.role === 'system')) {
    throw new Error('No chat messages provided.');
  }

  const body = {
    model,
    messages,
    stream: true,
    think: false,
    options: {
      ...(Number.isFinite(params.temperature) ? { temperature: params.temperature } : {}),
      ...(Number.isFinite(params.maxTokens) && (params.maxTokens as number) > 0
        ? { num_predict: Math.floor(params.maxTokens as number) }
        : {}),
    },
  };

  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Ollama request failed (${response.status}): ${text || response.statusText}`);
  }

  const win = getMainWindow();
  let fullContent = '';
  let promptTokens = 0;
  let completionTokens = 0;
  let insideThink = false;
  let thinkBuffer = '';

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Ollama streams newline-delimited JSON
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!line) continue;

      try {
        const chunk = JSON.parse(line) as Record<string, unknown>;
        const msgObj = chunk.message as Record<string, unknown> | undefined;
        const token = typeof msgObj?.content === 'string' ? msgObj.content : '';

        if (token) {
          // Filter out <think>...</think> blocks in real-time
          for (const char of token) {
            if (!insideThink) {
              thinkBuffer += char;
              if (thinkBuffer === '<think>') {
                insideThink = true;
                thinkBuffer = '';
              } else if (!'<think>'.startsWith(thinkBuffer)) {
                // Not a think tag — flush buffer as real content
                fullContent += thinkBuffer;
                win?.webContents.send('llm:local-stream', { requestId, token: thinkBuffer });
                thinkBuffer = '';
              }
            } else {
              // Inside think block — absorb until </think>
              thinkBuffer += char;
              if (thinkBuffer.endsWith('</think>')) {
                insideThink = false;
                thinkBuffer = '';
              }
            }
          }
        }

        if (chunk.done) {
          promptTokens = parseFiniteNumber(chunk.prompt_eval_count) ?? 0;
          completionTokens = parseFiniteNumber(chunk.eval_count) ?? 0;
        }
      } catch {
        // skip malformed lines
      }
    }
  }

  // Flush any remaining non-think buffer
  if (thinkBuffer && !insideThink) {
    fullContent += thinkBuffer;
    win?.webContents.send('llm:local-stream', { requestId, token: thinkBuffer });
  }

  // Send done signal
  win?.webContents.send('llm:local-stream', { requestId, done: true });

  return {
    message: fullContent.trim(),
    usage: promptTokens > 0 || completionTokens > 0
      ? { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, cost: 0 }
      : undefined,
  };
}

async function listOllamaModels(): Promise<string[]> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    if (!response.ok) return [];
    const data = (await response.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

export function registerLLMChatHandlers(): void {
  ipcMain.handle('llm:chat', async (_event: unknown, params: LLMChatParams) => {
    const key = params.apiKey;
    if (!key) throw new Error('No fal.ai API key provided.');

    const messages = Array.isArray(params.messages) ? params.messages : [];
    const prompt = buildConversationPrompt(messages);
    if (!prompt.trim()) throw new Error('No chat prompt provided.');

    const result = await callTextLLM({
      apiKey: key,
      model: params.model,
      systemPrompt: params.systemPrompt,
      prompt,
      maxTokens: params.maxTokens,
      temperature: params.temperature,
    });

    return {
      message: result.message,
      ...(result.usage ? { usage: result.usage } : {}),
    };
  });

  ipcMain.handle('llm:local-chat', async (_event: unknown, params: OllamaLocalChatParams & { requestId?: string }) => {
    const requestId = params.requestId || crypto.randomUUID();
    const result = await streamOllamaChat(requestId, params);
    return {
      message: result.message,
      ...(result.usage ? { usage: result.usage } : {}),
    };
  });

  ipcMain.handle('llm:local-models', async () => {
    return listOllamaModels();
  });

  ipcMain.handle('llm:run-cut-workflow', async (_event: unknown, params: CutWorkflowParams) => runCutWorkflow(params));
}
