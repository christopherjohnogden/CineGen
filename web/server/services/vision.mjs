import { spawn } from 'node:child_process';
import {
  ServiceError,
  createFalMediaStager,
  createFalSubscriber,
  isPlainRecord,
  isWebMediaReference,
  optionalSecret,
  requireRecord,
  requireSecret,
  requireString,
  resolveWebMediaPath,
  validateModelId,
} from './_shared.mjs';

export const DEFAULT_VISION_MODEL = 'google/gemini-2.5-flash';
const VISION_ENDPOINT = 'fal-ai/any-llm/vision';
const VIDEO_ENDPOINT = 'fal-ai/video-understanding';
const ACOUSTIC_ANALYSIS_VERSION = 1;
const SILENCE_NOISE_DB = -30;
const SILENCE_MIN_DURATION = 0.3;

export const visionCapabilities = Object.freeze({
  hostedFrameIndexing: true,
  hostedObjectDetection: true,
  hostedAcousticDescriptors: true,
  hostedCopilotVisualAnalysis: true,
  localGeminiCli: false,
  serverSilenceDetection: 'best-effort',
  copilotClipPretrim: false,
  copilotPromptedTimeRange: true,
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function optionalText(value, label, maxLength = 16_000) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new ServiceError(`${label} must be text.`, { code: 'INVALID_INPUT' });
  }
  if (value.length > maxLength) {
    throw new ServiceError(`${label} is too long.`, { code: 'INVALID_INPUT' });
  }
  return value.trim() || undefined;
}

function providerFieldText(value, maxLength = 100_000) {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, maxLength)
    : undefined;
}

function optionalModel(value) {
  return value === undefined || value === null || value === ''
    ? DEFAULT_VISION_MODEL
    : validateModelId(value, 'Vision model');
}

function finiteNumber(value, label, { min = -Infinity, max = Infinity } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new ServiceError(`${label} must be a finite number between ${min} and ${max}.`, {
      code: 'INVALID_INPUT',
    });
  }
  return value;
}

function tryParseJson(candidate) {
  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    return null;
  }
}

function extractJsonText(raw) {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) return null;
  const direct = tryParseJson(trimmed);
  if (direct) return direct;

  for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const inner = match[1]?.trim();
    if (inner && tryParseJson(inner)) return inner;
  }

  const openers = new Map([['{', '}'], ['[', ']']]);
  for (let start = 0; start < trimmed.length; start += 1) {
    const expectedCloser = openers.get(trimmed[start]);
    if (!expectedCloser) continue;
    const stack = [expectedCloser];
    let inString = false;
    let escaped = false;
    for (let end = start + 1; end < trimmed.length; end += 1) {
      const character = trimmed[end];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === '\\' && inString) {
        escaped = true;
        continue;
      }
      if (character === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      const nestedCloser = openers.get(character);
      if (nestedCloser) {
        stack.push(nestedCloser);
        continue;
      }
      if (character === stack[stack.length - 1]) {
        stack.pop();
        if (stack.length === 0) {
          const candidate = trimmed.slice(start, end + 1);
          if (tryParseJson(candidate)) return candidate;
          break;
        }
      } else if (character === '}' || character === ']') {
        break;
      }
    }
  }
  return null;
}

function extractTextFromUnknown(value, seen = new WeakSet(), depth = 0) {
  if (typeof value === 'string') return value;
  if (depth > 10 || value === null || typeof value !== 'object') return '';
  if (seen.has(value)) return '';
  seen.add(value);
  const entries = Array.isArray(value) ? value : Object.values(value);
  const result = entries
    .map((entry) => extractTextFromUnknown(entry, seen, depth + 1))
    .filter(Boolean)
    .join('\n');
  seen.delete(value);
  return result;
}

function unwrapFalData(result) {
  return isPlainRecord(result) && isPlainRecord(result.data) ? result.data : result;
}

function providerText(result) {
  const data = unwrapFalData(result);
  if (!isPlainRecord(data)) return extractTextFromUnknown(data).trim();
  return (
    extractTextFromUnknown(data.output)
    || extractTextFromUnknown(data.text)
    || extractTextFromUnknown(data.description)
    || extractTextFromUnknown(data)
  ).trim();
}

function parseFractionalNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.endsWith('%')) {
    const parsedPercent = Number(trimmed.slice(0, -1));
    return Number.isFinite(parsedPercent) ? parsedPercent / 100 : null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDetectedObjects(parsed, maxObjects) {
  const rawObjects = Array.isArray(parsed.objects)
    ? parsed.objects
    : Array.isArray(parsed.detections)
      ? parsed.detections
      : Array.isArray(parsed.items)
        ? parsed.items
        : Array.isArray(parsed.regions)
          ? parsed.regions
          : Array.isArray(parsed.subjects)
            ? parsed.subjects
            : (typeof parsed.label === 'string' || typeof parsed.name === 'string' || typeof parsed.object === 'string')
              ? [parsed]
              : [];

  const normalized = rawObjects.map((rawObject) => {
    if (!isPlainRecord(rawObject)) return null;
    const label = [
      rawObject.label,
      rawObject.name,
      rawObject.object,
      rawObject.subject,
      rawObject.class,
      rawObject.type,
    ].find((value) => typeof value === 'string' && value.trim());
    if (typeof label !== 'string') return null;

    let x = null;
    let y = null;
    let width = null;
    let height = null;

    const centerBox = Array.isArray(rawObject.box)
      ? rawObject.box
      : Array.isArray(rawObject.cxcywh) ? rawObject.cxcywh : null;
    if (centerBox?.length >= 4) {
      [x, y, width, height] = centerBox.slice(0, 4).map(parseFractionalNumber);
    }

    const cornerBox = Array.isArray(rawObject.bbox)
      ? rawObject.bbox
      : Array.isArray(rawObject.bounds)
        ? rawObject.bounds
        : Array.isArray(rawObject.rect)
          ? rawObject.rect
          : Array.isArray(rawObject.xyxy) ? rawObject.xyxy : null;
    if ([x, y, width, height].some((value) => value === null) && cornerBox?.length >= 4) {
      const [x0, y0, x1, y1] = cornerBox.slice(0, 4).map(parseFractionalNumber);
      if ([x0, y0, x1, y1].every((value) => value !== null)) {
        x = (x0 + x1) / 2;
        y = (y0 + y1) / 2;
        width = x1 - x0;
        height = y1 - y0;
      }
    }

    const box3d = Array.isArray(rawObject.box_3d)
      ? rawObject.box_3d
      : Array.isArray(rawObject.box3d) ? rawObject.box3d : null;
    if ([x, y, width, height].some((value) => value === null) && box3d?.length >= 6) {
      const centerX = parseFractionalNumber(box3d[0]);
      const centerY = parseFractionalNumber(box3d[1]);
      const dimA = parseFractionalNumber(box3d[3]);
      const dimB = parseFractionalNumber(box3d[4]);
      const dimC = parseFractionalNumber(box3d[5]);
      if ([centerX, centerY, dimA, dimB, dimC].every((value) => value !== null)) {
        x = centerX;
        y = centerY;
        width = Math.max(dimA, dimB);
        height = Math.max(dimB, dimC);
      }
    }

    if ([x, y, width, height].some((value) => value === null)) {
      const centerX = parseFractionalNumber(rawObject.center_x ?? rawObject.cx ?? rawObject.mid_x);
      const centerY = parseFractionalNumber(rawObject.center_y ?? rawObject.cy ?? rawObject.mid_y);
      const nextWidth = parseFractionalNumber(rawObject.width ?? rawObject.w);
      const nextHeight = parseFractionalNumber(rawObject.height ?? rawObject.h);
      if ([centerX, centerY, nextWidth, nextHeight].every((value) => value !== null)) {
        x = centerX;
        y = centerY;
        width = nextWidth;
        height = nextHeight;
      }
    }

    if ([x, y, width, height].some((value) => value === null)) {
      const xMin = parseFractionalNumber(rawObject.x_min ?? rawObject.left);
      const yMin = parseFractionalNumber(rawObject.y_min ?? rawObject.top);
      const xMax = parseFractionalNumber(rawObject.x_max ?? rawObject.right);
      const yMax = parseFractionalNumber(rawObject.y_max ?? rawObject.bottom);
      if ([xMin, yMin, xMax, yMax].every((value) => value !== null)) {
        x = (xMin + xMax) / 2;
        y = (yMin + yMax) / 2;
        width = xMax - xMin;
        height = yMax - yMin;
      }
    }

    if ([x, y, width, height].some((value) => value === null || !Number.isFinite(value))) return null;
    const safeWidth = clamp(width, 0.02, 1);
    const safeHeight = clamp(height, 0.02, 1);
    const scoreValue = parseFractionalNumber(rawObject.score ?? rawObject.confidence ?? rawObject.probability);
    const score = scoreValue === null ? 0.75 : clamp(scoreValue, 0, 1);
    const priorityValue = parseFractionalNumber(rawObject.priority ?? rawObject.salience ?? rawObject.importance);
    return {
      label: label.trim(),
      box: [
        clamp(x, safeWidth / 2, 1 - safeWidth / 2),
        clamp(y, safeHeight / 2, 1 - safeHeight / 2),
        safeWidth,
        safeHeight,
      ],
      score,
      priority: priorityValue === null ? score : clamp(priorityValue, 0, 1),
    };
  }).filter(Boolean).sort((left, right) => right.priority - left.priority || right.score - left.score);

  const deduped = [];
  for (const candidate of normalized) {
    const duplicate = deduped.some((existing) => (
      existing.label.toLowerCase() === candidate.label.toLowerCase()
      && Math.abs(existing.box[0] - candidate.box[0]) < 0.06
      && Math.abs(existing.box[1] - candidate.box[1]) < 0.06
      && Math.abs(existing.box[2] - candidate.box[2]) < 0.08
      && Math.abs(existing.box[3] - candidate.box[3]) < 0.08
    ));
    if (!duplicate) deduped.push(candidate);
    if (deduped.length >= maxObjects) break;
  }
  return deduped;
}

function extractObjectPayload(value, seen = new WeakSet(), depth = 0) {
  if (depth > 10) return null;
  if (Array.isArray(value)) return { objects: value };
  if (value && typeof value === 'object') {
    if (seen.has(value)) return null;
    seen.add(value);
    const record = value;
    if (['objects', 'detections', 'items', 'regions', 'subjects'].some((key) => Array.isArray(record[key]))) {
      return record;
    }
    if (
      ['label', 'name', 'object'].some((key) => typeof record[key] === 'string')
      || ['box_3d', 'box3d', 'box', 'bbox'].some((key) => Array.isArray(record[key]))
    ) {
      return { objects: [record] };
    }
    for (const key of ['output', 'text', 'content', 'message', 'result', 'data', 'response']) {
      if (key in record) {
        const nested = extractObjectPayload(record[key], seen, depth + 1);
        if (nested) return nested;
      }
    }
  }
  const text = extractTextFromUnknown(value);
  const jsonText = extractJsonText(text);
  if (!jsonText) return null;
  try {
    const parsed = JSON.parse(jsonText);
    if (Array.isArray(parsed)) return { objects: parsed };
    return isPlainRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function stringArray(value) {
  if (!Array.isArray(value)) return undefined;
  const result = value
    .filter((entry) => typeof entry === 'string' && entry.trim())
    .map((entry) => entry.trim());
  return result.length > 0 ? result : undefined;
}

function validateIndexParams(value) {
  const params = requireRecord(value, 'Vision index parameters');
  if (!Array.isArray(params.framePaths) || params.framePaths.length > 24) {
    throw new ServiceError('Vision frame paths must be an array with at most 24 entries.', {
      code: 'INVALID_INPUT',
    });
  }
  return {
    apiKey: requireSecret(params.apiKey, 'fal.ai API key'),
    assetId: requireString(params.assetId, 'Asset id', { maxLength: 256 }),
    assetName: requireString(params.assetName, 'Asset name', { maxLength: 1_024 }),
    framePaths: params.framePaths.map((entry, index) => (
      requireString(entry, `Vision frame ${index + 1}`, { maxLength: 4_096 })
    )),
    model: optionalModel(params.model),
  };
}

function validateDetectParams(value) {
  const params = requireRecord(value, 'Object detection parameters');
  let maxObjects = 6;
  if (params.maxObjects !== undefined && params.maxObjects !== null) {
    maxObjects = Math.round(finiteNumber(params.maxObjects, 'Maximum object count', { min: 1, max: 12 }));
  }
  return {
    apiKey: requireSecret(params.apiKey, 'fal.ai API key'),
    imagePath: requireString(params.imagePath, 'Detection image', { maxLength: 4_096 }),
    maxObjects,
    context: optionalText(params.context, 'Detection context', 12_000),
    model: optionalModel(params.model),
  };
}

function parseSilenceDetect(stderr) {
  const intervals = [];
  let pendingStart = null;
  for (const line of stderr.split(/\r?\n/)) {
    const startMatch = line.match(/silence_start:\s*(-?\d+(?:\.\d+)?)/);
    if (startMatch) {
      pendingStart = Number(startMatch[1]);
      continue;
    }
    const endMatch = line.match(/silence_end:\s*(-?\d+(?:\.\d+)?)/);
    if (endMatch && pendingStart !== null) {
      const end = Number(endMatch[1]);
      if (Number.isFinite(end) && end > pendingStart) intervals.push({ start: pendingStart, end });
      pendingStart = null;
    }
  }
  return intervals;
}

function buildAcousticPrompt({ assetName, transcript }) {
  if (transcript.length === 0) {
    return [
      `Analyze the media "${assetName}", which has no spoken dialogue (b-roll / cutaway footage).`,
      'Listen and watch, then return compact JSON ONLY with this shape:',
      '{"segments":[{"start":0.0,"end":8.0,"content":"...","shotType":"wide","cutawayCandidate":true,"confidence":0.7}]}',
      'Break the clip into a few meaningful time ranges. For each range, describe the visual content and ambient sound,',
      'name a likely shotType, and set cutawayCandidate true when the range would work as a cutaway over interview audio.',
      'Return only JSON, no prose.',
    ].join('\n');
  }
  const transcriptLines = transcript
    .map((segment) => `[${segment.start.toFixed(2)}-${segment.end.toFixed(2)}] ${segment.text}`)
    .join('\n');
  return [
    `You are an assistant film editor analyzing the AUDIO performance in "${assetName}".`,
    'Here is the transcript with timecodes (seconds):',
    transcriptLines,
    '',
    'Listen to the audio and, for each transcript segment (matched by its timecodes), describe HOW it was said.',
    'Return compact JSON ONLY with this shape:',
    '{"segments":[{"start":0.0,"end":3.2,"delivery":"voice steadies then cracks on \'home\'","emotion":"reflective","energy":"low-and-deliberate","pace":"slow","notable":["400ms pause before \'home\'","usable as hook"],"confidence":0.8}]}',
    'Use rich descriptive text, NOT numeric scores. Capture vocal delivery, emotion, energy, pace, hesitations,',
    'laughter, breaths, and reflective pauses. Keep each field short. Return only JSON, no prose.',
  ].join('\n');
}

function normalizeAcousticSegments(raw) {
  const jsonText = extractJsonText(raw);
  if (!jsonText) return [];
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }
  const entries = Array.isArray(parsed)
    ? parsed
    : isPlainRecord(parsed) && Array.isArray(parsed.segments) ? parsed.segments : [];
  return entries.flatMap((entry) => {
    if (!isPlainRecord(entry)) return [];
    const start = Number(entry.start);
    const end = Number(entry.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    const text = (key) => typeof entry[key] === 'string' && entry[key].trim() ? entry[key].trim() : undefined;
    const notable = stringArray(entry.notable);
    const confidence = Number(entry.confidence);
    return [{
      start,
      end,
      delivery: text('delivery'),
      emotion: text('emotion'),
      energy: text('energy'),
      pace: text('pace'),
      notable,
      content: text('content'),
      shotType: text('shotType'),
      cutawayCandidate: typeof entry.cutawayCandidate === 'boolean' ? entry.cutawayCandidate : undefined,
      confidence: Number.isFinite(confidence) ? confidence : undefined,
    }];
  });
}

function validateAcousticParams(value) {
  const params = requireRecord(value, 'Acoustic analysis parameters');
  if (!Array.isArray(params.transcript) || params.transcript.length > 5_000) {
    throw new ServiceError('Acoustic transcript must be an array with at most 5,000 segments.', {
      code: 'INVALID_INPUT',
    });
  }
  const transcript = params.transcript.map((entry, index) => {
    const segment = requireRecord(entry, `Transcript segment ${index + 1}`);
    const start = finiteNumber(segment.start, `Transcript segment ${index + 1} start`, { min: 0 });
    const end = finiteNumber(segment.end, `Transcript segment ${index + 1} end`, { min: 0 });
    if (end <= start) {
      throw new ServiceError(`Transcript segment ${index + 1} must end after it starts.`, {
        code: 'INVALID_INPUT',
      });
    }
    return {
      start,
      end,
      text: requireString(segment.text, `Transcript segment ${index + 1} text`, { maxLength: 20_000 }),
    };
  });
  if (typeof params.isVideo !== 'boolean') {
    throw new ServiceError('Acoustic media type must indicate whether the asset is video.', {
      code: 'INVALID_INPUT',
    });
  }
  let durationSec;
  if (params.durationSec !== undefined && params.durationSec !== null) {
    durationSec = finiteNumber(params.durationSec, 'Asset duration', { min: 0, max: 7 * 24 * 60 * 60 });
  }
  return {
    apiKey: optionalSecret(params.apiKey, 'fal.ai API key'),
    assetId: requireString(params.assetId, 'Asset id', { maxLength: 256 }),
    assetName: requireString(params.assetName, 'Asset name', { maxLength: 1_024 }),
    mediaPath: requireString(params.mediaPath, 'Acoustic media source', { maxLength: 4_096 }),
    isVideo: params.isVideo,
    durationSec,
    transcript,
    requestedModel: optionalText(params.model, 'Acoustic model', 512),
  };
}

function createDefaultSilenceDetector(options) {
  const ffmpegPath = options.ffmpegPath ?? process.env.CINEGEN_FFMPEG_PATH ?? 'ffmpeg';
  const timeoutMs = options.silenceTimeoutMs ?? 2 * 60_000;
  return (mediaPath) => new Promise((resolve) => {
    const child = spawn(ffmpegPath, [
      '-i', mediaPath,
      '-af', `silencedetect=noise=${SILENCE_NOISE_DB}dB:d=${SILENCE_MIN_DURATION}`,
      '-f', 'null', '-',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ available: false, stderr: '' });
    }, timeoutMs);
    timer.unref?.();
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 2 * 1024 * 1024) stderr += chunk.toString();
    });
    child.on('error', () => finish({ available: false, stderr: '' }));
    child.on('close', () => finish({ available: true, stderr }));
  });
}

async function invokeSilenceDetector(detector, mediaPath) {
  const result = await detector(mediaPath);
  if (typeof result === 'string') return { available: true, stderr: result };
  if (isPlainRecord(result)) {
    return {
      available: result.available !== false,
      stderr: typeof result.stderr === 'string' ? result.stderr : '',
    };
  }
  return { available: false, stderr: '' };
}

function validateCopilotParams(value) {
  const params = requireRecord(value, 'Copilot visual analysis parameters');
  if (!Array.isArray(params.visualRefs) || params.visualRefs.length === 0 || params.visualRefs.length > 12) {
    throw new ServiceError('Copilot visual references must contain between 1 and 12 entries.', {
      code: 'INVALID_INPUT',
    });
  }
  const visualRefs = params.visualRefs.map((entry, index) => {
    const ref = requireRecord(entry, `Visual reference ${index + 1}`);
    if (!['asset', 'clip'].includes(ref.kind)) {
      throw new ServiceError(`Visual reference ${index + 1} has an invalid kind.`, { code: 'INVALID_INPUT' });
    }
    if (!['image', 'video'].includes(ref.mediaType)) {
      throw new ServiceError(`Visual reference ${index + 1} has an invalid media type.`, { code: 'INVALID_INPUT' });
    }
    let framePaths = [];
    if (ref.framePaths !== undefined && ref.framePaths !== null) {
      if (!Array.isArray(ref.framePaths) || ref.framePaths.length > 24) {
        throw new ServiceError(`Visual reference ${index + 1} frame paths are invalid.`, {
          code: 'INVALID_INPUT',
        });
      }
      framePaths = ref.framePaths.map((framePath, frameIndex) => (
        requireString(framePath, `Visual reference ${index + 1} frame ${frameIndex + 1}`, { maxLength: 4_096 })
      ));
    }
    const trimStartSec = ref.trimStartSec === undefined
      ? undefined
      : finiteNumber(ref.trimStartSec, `Visual reference ${index + 1} trim start`, { min: 0, max: 7 * 24 * 60 * 60 });
    const trimDurationSec = ref.trimDurationSec === undefined
      ? undefined
      : finiteNumber(ref.trimDurationSec, `Visual reference ${index + 1} trim duration`, { min: 0.01, max: 7 * 24 * 60 * 60 });
    return {
      label: requireString(ref.label, `Visual reference ${index + 1} label`, { maxLength: 1_024 }),
      kind: ref.kind,
      mediaType: ref.mediaType,
      fileRef: requireString(ref.fileRef, `Visual reference ${index + 1} file`, { maxLength: 4_096 }),
      trimStartSec,
      trimDurationSec,
      framePaths,
    };
  });
  return {
    apiKey: requireSecret(params.apiKey, 'fal.ai API key'),
    prompt: optionalText(params.prompt, 'Copilot visual prompt', 100_000) ?? '',
    visualRefs,
  };
}

function buildCopilotPrompt(userPrompt, ref, mediaType) {
  const mediaLabel = mediaType === 'video' ? 'video clip' : 'image';
  const rangeNote = mediaType === 'video' && ref.trimStartSec !== undefined && ref.trimDurationSec !== undefined
    ? `Focus especially on the requested source range from ${ref.trimStartSec.toFixed(2)}s to ${(ref.trimStartSec + ref.trimDurationSec).toFixed(2)}s. The web service analyzes the hosted source without physically trimming it.`
    : null;
  return [
    userPrompt.trim() || `Describe this ${mediaLabel} in detail.`,
    `Attached ${mediaLabel}: "${ref.label}".`,
    rangeNote,
    'Describe what you actually see and hear — specific subjects, actions, setting, camera movement, on-screen text, and spoken dialogue.',
    'Do not answer from clip names, storyboard labels, or generic production terminology alone.',
  ].filter(Boolean).join('\n');
}

export function createVisionServices(options = {}) {
  const falSubscribe = options.falSubscribe ?? createFalSubscriber(options);
  const stageMedia = options.stageMedia ?? createFalMediaStager(options);
  const silenceDetector = options.silenceDetector ?? createDefaultSilenceDetector(options);

  const analyzeImageUrl = async (imageUrl, prompt, apiKey, model = DEFAULT_VISION_MODEL) => {
    const result = await falSubscribe(VISION_ENDPOINT, {
      model,
      prompt: prompt.trim() || 'Describe this image in detail.',
      image_urls: [imageUrl],
      max_tokens: 900,
    }, apiKey);
    const analysis = providerText(result);
    if (!analysis) {
      throw new ServiceError('Image analysis returned an empty response.', {
        code: 'PROVIDER_BAD_RESPONSE',
        statusCode: 502,
      });
    }
    return analysis;
  };

  const analyzeVideoUrl = async (videoUrl, prompt, apiKey) => {
    const result = await falSubscribe(VIDEO_ENDPOINT, {
      video_url: videoUrl,
      prompt: prompt.trim() || 'Describe this video in detail.',
      detailed_analysis: true,
    }, apiKey);
    const analysis = providerText(result);
    if (!analysis) {
      throw new ServiceError('Video analysis returned an empty response.', {
        code: 'PROVIDER_BAD_RESPONSE',
        statusCode: 502,
      });
    }
    return analysis;
  };

  const runObjectProposal = async (params, imageUrl, prompt) => {
    const result = await falSubscribe(VISION_ENDPOINT, {
      model: params.model,
      prompt,
      image_urls: [imageUrl],
      max_tokens: 700,
    }, params.apiKey);
    return extractObjectPayload(unwrapFalData(result));
  };

  const visionHandlers = {
    indexAsset: async (paramsValue) => {
      const params = validateIndexParams(paramsValue);
      if (params.framePaths.length === 0) {
        return {
          assetId: params.assetId,
          status: 'missing',
          model: params.model,
          error: 'No visual frames were available to upload for analysis.',
        };
      }
      const imageUrls = await Promise.all(params.framePaths.slice(0, 6).map((framePath, index) => (
        stageMedia(framePath, params.apiKey, `Vision frame ${index + 1}`)
      )));
      const result = await falSubscribe(VISION_ENDPOINT, {
        model: params.model,
        prompt: [
          `Analyze these frames from asset "${params.assetName}" for editorial planning.`,
          'Return compact JSON only with this shape:',
          '{"summary":"...","tone":["..."],"pacing":"...","shotTypes":["..."],"subjects":["..."],"brollIdeas":["..."],"confidence":0.82}',
          'Focus on emotional tone, coverage value, pacing feel, character presence, likely shot type, and practical b-roll opportunities.',
        ].join('\n'),
        image_urls: imageUrls,
        max_tokens: 450,
      }, params.apiKey);
      const jsonText = extractJsonText(providerText(result));
      if (!jsonText) {
        return {
          assetId: params.assetId,
          status: 'failed',
          model: params.model,
          error: 'Vision analysis did not return valid JSON.',
        };
      }
      try {
        const parsed = JSON.parse(jsonText);
        if (!isPlainRecord(parsed)) throw new Error('Expected an object.');
        return {
          assetId: params.assetId,
          status: 'ready',
          summary: providerFieldText(parsed.summary),
          tone: stringArray(parsed.tone),
          pacing: providerFieldText(parsed.pacing, 20_000),
          shotTypes: stringArray(parsed.shotTypes),
          subjects: stringArray(parsed.subjects),
          brollIdeas: stringArray(parsed.brollIdeas),
          confidence: typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
            ? parsed.confidence
            : undefined,
          updatedAt: new Date().toISOString(),
          model: params.model,
          sourceFrameCount: imageUrls.length,
        };
      } catch {
        return {
          assetId: params.assetId,
          status: 'failed',
          model: params.model,
          error: 'Vision analysis JSON parse failed.',
        };
      }
    },

    detectObjects: async (paramsValue) => {
      const params = validateDetectParams(paramsValue);
      let imageUrl;
      try {
        imageUrl = await stageMedia(params.imagePath, params.apiKey, 'Detection image');
      } catch (error) {
        if (error?.code === 'MEDIA_NOT_FOUND') {
          return {
            status: 'missing',
            model: params.model,
            objects: [],
            error: 'No image was available to upload for auto segmentation.',
          };
        }
        throw error;
      }
      const primaryPrompt = [
        'You are preparing object proposals for a promptable segmentation model.',
        params.context ? `Context: ${params.context}` : null,
        'Return compact JSON only with this shape: {"objects":[{"label":"person","box":[0.52,0.48,0.28,0.7],"score":0.96,"priority":0.99}]}',
        'Each object must include a normalized box in [center_x, center_y, width, height] with values between 0 and 1.',
        `List up to ${params.maxObjects} distinct, mask-worthy objects.`,
        'Prefer people, faces, pets, products, props, vehicles, furniture, signs, devices, and other clearly isolated subjects.',
        'Include partially visible or cropped people, cars, trucks, bikes, and handheld objects if they are recognizably present.',
        'Do not return an empty list unless there are truly no identifiable objects in the frame.',
      ].filter(Boolean).join('\n');
      const retryPrompt = [
        'Retry object proposal extraction for image segmentation.',
        params.context ? `Context: ${params.context}` : null,
        'Be less selective. Return the most salient visible objects even if they are partially cropped, small, or overlapping.',
        'Return strict JSON only: {"objects":[{"label":"car","box":[0.5,0.5,0.4,0.3],"score":0.81,"priority":0.8}]}',
        `Return between 1 and ${params.maxObjects} objects whenever any recognizable object exists.`,
      ].filter(Boolean).join('\n');
      try {
        const primary = await runObjectProposal(params, imageUrl, primaryPrompt);
        const primaryObjects = primary ? normalizeDetectedObjects(primary, params.maxObjects) : [];
        if (primaryObjects.length > 0) {
          return { status: 'ready', model: params.model, objects: primaryObjects };
        }
        const retry = await runObjectProposal(params, imageUrl, retryPrompt);
        const retryObjects = retry ? normalizeDetectedObjects(retry, params.maxObjects) : [];
        return { status: 'ready', model: params.model, objects: retryObjects };
      } catch (error) {
        return {
          status: 'failed',
          model: params.model,
          objects: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };

  const acousticHandlers = {
    analyzeAsset: async (paramsValue) => {
      const params = validateAcousticParams(paramsValue);
      const base = {
        assetId: params.assetId,
        status: 'failed',
        version: ACOUSTIC_ANALYSIS_VERSION,
        model: VIDEO_ENDPOINT,
        silenceMap: [],
        segments: [],
        hasSpeech: params.transcript.length > 0,
        sourceDurationSec: params.durationSec,
      };
      try {
        const apiKey = requireSecret(params.apiKey, 'fal.ai API key');
        let silenceMap = [];
        let silenceWarning;
        if (isWebMediaReference(params.mediaPath)) {
          const localMedia = await resolveWebMediaPath(params.mediaPath, {
            dataRoot: options.dataRoot,
            label: 'Acoustic media source',
          });
          const silenceResult = await invokeSilenceDetector(silenceDetector, localMedia.diskPath);
          if (silenceResult.available) {
            silenceMap = parseSilenceDetect(silenceResult.stderr);
            if (silenceMap.length === 0) silenceWarning = 'Silence detection returned no intervals.';
          } else {
            silenceWarning = 'Server ffmpeg silence detection is unavailable; multimodal descriptors were still generated.';
          }
        } else {
          silenceWarning = 'Silence detection is unavailable for remote media in the web service.';
        }
        const mediaUrl = await stageMedia(params.mediaPath, apiKey, 'Acoustic media source');
        const rawText = await analyzeVideoUrl(
          mediaUrl,
          buildAcousticPrompt({ assetName: params.assetName, transcript: params.transcript }),
          apiKey,
        );
        return {
          ...base,
          status: 'ready',
          updatedAt: new Date().toISOString(),
          silenceMap,
          segments: normalizeAcousticSegments(rawText),
          error: silenceWarning,
        };
      } catch (error) {
        return {
          ...base,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };

  const copilotHandlers = {
    analyzeVisualRefs: async (paramsValue) => {
      const params = validateCopilotParams(paramsValue);
      const results = [];
      for (const ref of params.visualRefs) {
        let mediaType = ref.mediaType;
        let mediaUrl;
        try {
          mediaUrl = await stageMedia(ref.fileRef, params.apiKey, `Visual reference "${ref.label}"`);
        } catch (error) {
          if (error?.code !== 'MEDIA_NOT_FOUND' || ref.framePaths.length === 0) throw error;
          let frameError = error;
          for (let index = 0; index < ref.framePaths.length; index += 1) {
            try {
              mediaUrl = await stageMedia(
                ref.framePaths[index],
                params.apiKey,
                `Visual reference "${ref.label}" frame ${index + 1}`,
              );
              mediaType = 'image';
              break;
            } catch (candidateError) {
              frameError = candidateError;
            }
          }
          if (!mediaUrl) throw frameError;
        }
        const analysisPrompt = buildCopilotPrompt(params.prompt, ref, mediaType);
        const analysis = mediaType === 'video'
          ? await analyzeVideoUrl(mediaUrl, analysisPrompt, params.apiKey)
          : await analyzeImageUrl(mediaUrl, analysisPrompt, params.apiKey);
        results.push({ label: ref.label, mediaType, analysis });
      }
      if (results.length === 0) {
        throw new ServiceError('Could not load the attached clip or asset files for visual analysis.', {
          code: 'MEDIA_NOT_FOUND',
          statusCode: 404,
        });
      }
      return results;
    },
  };

  return { visionHandlers, acousticHandlers, copilotHandlers };
}

export function createVisionHandlers(options = {}) {
  return createVisionServices(options).visionHandlers;
}

export function createAcousticHandlers(options = {}) {
  return createVisionServices(options).acousticHandlers;
}

export function createCopilotHandlers(options = {}) {
  return createVisionServices(options).copilotHandlers;
}

const defaultServices = createVisionServices();
export const visionHandlers = defaultServices.visionHandlers;
export const acousticHandlers = defaultServices.acousticHandlers;
export const copilotHandlers = defaultServices.copilotHandlers;
