import fsp from 'node:fs/promises';
import path from 'node:path';

import {
  ServiceError,
  createFalMediaStager,
  createFalSubscriber,
  isPlainRecord,
  requireRecord,
  requireSecret,
  requireString,
  validateModelId,
} from './_shared.mjs';

const DEFAULT_TEXT_MODEL = 'anthropic/claude-sonnet-4.6';
const DEFAULT_VISION_MODEL = 'google/gemini-2.5-flash';
const TEXT_ENDPOINT = 'openrouter/router';
const VISION_ENDPOINT = 'fal-ai/any-llm/vision';
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;
const PERSONAS = new Set([
  'documentary-editor',
  'promo-trailer-editor',
  'brand-storyteller',
  'social-shortform-editor',
  'interview-producer',
]);
const QUALITY_GOALS = new Set(['auto', 'story', 'retention', 'clarity']);
const VISUAL_STATUSES = new Set(['missing', 'queued', 'analyzing', 'ready', 'failed']);
const MAX_INDEX_MOMENTS = 10_000;
const MAX_INDEX_TEXT = 2_000_000;

export const cutWorkflowCapabilities = Object.freeze({
  briefInference: 'hosted',
  variantGeneration: 'hosted',
  variantJudging: 'hosted',
  visualAnalysis: 'hosted-frames',
  retrieval: 'deterministic-project-index',
  desktopStoryGraphReranking: false,
  arbitraryFilesystemMedia: false,
});

function cutError(message, code = 'INVALID_INPUT', statusCode = 400, cause) {
  return new ServiceError(message, { code, statusCode, cause });
}

function requireId(value, label) {
  return requireString(value, label, { maxLength: 256, pattern: ID_PATTERN });
}

function optionalText(value, label, maxLength = 16_000) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > maxLength) {
    throw cutError(`${label} must be text no longer than ${maxLength.toLocaleString()} characters.`);
  }
  return value.trim() || undefined;
}

function providerText(value, fallback = '', maxLength = 16_000) {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, maxLength)
    : fallback;
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundTime(value) {
  const parsed = finiteNumber(value);
  return parsed === null ? null : Math.round(Math.max(0, parsed) * 1_000) / 1_000;
}

function isPathInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function unwrapFalData(value) {
  return isPlainRecord(value) && isPlainRecord(value.data) ? value.data : value;
}

function extractProviderText(value, seen = new WeakSet(), depth = 0) {
  if (typeof value === 'string') return value.trim();
  if (value === null || typeof value !== 'object' || depth > 8 || seen.has(value)) return '';
  seen.add(value);
  if (isPlainRecord(value)) {
    for (const key of ['output', 'text', 'content', 'message', 'response', 'result']) {
      const candidate = extractProviderText(value[key], seen, depth + 1);
      if (candidate) return candidate;
    }
  }
  for (const candidateValue of Array.isArray(value) ? value : Object.values(value)) {
    const candidate = extractProviderText(candidateValue, seen, depth + 1);
    if (candidate) return candidate;
  }
  return '';
}

function extractJsonValue(rawValue) {
  const raw = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!raw || raw.length > 2_000_000) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // Continue through fenced and embedded JSON candidates.
  }
  for (const match of raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    try {
      return JSON.parse(match[1].trim());
    } catch {
      // Try another fenced block.
    }
  }
  const openers = new Map([['{', '}'], ['[', ']']]);
  for (let start = 0; start < raw.length; start += 1) {
    const closer = openers.get(raw[start]);
    if (!closer) continue;
    const stack = [closer];
    let escaped = false;
    let inString = false;
    for (let end = start + 1; end < raw.length; end += 1) {
      const character = raw[end];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (inString && character === '\\') {
        escaped = true;
        continue;
      }
      if (character === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (openers.has(character)) {
        stack.push(openers.get(character));
      } else if (character === stack[stack.length - 1]) {
        stack.pop();
        if (stack.length === 0) {
          try {
            return JSON.parse(raw.slice(start, end + 1));
          } catch {
            break;
          }
        }
      } else if (character === '}' || character === ']') {
        break;
      }
    }
  }
  return null;
}

function parseUsage(value) {
  if (!isPlainRecord(value)) return undefined;
  const promptTokens = finiteNumber(value.prompt_tokens ?? value.promptTokens) ?? 0;
  const completionTokens = finiteNumber(value.completion_tokens ?? value.completionTokens) ?? 0;
  const totalTokens = finiteNumber(value.total_tokens ?? value.totalTokens) ?? (promptTokens + completionTokens);
  const cost = finiteNumber(value.cost) ?? 0;
  if (promptTokens <= 0 && completionTokens <= 0 && totalTokens <= 0 && cost <= 0) return undefined;
  return {
    promptTokens: Math.max(0, promptTokens),
    completionTokens: Math.max(0, completionTokens),
    totalTokens: Math.max(0, totalTokens),
    cost: Math.max(0, cost),
  };
}

function mergeUsage(base, extra) {
  if (!base) return extra;
  if (!extra) return base;
  return {
    promptTokens: base.promptTokens + extra.promptTokens,
    completionTokens: base.completionTokens + extra.completionTokens,
    totalTokens: base.totalTokens + extra.totalTokens,
    cost: base.cost + extra.cost,
  };
}

function stringArray(value, maximum = 12, itemLength = 1_000) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => typeof entry === 'string' && entry.trim())
    .map((entry) => entry.trim().slice(0, itemLength))
    .slice(0, maximum);
}

function normalizePersona(value, fallback = 'documentary-editor') {
  return PERSONAS.has(value) ? value : fallback;
}

function normalizeVariantCount(value, fallback = 3) {
  const parsed = finiteNumber(value);
  if (parsed === null) return fallback;
  return parsed <= 1 ? 1 : 3;
}

function normalizeClarifyingQuestions(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).flatMap((entry, questionIndex) => {
    if (!isPlainRecord(entry)) return [];
    const question = providerText(entry.question, '', 2_000);
    if (!question) return [];
    const options = Array.isArray(entry.options)
      ? entry.options.slice(0, 10).flatMap((option, optionIndex) => {
        if (!isPlainRecord(option)) return [];
        const label = providerText(option.label, '', 500);
        if (!label) return [];
        return [{
          id: providerText(option.id, `opt_${questionIndex + 1}_${optionIndex + 1}`, 128),
          label,
          ...(providerText(option.description, '', 1_000) ? {
            description: providerText(option.description, '', 1_000),
          } : {}),
        }];
      })
      : [];
    return [{
      id: providerText(entry.id, `question_${questionIndex + 1}`, 128),
      question,
      ...(providerText(entry.help, '', 1_000) ? { help: providerText(entry.help, '', 1_000) } : {}),
      allowCustom: entry.allowCustom !== false,
      options,
    }];
  });
}

function fallbackEditorialBrief(request, index) {
  const lower = request.toLowerCase();
  const isPromo = /promo|trailer|hype|teaser|sizzle|\bad\b|commercial/.test(lower);
  const isSocial = /tiktok|reel|short|vertical|social/.test(lower);
  const pieceType = isPromo ? 'promo' : isSocial ? 'social short' : 'documentary interview';
  const activeReference = index.referenceTimelines.find((timeline) => timeline.timelineId === index.activeTimelineId);
  return {
    pieceType,
    deliverable: pieceType,
    audience: isPromo ? 'broad promotional audience' : 'documentary/story audience',
    tone: isPromo ? 'energetic and emotionally propulsive' : 'grounded, human, story-first',
    pacing: isPromo ? 'punchy' : 'measured',
    targetDurationSeconds: isSocial ? 30 : 180,
    variantCount: 3,
    persona: isPromo ? 'promo-trailer-editor' : isSocial ? 'social-shortform-editor' : 'documentary-editor',
    storyGoal: isPromo
      ? 'Hook quickly, escalate energy, and land a strong final beat.'
      : 'Find the emotional spine and shape it into a clear arc.',
    hook: isPromo ? 'Open with the strongest visual or emotional hook.' : 'Open on the most emotionally revealing line.',
    formatNotes: 'Use word-level timestamps when available and prefer complete thoughts.',
    qualityGoal: 'auto',
    ...(activeReference ? {
      referenceTimelineId: activeReference.timelineId,
      referenceTimelineName: activeReference.timelineName,
    } : {}),
    useBrollPlaceholders: true,
    confidence: 0.55,
    rationale: 'Fallback brief inferred from request keywords and project-owned context.',
  };
}

function normalizeEditorialBrief(value, fallback, timelineById) {
  const record = isPlainRecord(value) ? value : {};
  const requestedTimelineId = providerText(record.referenceTimelineId, '', 256);
  const knownTimeline = requestedTimelineId ? timelineById.get(requestedTimelineId) : undefined;
  const targetDuration = finiteNumber(record.targetDurationSeconds);
  const confidence = finiteNumber(record.confidence);
  return {
    brief: {
      pieceType: providerText(record.pieceType, fallback.pieceType, 500),
      deliverable: providerText(record.deliverable, fallback.deliverable, 500),
      audience: providerText(record.audience, fallback.audience, 1_000),
      tone: providerText(record.tone, fallback.tone, 1_000),
      pacing: providerText(record.pacing, fallback.pacing, 1_000),
      targetDurationSeconds: clamp(targetDuration ?? fallback.targetDurationSeconds, 5, 86_400),
      variantCount: normalizeVariantCount(record.variantCount, fallback.variantCount),
      persona: normalizePersona(record.persona, fallback.persona),
      storyGoal: providerText(record.storyGoal, fallback.storyGoal, 4_000),
      hook: providerText(record.hook, fallback.hook, 4_000),
      formatNotes: providerText(record.formatNotes, fallback.formatNotes, 8_000),
      qualityGoal: QUALITY_GOALS.has(record.qualityGoal) ? record.qualityGoal : fallback.qualityGoal,
      ...(knownTimeline ? {
        referenceTimelineId: knownTimeline.timelineId,
        referenceTimelineName: knownTimeline.timelineName,
      } : fallback.referenceTimelineId ? {
        referenceTimelineId: fallback.referenceTimelineId,
        referenceTimelineName: fallback.referenceTimelineName,
      } : {}),
      useBrollPlaceholders: typeof record.useBrollPlaceholders === 'boolean'
        ? record.useBrollPlaceholders
        : fallback.useBrollPlaceholders,
      confidence: clamp(confidence ?? fallback.confidence, 0, 1),
      rationale: providerText(record.rationale, fallback.rationale, 4_000),
    },
    clarifyingQuestions: normalizeClarifyingQuestions(record.clarifyingQuestions),
  };
}

function validateBriefOverride(value, base, timelineById) {
  if (value === undefined || value === null) return base;
  const override = requireRecord(value, 'Editorial brief override');
  if (override.variantCount !== undefined && override.variantCount !== 1 && override.variantCount !== 3) {
    throw cutError('Editorial brief variantCount must be 1 or 3.');
  }
  if (override.persona !== undefined && !PERSONAS.has(override.persona)) {
    throw cutError('Editorial brief persona is invalid.');
  }
  if (override.qualityGoal !== undefined && !QUALITY_GOALS.has(override.qualityGoal)) {
    throw cutError('Editorial brief qualityGoal is invalid.');
  }
  if (override.referenceTimelineId !== undefined && override.referenceTimelineId !== null && override.referenceTimelineId !== '') {
    const timelineId = requireId(override.referenceTimelineId, 'Editorial brief reference timeline id');
    if (!timelineById.has(timelineId)) {
      throw cutError('Editorial brief reference timeline is not owned by this project.', 'PROJECT_MISMATCH', 403);
    }
  }
  return normalizeEditorialBrief({ ...base, ...override }, base, timelineById).brief;
}

function mergeQuestionAnswers(brief, value) {
  if (value === undefined || value === null) return brief;
  const answers = requireRecord(value, 'Clarifying question answers');
  const entries = Object.entries(answers);
  if (entries.length > 20) throw cutError('Too many clarifying question answers were provided.');
  const lines = entries.flatMap(([key, answer]) => {
    if (!ID_PATTERN.test(key) || typeof answer !== 'string' || answer.length > 4_000) {
      throw cutError('Clarifying question answers contain an invalid entry.');
    }
    return answer.trim() ? [`${key}: ${answer.trim()}`] : [];
  });
  if (lines.length === 0) return brief;
  return {
    ...brief,
    formatNotes: `${brief.formatNotes}\nClarifications:\n${lines.join('\n')}`.slice(0, 12_000),
    rationale: `${brief.rationale} Clarifications were provided by the user.`.slice(0, 5_000),
  };
}

function normalizeVisualSummary(value, assetId) {
  if (!isPlainRecord(value)) return undefined;
  const status = VISUAL_STATUSES.has(value.status) ? value.status : 'missing';
  const confidence = finiteNumber(value.confidence);
  const sourceFrameCount = finiteNumber(value.sourceFrameCount);
  return {
    assetId,
    status,
    ...(providerText(value.summary, '', 20_000) ? { summary: providerText(value.summary, '', 20_000) } : {}),
    ...(stringArray(value.tone).length ? { tone: stringArray(value.tone) } : {}),
    ...(providerText(value.pacing, '', 2_000) ? { pacing: providerText(value.pacing, '', 2_000) } : {}),
    ...(stringArray(value.shotTypes).length ? { shotTypes: stringArray(value.shotTypes) } : {}),
    ...(stringArray(value.subjects).length ? { subjects: stringArray(value.subjects) } : {}),
    ...(stringArray(value.brollIdeas).length ? { brollIdeas: stringArray(value.brollIdeas) } : {}),
    ...(providerText(value.updatedAt, '', 128) ? { updatedAt: providerText(value.updatedAt, '', 128) } : {}),
    ...(providerText(value.model, '', 512) ? { model: providerText(value.model, '', 512) } : {}),
    ...(confidence !== null ? { confidence: clamp(confidence, 0, 1) } : {}),
    ...(sourceFrameCount !== null ? { sourceFrameCount: Math.max(0, Math.floor(sourceFrameCount)) } : {}),
    ...(providerText(value.error, '', 2_000) ? { error: providerText(value.error, '', 2_000) } : {}),
  };
}

function normalizeProjectState(stateValue, projectId) {
  const state = requireRecord(stateValue, 'Project state');
  if (isPlainRecord(state.project) && state.project.id && state.project.id !== projectId) {
    throw cutError('Project ownership check failed.', 'PROJECT_MISMATCH', 403);
  }
  if (!Array.isArray(state.assets)) {
    throw cutError('Project assets are unavailable for the cut workflow.', 'SERVER_MISCONFIGURED', 500);
  }
  const assetsById = new Map();
  const assetsByName = new Map();
  for (const value of state.assets) {
    if (!isPlainRecord(value) || typeof value.id !== 'string' || !ID_PATTERN.test(value.id)) continue;
    if (value.project_id && value.project_id !== projectId) {
      throw cutError('A project asset failed its ownership check.', 'PROJECT_MISMATCH', 403);
    }
    const name = providerText(value.name ?? value.file_name, value.id, 1_024);
    const durationValue = finiteNumber(value.duration ?? value.duration_seconds);
    const asset = {
      id: value.id,
      name,
      type: ['image', 'video', 'audio'].includes(value.type) ? value.type : 'video',
      ...(durationValue !== null && durationValue > 0 ? { duration: durationValue } : {}),
    };
    assetsById.set(asset.id, asset);
    if (!assetsByName.has(name.toLowerCase())) assetsByName.set(name.toLowerCase(), asset);
  }

  const timelinesById = new Map();
  for (const value of Array.isArray(state.timelines) ? state.timelines : []) {
    if (!isPlainRecord(value) || typeof value.id !== 'string' || !ID_PATTERN.test(value.id)) continue;
    timelinesById.set(value.id, {
      timelineId: value.id,
      timelineName: providerText(value.name, value.id, 1_024),
    });
  }
  return { state, assetsById, assetsByName, timelinesById };
}

function normalizeReferenceTimeline(value, timelinesById, assetsByName) {
  const record = requireRecord(value, 'Reference timeline');
  const timelineId = requireId(record.timelineId, 'Reference timeline id');
  const owned = timelinesById.get(timelineId);
  if (timelinesById.size > 0 && !owned) {
    throw cutError('The insight index references a timeline outside this project.', 'PROJECT_MISMATCH', 403);
  }
  const duration = finiteNumber(record.duration);
  const clipCount = finiteNumber(record.clipCount);
  return {
    timelineId,
    timelineName: owned?.timelineName ?? providerText(record.timelineName, timelineId, 1_024),
    duration: Math.max(0, duration ?? 0),
    clipCount: Math.max(0, Math.floor(clipCount ?? 0)),
    primaryAssets: stringArray(record.primaryAssets, 100, 1_024)
      .filter((name) => assetsByName.has(name.toLowerCase())),
    structureSummary: providerText(record.structureSummary, 'No structure summary available.', 10_000),
    isActive: record.isActive === true,
  };
}

function normalizeWord(value, sourceStart, sourceEnd) {
  if (!isPlainRecord(value)) return null;
  const word = providerText(value.word, '', 200);
  const start = roundTime(value.start);
  const end = roundTime(value.end);
  if (!word || start === null || end === null || end < start || end < sourceStart || start > sourceEnd) return null;
  return { word, start: clamp(start, sourceStart, sourceEnd), end: clamp(end, sourceStart, sourceEnd) };
}

function normalizeMoment(value, index, assetsById, timelinesById) {
  const record = requireRecord(value, `Insight moment ${index + 1}`);
  const assetId = requireId(record.assetId, `Insight moment ${index + 1} asset id`);
  const asset = assetsById.get(assetId);
  if (!asset) {
    throw cutError(`Insight moment ${index + 1} references an asset outside this project.`, 'PROJECT_MISMATCH', 403);
  }
  const text = requireString(record.text, `Insight moment ${index + 1} text`, { maxLength: 25_000 });
  let sourceStart = roundTime(record.sourceStart);
  let sourceEnd = roundTime(record.sourceEnd);
  if (sourceStart === null || sourceEnd === null || sourceEnd <= sourceStart) {
    throw cutError(`Insight moment ${index + 1} has invalid source timing.`);
  }
  if (asset.duration !== undefined) {
    sourceStart = clamp(sourceStart, 0, asset.duration);
    sourceEnd = clamp(sourceEnd, 0, asset.duration);
    if (sourceEnd <= sourceStart) {
      throw cutError(`Insight moment ${index + 1} is outside its asset duration.`);
    }
  }
  const words = Array.isArray(record.words)
    ? record.words.slice(0, 500).map((word) => normalizeWord(word, sourceStart, sourceEnd)).filter(Boolean)
    : [];
  const timelinePlacements = Array.isArray(record.timelinePlacements)
    ? record.timelinePlacements.slice(0, 20).flatMap((placement) => {
      if (!isPlainRecord(placement) || typeof placement.timelineId !== 'string') return [];
      const owned = timelinesById.get(placement.timelineId);
      if (!owned) return [];
      const timelineTime = roundTime(placement.timelineTime);
      const clipStartTime = roundTime(placement.clipStartTime);
      if (timelineTime === null || clipStartTime === null) return [];
      return [{
        timelineId: owned.timelineId,
        timelineName: owned.timelineName,
        clipId: providerText(placement.clipId, `clip-${index + 1}`, 256),
        clipName: providerText(placement.clipName, asset.name, 1_024),
        timelineTime,
        clipStartTime,
      }];
    })
    : [];
  return {
    id: providerText(record.id, `${assetId}:moment-${index + 1}`, 256),
    assetId,
    assetName: asset.name,
    text,
    sourceStart,
    sourceEnd,
    words,
    timelinePlacements,
    ...(['delivery', 'emotion', 'energy', 'pace'].reduce((fields, key) => {
      const textValue = providerText(record[key], '', 1_000);
      if (textValue) fields[key] = textValue;
      return fields;
    }, {})),
    ...(stringArray(record.notable, 20, 1_000).length ? { notable: stringArray(record.notable, 20, 1_000) } : {}),
  };
}

function normalizeVisualInput(value, index, assetsById) {
  const record = requireRecord(value, `Visual input ${index + 1}`);
  const assetId = requireId(record.assetId, `Visual input ${index + 1} asset id`);
  const asset = assetsById.get(assetId);
  if (!asset) {
    throw cutError(`Visual input ${index + 1} references an asset outside this project.`, 'PROJECT_MISMATCH', 403);
  }
  if (record.framePaths !== undefined && !Array.isArray(record.framePaths)) {
    throw cutError(`Visual input ${index + 1} framePaths must be an array.`);
  }
  if (Array.isArray(record.framePaths) && record.framePaths.length > 24) {
    throw cutError(`Visual input ${index + 1} may contain at most 24 frame paths.`);
  }
  const framePaths = (record.framePaths ?? []).slice(0, 24).map((entry, frameIndex) => (
    requireString(entry, `Visual input ${index + 1} frame ${frameIndex + 1}`, { maxLength: 16_384 })
  ));
  return {
    assetId,
    assetName: asset.name,
    assetType: asset.type,
    ...(record.thumbnailPath ? {
      thumbnailPath: requireString(record.thumbnailPath, `Visual input ${index + 1} thumbnail`, { maxLength: 16_384 }),
    } : {}),
    framePaths,
    ...(record.storedSummary ? { storedSummary: normalizeVisualSummary(record.storedSummary, assetId) } : {}),
  };
}

function normalizeIndex(value, projectId, activeTimelineId, project) {
  const index = requireRecord(value, 'Project insight index');
  if (requireId(index.projectId, 'Insight index project id') !== projectId) {
    throw cutError('The insight index belongs to a different project.', 'PROJECT_MISMATCH', 403);
  }
  if (requireId(index.activeTimelineId, 'Insight index active timeline id') !== activeTimelineId) {
    throw cutError('The insight index active timeline does not match the request.', 'PROJECT_MISMATCH', 409);
  }
  if (project.timelinesById.size > 0 && !project.timelinesById.has(activeTimelineId)) {
    throw cutError('The active timeline is not owned by this project.', 'PROJECT_MISMATCH', 403);
  }
  if (!Array.isArray(index.moments) || index.moments.length > MAX_INDEX_MOMENTS) {
    throw cutError(`Insight index moments must be an array with at most ${MAX_INDEX_MOMENTS.toLocaleString()} entries.`);
  }
  if (!Array.isArray(index.referenceTimelines) || index.referenceTimelines.length > 500) {
    throw cutError('Insight index reference timelines must be an array with at most 500 entries.');
  }
  if (!Array.isArray(index.visualInputs) || index.visualInputs.length > 500) {
    throw cutError('Insight index visual inputs must be an array with at most 500 entries.');
  }
  const referenceTimelines = index.referenceTimelines.map((entry) => (
    normalizeReferenceTimeline(entry, project.timelinesById, project.assetsByName)
  ));
  const timelineById = new Map(referenceTimelines.map((timeline) => [timeline.timelineId, timeline]));
  for (const [timelineId, timeline] of project.timelinesById) {
    if (!timelineById.has(timelineId)) timelineById.set(timelineId, timeline);
  }
  const moments = index.moments.map((entry, momentIndex) => (
    normalizeMoment(entry, momentIndex, project.assetsById, project.timelinesById)
  ));
  const totalText = moments.reduce((sum, moment) => sum + moment.text.length, 0);
  if (totalText > MAX_INDEX_TEXT) {
    throw cutError('Insight index transcript text is too large.', 'INVALID_INPUT', 413);
  }
  const visualInputs = index.visualInputs.map((entry, visualIndex) => (
    normalizeVisualInput(entry, visualIndex, project.assetsById)
  ));
  const transcriptAssets = new Set(moments.map((moment) => moment.assetId));
  const wordAssets = new Set(moments.filter((moment) => moment.words.length > 0).map((moment) => moment.assetId));
  const visualReady = new Set(visualInputs
    .filter((input) => input.storedSummary?.status === 'ready')
    .map((input) => input.assetId));
  const assets = [...project.assetsById.values()];
  return {
    projectId,
    activeTimelineId,
    stats: {
      assetCount: assets.length,
      transcriptReadyCount: transcriptAssets.size,
      wordTimestampReadyCount: wordAssets.size,
      videoCount: assets.filter((asset) => asset.type === 'video').length,
      audioCount: assets.filter((asset) => asset.type === 'audio').length,
      visualSummaryReadyCount: visualReady.size,
    },
    moments,
    referenceTimelines,
    visualInputs,
    timelineById,
  };
}

function queryTerms(value) {
  const stop = new Set(['about', 'after', 'again', 'also', 'from', 'have', 'into', 'just', 'make', 'that', 'their', 'then', 'there', 'these', 'they', 'this', 'with', 'would']);
  return [...new Set(value.toLowerCase().split(/[^a-z0-9']+/).filter((term) => term.length >= 3 && !stop.has(term)))];
}

function retrieveMoments(index, request, brief, limit = 20) {
  const terms = queryTerms([request, brief.storyGoal, brief.hook, brief.tone, brief.audience].join(' '));
  return index.moments
    .map((moment, inputOrder) => {
      const haystack = [moment.text, moment.assetName, moment.delivery, moment.emotion, moment.energy, moment.pace, ...(moment.notable ?? [])]
        .filter(Boolean).join(' ').toLowerCase();
      const matches = terms.filter((term) => haystack.includes(term));
      const exactRequest = request.length >= 12 && haystack.includes(request.toLowerCase()) ? 8 : 0;
      const score = matches.length * 3 + exactRequest + (moment.timelinePlacements.length > 0 ? 0.8 : 0) + (moment.words.length > 0 ? 0.4 : 0) + 1 / (inputOrder + 2);
      return {
        ...moment,
        score: Math.round(score * 1_000) / 1_000,
        reason: matches.length > 0
          ? `Matched editorial terms: ${matches.slice(0, 6).join(', ')}`
          : 'Project transcript candidate selected by deterministic web retrieval.',
        inputOrder,
      };
    })
    .sort((a, b) => b.score - a.score || a.inputOrder - b.inputOrder)
    .slice(0, limit)
    .map(({ inputOrder: _inputOrder, ...moment }) => moment);
}

function buildRetrievalSummary(index, request, brief, visualFindings = []) {
  const topMoments = retrieveMoments(index, request, brief);
  const readyAssets = new Set(visualFindings
    .filter((finding) => finding.status === 'ready' && finding.summary)
    .map((finding) => finding.assetId));
  const retrievedAssets = new Set(topMoments.map((moment) => moment.assetId));
  const readyCount = [...retrievedAssets].filter((assetId) => readyAssets.has(assetId)).length;
  const visualSummaryStatus = readyCount === 0 ? 'none' : readyCount < retrievedAssets.size ? 'partial' : 'ready';
  return {
    topMoments,
    referenceTimelines: index.referenceTimelines.slice(0, 4),
    visualSummaryStatus,
    note: topMoments.length > 0
      ? `Retrieved ${topMoments.length} project-owned transcript moments using deterministic web index ranking${readyCount ? ` and ${readyCount} hosted visual summaries` : ''}. Desktop story-graph and local reranking modules are not run by the web server.`
      : 'No project-owned transcript moments were available. The web server does not run the desktop story-graph or local retrieval modules.',
  };
}

function summarizeReferenceTimelines(index) {
  return index.referenceTimelines.slice(0, 5).map((timeline) => (
    `- ${timeline.timelineName}${timeline.timelineId === index.activeTimelineId ? ' (active)' : ''}: ${timeline.structureSummary}; primary assets: ${timeline.primaryAssets.join(', ') || 'none'}`
  )).join('\n');
}

function summarizeRetrievedMoments(moments) {
  return moments.slice(0, 18).map((moment, index) => {
    const placement = moment.timelinePlacements[0];
    const placementText = placement ? ` | timeline: ${placement.timelineName} @ ${placement.timelineTime.toFixed(1)}` : '';
    const words = moment.words.length > 0
      ? `\n   Word timings: ${moment.words.slice(0, 18).map((word) => `${word.word}@${word.start.toFixed(1)}-${word.end.toFixed(1)}`).join(' ')}`
      : '';
    return `${index + 1}. [asset:${moment.assetName} @ ${moment.sourceStart.toFixed(1)}] ${moment.sourceStart.toFixed(1)}-${moment.sourceEnd.toFixed(1)}${placementText}\n   ${moment.text}\n   Reason: ${moment.reason}${words}`;
  }).join('\n');
}

function summarizeVisualFindings(findings) {
  return findings.filter((finding) => finding.status === 'ready' && finding.summary).slice(0, 6).map((finding) => [
    `- Asset ${finding.assetId}: ${finding.summary}`,
    finding.tone?.length ? `  Tone: ${finding.tone.join(', ')}` : '',
    finding.pacing ? `  Pacing: ${finding.pacing}` : '',
    finding.shotTypes?.length ? `  Shot types: ${finding.shotTypes.join(', ')}` : '',
    finding.brollIdeas?.length ? `  B-roll ideas: ${finding.brollIdeas.join(', ')}` : '',
  ].filter(Boolean).join('\n')).join('\n');
}

function formatTimestamp(seconds) {
  const total = Math.max(0, finiteNumber(seconds) ?? 0);
  const minutes = Math.floor(total / 60);
  const remainder = (total - minutes * 60).toFixed(1).padStart(4, '0');
  return `${String(minutes).padStart(2, '0')}:${remainder}`;
}

function defaultScorecard(index = 0) {
  const score = Math.max(0, 78 - index);
  return {
    overall: score,
    storyArc: score,
    pacing: score,
    clarity: score,
    visualFit: score,
    completeness: score,
    formatFit: score,
    strengths: ['Generation order preserved; no valid hosted judge score was returned.'],
    cautions: [],
    rationale: 'The hosted judge did not return a usable scorecard.',
  };
}

/**
 * Creates renderer-compatible `llm.runCutWorkflow` handling for the web app.
 *
 * Required context: `{ dataRoot, store.load(projectId), pathForMediaReference }`.
 * Optional/injectable hosted hooks: `falSubscribe(endpoint, input, apiKey)` and
 * `stageMedia(source, apiKey, label)`. API keys are taken only from each RPC
 * request and are never read from process-wide configuration or persisted.
 */
export function createCutWorkflowHandlers(context) {
  const options = requireRecord(context, 'Cut workflow service context');
  const dataRoot = path.resolve(requireString(options.dataRoot, 'Cut workflow data root', { maxLength: 16_384 }));
  const mediaRoot = path.join(dataRoot, 'media');
  const projectsMediaRoot = path.join(mediaRoot, 'projects');
  const store = options.store;
  const falSubscribe = options.falSubscribe ?? createFalSubscriber(options);
  const stageMedia = options.stageMedia ?? createFalMediaStager(options);

  const callTextLLM = async ({ apiKey, model, systemPrompt, prompt, maxTokens, temperature }) => {
    const result = await falSubscribe(TEXT_ENDPOINT, {
      model,
      prompt,
      max_tokens: maxTokens,
      ...(systemPrompt ? { system_prompt: systemPrompt } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
    }, apiKey);
    const data = unwrapFalData(result);
    if (!isPlainRecord(data)) {
      throw cutError('The hosted LLM returned an invalid response.', 'PROVIDER_BAD_RESPONSE', 502);
    }
    return {
      message: extractProviderText(data),
      usage: parseUsage(data.usage),
    };
  };

  const resolveOwnedMedia = async (referenceValue, projectId, label) => {
    const raw = requireString(referenceValue, label, { maxLength: 16_384 });
    if (typeof options.pathForMediaReference !== 'function') {
      throw cutError('Web media path resolution is unavailable.', 'SERVER_MISCONFIGURED', 500);
    }
    const reference = raw.startsWith('local-media://file') ? raw.slice('local-media://file'.length) : raw;
    let resolved;
    try {
      resolved = await options.pathForMediaReference(reference);
    } catch (cause) {
      if (cause instanceof ServiceError) throw cause;
      throw cutError(`${label} is not a valid web media reference.`, 'INVALID_MEDIA_PATH', 400, cause);
    }
    if (typeof resolved !== 'string') {
      throw cutError(`${label} did not resolve to web media.`, 'INVALID_MEDIA_PATH', 400);
    }
    const filePath = path.resolve(resolved);
    const projectRoot = path.join(projectsMediaRoot, projectId);
    if (!isPathInside(projectRoot, filePath)) {
      throw cutError(`${label} belongs to a different project.`, 'PROJECT_MISMATCH', 403);
    }
    let realProjectRoot;
    let realFile;
    let stats;
    try {
      [realProjectRoot, realFile, stats] = await Promise.all([
        fsp.realpath(projectRoot),
        fsp.realpath(filePath),
        fsp.stat(filePath),
      ]);
    } catch (cause) {
      if (cause?.code === 'ENOENT') throw cutError(`${label} was not found.`, 'MEDIA_NOT_FOUND', 404, cause);
      throw cause;
    }
    if (!stats.isFile() || !isPathInside(realProjectRoot, realFile)) {
      throw cutError(`${label} is not a readable project media file.`, 'PROJECT_MISMATCH', 403);
    }
    // Preserve the configured data-root spelling (not macOS' /var -> /private/var
    // realpath spelling) when mapping the validated file back to a browser URL.
    const relative = path.relative(mediaRoot, filePath).split(path.sep).map(encodeURIComponent).join('/');
    return `/media/${relative}`;
  };

  const validateVisualMediaOwnership = async (index, projectId) => {
    const referenceCount = index.visualInputs.reduce((count, input) => (
      count + input.framePaths.length + (input.thumbnailPath ? 1 : 0)
    ), 0);
    if (referenceCount > 1_000) {
      throw cutError('The insight index contains too many visual media references.', 'INVALID_INPUT', 413);
    }
    const visualInputs = [];
    for (let inputIndex = 0; inputIndex < index.visualInputs.length; inputIndex += 1) {
      const input = index.visualInputs[inputIndex];
      const sourceRefs = [...input.framePaths, ...(input.thumbnailPath ? [input.thumbnailPath] : [])];
      const ownedFramePaths = [];
      for (let sourceIndex = 0; sourceIndex < sourceRefs.length; sourceIndex += 1) {
        ownedFramePaths.push(await resolveOwnedMedia(
          sourceRefs[sourceIndex],
          projectId,
          `Visual input "${input.assetName}" frame ${sourceIndex + 1}`,
        ));
      }
      visualInputs.push({ ...input, ownedFramePaths });
    }
    return { ...index, visualInputs };
  };

  const analyzeVisualContext = async ({ apiKey, model, index, retrievalSummary, projectId }) => {
    const selectedAssets = new Set(retrievalSummary.topMoments.map((moment) => moment.assetId));
    const candidates = index.visualInputs.filter((input) => selectedAssets.has(input.assetId)).slice(0, 4);
    const findings = [];
    for (const candidate of candidates) {
      const ownedRefs = candidate.ownedFramePaths;
      if (candidate.storedSummary?.status === 'ready'
        && (!candidate.storedSummary.model || candidate.storedSummary.model === model)) {
        findings.push(candidate.storedSummary);
        continue;
      }
      if (ownedRefs.length === 0) {
        findings.push({
          assetId: candidate.assetId,
          status: 'missing',
          model,
          error: 'No project-owned visual frames were available for hosted analysis.',
        });
        continue;
      }
      try {
        const imageUrls = [];
        for (let frameIndex = 0; frameIndex < Math.min(6, ownedRefs.length); frameIndex += 1) {
          imageUrls.push(await stageMedia(
            ownedRefs[frameIndex],
            apiKey,
            `Visual input "${candidate.assetName}" frame ${frameIndex + 1}`,
          ));
        }
        const result = await falSubscribe(VISION_ENDPOINT, {
          model,
          prompt: [
            `Analyze these project-owned frames from asset "${candidate.assetName}" for editorial planning.`,
            'Return compact JSON only with this shape:',
            '{"summary":"...","tone":["..."],"pacing":"...","shotTypes":["..."],"subjects":["..."],"brollIdeas":["..."],"confidence":0.82}',
            'Only describe visible evidence. Focus on emotional tone, coverage value, pacing, subjects, shot type, and practical b-roll opportunities.',
          ].join('\n'),
          image_urls: imageUrls,
          max_tokens: 450,
        }, apiKey);
        const parsed = extractJsonValue(extractProviderText(unwrapFalData(result)));
        if (!isPlainRecord(parsed)) throw cutError('Hosted vision returned invalid JSON.', 'PROVIDER_BAD_RESPONSE', 502);
        findings.push(normalizeVisualSummary({
          ...parsed,
          status: 'ready',
          model,
          updatedAt: new Date().toISOString(),
          sourceFrameCount: imageUrls.length,
        }, candidate.assetId));
      } catch (cause) {
        findings.push({
          assetId: candidate.assetId,
          status: 'failed',
          model,
          error: providerText(cause instanceof Error ? cause.message : String(cause), 'Hosted visual analysis failed.', 2_000),
        });
      }
    }
    return findings;
  };

  const inferEditorialBrief = async ({ apiKey, model, systemPrompt, request, index }) => {
    const fallback = fallbackEditorialBrief(request, index);
    const prompt = [
      'You are CineGen\'s senior editorial strategist.',
      'Infer the best editable cut brief for this request from the project-owned context.',
      'Return JSON only with this shape:',
      '{"pieceType":"...","deliverable":"...","audience":"...","tone":"...","pacing":"...","targetDurationSeconds":180,"variantCount":3,"persona":"documentary-editor","storyGoal":"...","hook":"...","formatNotes":"...","qualityGoal":"auto","referenceTimelineId":"optional","referenceTimelineName":"optional","useBrollPlaceholders":true,"confidence":0.84,"rationale":"...","clarifyingQuestions":[{"id":"...","question":"...","help":"...","allowCustom":true,"options":[{"id":"...","label":"...","description":"..."}]}]}',
      'Only include clarifying questions if the request is materially underspecified.',
      '',
      `User request: ${request}`,
      '',
      'Project context:',
      `- Assets: ${index.stats.assetCount}`,
      `- Transcript-ready assets: ${index.stats.transcriptReadyCount}`,
      `- Word-timestamp-ready assets: ${index.stats.wordTimestampReadyCount}`,
      `- Visual-summary-ready assets: ${index.stats.visualSummaryReadyCount}`,
      'Reference timelines:',
      summarizeReferenceTimelines(index) || '- none',
    ].join('\n');
    const response = await callTextLLM({
      apiKey,
      model,
      systemPrompt: ['You produce concise, grounded editorial briefs for film and promo editors.', systemPrompt]
        .filter(Boolean).join('\n\n'),
      prompt,
      maxTokens: 900,
      temperature: 0.35,
    });
    const parsed = extractJsonValue(response.message);
    const normalized = normalizeEditorialBrief(parsed, fallback, index.timelineById);
    return { ...normalized, usage: response.usage };
  };

  const resolveSegmentAsset = (record, project) => {
    const requestedId = providerText(record.asset_id, '', 256);
    if (requestedId && project.assetsById.has(requestedId)) return project.assetsById.get(requestedId);
    const requestedName = providerText(record.asset_name, '', 1_024).toLowerCase();
    return requestedName ? project.assetsByName.get(requestedName) : undefined;
  };

  const normalizeSegment = (value, project) => {
    if (!isPlainRecord(value)) return null;
    const asset = resolveSegmentAsset(value, project);
    if (!asset) return null;
    let sourceStart = roundTime(value.source_start);
    let sourceEnd = roundTime(value.source_end);
    if (sourceStart === null || sourceEnd === null || sourceEnd <= sourceStart) return null;
    if (asset.duration !== undefined) {
      sourceStart = clamp(sourceStart, 0, asset.duration);
      sourceEnd = clamp(sourceEnd, 0, asset.duration);
      if (sourceEnd <= sourceStart) return null;
    }
    return {
      asset_id: asset.id,
      asset_name: asset.name,
      source_start: sourceStart,
      source_end: sourceEnd,
      ...(providerText(value.note, '', 2_000) ? { note: providerText(value.note, '', 2_000) } : {}),
    };
  };

  const normalizeVariant = (value, variantIndex, project) => {
    if (!isPlainRecord(value)) return null;
    const proposals = Array.isArray(value.proposals) ? value.proposals.slice(0, 10).flatMap((proposal, proposalIndex) => {
      if (!isPlainRecord(proposal)) return [];
      const segments = Array.isArray(proposal.segments)
        ? proposal.segments.slice(0, 200).map((segment) => normalizeSegment(segment, project)).filter(Boolean)
        : [];
      if (segments.length === 0) return [];
      return [{
        type: 'cut_proposal',
        summary: providerText(proposal.summary, `Proposed ${segments.length} cut segments.`, 4_000),
        timeline_name: providerText(proposal.timeline_name, `AI Cut ${variantIndex + 1}.${proposalIndex + 1}`, 200),
        should_create_timeline: proposal.should_create_timeline === true,
        segments,
      }];
    }) : [];
    if (proposals.length === 0) return null;
    return {
      id: `variant_${variantIndex + 1}`,
      title: providerText(value.title, `Variant ${variantIndex + 1}`, 500),
      strategy: providerText(value.strategy, 'Balanced editorial approach', 2_000),
      summary: providerText(value.summary, proposals[0].summary, 4_000),
      rationale: providerText(value.rationale, 'Generated from the editorial brief and project-owned evidence.', 4_000),
      proposals,
      scorecard: defaultScorecard(variantIndex),
    };
  };

  const fallbackVariant = (variantIndex, strategy, brief, retrievalSummary) => {
    if (retrievalSummary.topMoments.length === 0) return null;
    const segments = [];
    let duration = 0;
    for (const moment of retrievalSummary.topMoments) {
      if (segments.length >= 40 || (segments.length > 0 && duration >= brief.targetDurationSeconds)) break;
      const segmentDuration = moment.sourceEnd - moment.sourceStart;
      segments.push({
        asset_id: moment.assetId,
        asset_name: moment.assetName,
        source_start: moment.sourceStart,
        source_end: moment.sourceEnd,
        note: `${moment.reason} [asset:${moment.assetName} @ ${formatTimestamp(moment.sourceStart)}]`,
      });
      duration += segmentDuration;
    }
    return {
      id: `variant_${variantIndex + 1}`,
      title: `Evidence-led variant ${variantIndex + 1}`,
      strategy,
      summary: `A deterministic ${segments.length}-segment cut assembled from the highest-ranked project transcript moments.`,
      rationale: 'The hosted model response could not be normalized, so the web workflow preserved a usable, citation-backed edit plan.',
      proposals: [{
        type: 'cut_proposal',
        summary: `Project-owned evidence cut with ${segments.length} source segments.`,
        timeline_name: `AI Cut ${variantIndex + 1}`,
        should_create_timeline: false,
        segments,
      }],
      scorecard: defaultScorecard(variantIndex),
    };
  };

  const generateVariants = async ({ apiKey, model, systemPrompt, request, brief, retrievalSummary, visualFindings, project }) => {
    const lowerBrief = `${brief.pieceType} ${brief.deliverable} ${brief.tone}`.toLowerCase();
    const templates = /promo|trailer|social|teaser|hype/.test(lowerBrief)
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
    const strategies = templates.slice(0, brief.variantCount);
    const variants = [];
    let usage;
    for (let variantIndex = 0; variantIndex < strategies.length; variantIndex += 1) {
      const prompt = [
        'You are CineGen\'s lead editor creating one high-quality, directly cuttable proposal.',
        `Generate exactly one editorial variant using this strategy: ${strategies[variantIndex]}`,
        'Use only the retrieved source moments and hosted visual findings as evidence. Never invent an asset, quote, or source timestamp.',
        'Return JSON only with this shape:',
        '{"id":"variant_1","title":"...","strategy":"...","summary":"...","rationale":"...","proposals":[{"type":"cut_proposal","summary":"...","timeline_name":"...","should_create_timeline":false,"segments":[{"asset_id":"...","asset_name":"...","source_start":12.3,"source_end":18.7,"note":"..."}]}]}',
        variants.length ? `Already generated variants (make this materially different):\n${JSON.stringify(variants.map(({ title, strategy, summary }) => ({ title, strategy, summary })))}` : '',
        '',
        'Editorial brief:',
        JSON.stringify(brief),
        '',
        'Retrieved source citations:',
        summarizeRetrievedMoments(retrievalSummary.topMoments) || '- none',
        '',
        'Reference timelines:',
        retrievalSummary.referenceTimelines.map((timeline) => `- ${timeline.timelineName}: ${timeline.structureSummary}`).join('\n') || '- none',
        '',
        'Hosted visual findings:',
        summarizeVisualFindings(visualFindings) || '- none',
        '',
        `Original request: ${request}`,
      ].filter(Boolean).join('\n');
      const response = await callTextLLM({
        apiKey,
        model,
        systemPrompt: [
          'You are a world-class editor. Make proposals that feel genuinely cuttable and evidence-grounded.',
          systemPrompt,
        ].filter(Boolean).join('\n\n'),
        prompt,
        maxTokens: 2_400,
        temperature: 0.45,
      });
      usage = mergeUsage(usage, response.usage);
      const parsed = extractJsonValue(response.message);
      const rawVariant = isPlainRecord(parsed) && Array.isArray(parsed.variants) ? parsed.variants[0] : parsed;
      variants.push(
        normalizeVariant(rawVariant, variantIndex, project)
          ?? fallbackVariant(variantIndex, strategies[variantIndex], brief, retrievalSummary),
      );
    }
    return { variants: variants.filter(Boolean), usage };
  };

  const normalizeScorecard = (value, fallback) => {
    if (!isPlainRecord(value)) return fallback;
    const score = (key) => clamp(finiteNumber(value[key]) ?? fallback[key], 0, 100);
    return {
      overall: score('overall'),
      storyArc: score('storyArc'),
      pacing: score('pacing'),
      clarity: score('clarity'),
      visualFit: score('visualFit'),
      completeness: score('completeness'),
      formatFit: score('formatFit'),
      strengths: stringArray(value.strengths, 12, 1_000),
      cautions: stringArray(value.cautions, 12, 1_000),
      rationale: providerText(value.rationale, fallback.rationale, 4_000),
    };
  };

  const judgeVariants = async ({ apiKey, model, systemPrompt, brief, retrievalSummary, variants }) => {
    if (variants.length === 0) return { variants };
    const response = await callTextLLM({
      apiKey,
      model,
      systemPrompt: ['Be decisive. Prefer the best usable cut, not the safest explanation.', systemPrompt]
        .filter(Boolean).join('\n\n'),
      prompt: [
        'You are CineGen\'s finishing editor and quality judge.',
        'Score these variants against the brief and source evidence.',
        'Return JSON only with this shape:',
        '{"ranked_variant_ids":["variant_2","variant_1"],"scorecards":[{"variant_id":"variant_2","overall":92,"storyArc":94,"pacing":90,"clarity":89,"visualFit":88,"completeness":91,"formatFit":93,"strengths":["..."],"cautions":["..."],"rationale":"..."}]}',
        '',
        'Editorial brief:',
        JSON.stringify(brief),
        '',
        'Retrieved evidence:',
        summarizeRetrievedMoments(retrievalSummary.topMoments.slice(0, 10)),
        '',
        'Variants:',
        JSON.stringify(variants.map((variant) => ({
          id: variant.id,
          title: variant.title,
          strategy: variant.strategy,
          summary: variant.summary,
          rationale: variant.rationale,
          proposals: variant.proposals,
        }))),
      ].join('\n'),
      maxTokens: 1_600,
      temperature: 0.2,
    });
    const parsed = extractJsonValue(response.message);
    if (!isPlainRecord(parsed)) return { variants, usage: response.usage };
    const scorecardById = new Map();
    for (const value of Array.isArray(parsed.scorecards) ? parsed.scorecards : []) {
      if (!isPlainRecord(value) || typeof value.variant_id !== 'string') continue;
      const variant = variants.find((entry) => entry.id === value.variant_id);
      if (variant) scorecardById.set(variant.id, normalizeScorecard(value, variant.scorecard));
    }
    const rankedIds = Array.isArray(parsed.ranked_variant_ids)
      ? [...new Set(parsed.ranked_variant_ids.filter((id) => variants.some((variant) => variant.id === id)))]
      : [];
    const ranked = variants.map((variant) => ({
      ...variant,
      scorecard: scorecardById.get(variant.id) ?? variant.scorecard,
    })).sort((left, right) => {
      const leftRank = rankedIds.indexOf(left.id);
      const rightRank = rankedIds.indexOf(right.id);
      if (leftRank === -1 && rightRank === -1) return right.scorecard.overall - left.scorecard.overall;
      if (leftRank === -1) return 1;
      if (rightRank === -1) return -1;
      return leftRank - rightRank;
    });
    return { variants: ranked, usage: response.usage };
  };

  return {
    runCutWorkflow: async (paramsValue) => {
      const params = requireRecord(paramsValue, 'Cut workflow parameters');
      const apiKey = requireSecret(params.apiKey, 'fal.ai API key');
      const request = requireString(params.request, 'Cut request', { maxLength: 100_000 });
      const projectId = requireId(params.projectId, 'Project id');
      const activeTimelineId = requireId(params.activeTimelineId, 'Active timeline id');
      const model = params.model === undefined || params.model === null || params.model === ''
        ? DEFAULT_TEXT_MODEL
        : validateModelId(params.model, 'LLM model');
      const visionModel = params.visionModel === undefined || params.visionModel === null || params.visionModel === ''
        ? DEFAULT_VISION_MODEL
        : validateModelId(params.visionModel, 'Vision model');
      const systemPrompt = optionalText(params.systemPrompt, 'Cut workflow system prompt', 100_000);
      if (params.confirmedBrief !== undefined && typeof params.confirmedBrief !== 'boolean') {
        throw cutError('confirmedBrief must be a boolean.');
      }
      if (!store || typeof store.load !== 'function') {
        throw cutError('Project storage is unavailable for the cut workflow.', 'SERVER_MISCONFIGURED', 500);
      }
      const state = await store.load(projectId);
      const project = normalizeProjectState(state, projectId);
      const normalizedIndex = normalizeIndex(params.index, projectId, activeTimelineId, project);
      const index = await validateVisualMediaOwnership(normalizedIndex, projectId);

      let usage;
      const inference = await inferEditorialBrief({ apiKey, model, systemPrompt, request, index });
      usage = mergeUsage(usage, inference.usage);
      let editorialBrief = validateBriefOverride(params.briefOverride, inference.brief, index.timelineById);
      editorialBrief = mergeQuestionAnswers(editorialBrief, params.questionAnswers);
      let retrievalSummary = buildRetrievalSummary(index, request, editorialBrief);

      if (params.confirmedBrief !== true) {
        return {
          stage: 'brief',
          summaryMessage: inference.clarifyingQuestions.length > 0
            ? 'I drafted an editorial brief and need a bit of guidance before generating the cut variants.'
            : 'I drafted the editorial brief. Review it, adjust anything you want, then generate the cut variants.',
          editorialBrief,
          clarifyingQuestions: inference.clarifyingQuestions,
          retrievalSummary,
          visualFindings: [],
          variants: [],
          ...(usage ? { usage } : {}),
        };
      }

      const visualFindings = await analyzeVisualContext({
        apiKey,
        model: visionModel,
        index,
        retrievalSummary,
        projectId,
      });
      retrievalSummary = buildRetrievalSummary(index, request, editorialBrief, visualFindings);
      const generated = await generateVariants({
        apiKey,
        model,
        systemPrompt,
        request,
        brief: editorialBrief,
        retrievalSummary,
        visualFindings,
        project,
      });
      usage = mergeUsage(usage, generated.usage);
      if (generated.variants.length === 0) {
        return {
          stage: 'brief',
          summaryMessage: 'No project-owned transcript evidence was available to build a safe cut proposal. Add or transcribe media, then try again.',
          editorialBrief,
          clarifyingQuestions: inference.clarifyingQuestions,
          retrievalSummary,
          visualFindings,
          variants: [],
          ...(usage ? { usage } : {}),
        };
      }
      const judged = await judgeVariants({
        apiKey,
        model,
        systemPrompt,
        brief: editorialBrief,
        retrievalSummary,
        variants: generated.variants,
      });
      usage = mergeUsage(usage, judged.usage);
      return {
        stage: 'variants',
        summaryMessage: judged.variants.length === 1
          ? 'I generated one cut variant. Review it below.'
          : `I generated ${judged.variants.length} cut variants. Review the options below.`,
        editorialBrief,
        clarifyingQuestions: inference.clarifyingQuestions,
        retrievalSummary,
        visualFindings,
        variants: judged.variants,
        ...(usage ? { usage } : {}),
      };
    },
  };
}
