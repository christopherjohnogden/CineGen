import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getRunpodLtx25Status,
  runRunpodLtx25Job,
  runRunpodSessionImageJob,
  setupRunpodLtx25,
  terminateRunpodLtx25,
} from '../../../src/lib/runpod/ltx25-service.mjs';
import {
  ServiceError,
  isWebMediaReference,
  requireRecord,
  resolveWebMediaPath,
  validatePublicUrl,
} from './_shared.mjs';

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_DATA_ROOT = path.join(WEB_ROOT, '.data');
const MAX_REFERENCE_BYTES = 14 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_GENERATED_IMAGE_BYTES = 100 * 1024 * 1024;
const REFERENCE_TIMEOUT_MS = 45_000;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function invalidMedia(message, code = 'INVALID_MEDIA') {
  return new ServiceError(message, { code, statusCode: 422 });
}

function decodeBase64(value, label, maxBytes) {
  const compact = String(value).replace(/\s+/g, '');
  if (!compact || compact.length > Math.ceil(maxBytes / 3) * 4 + 8) {
    throw invalidMedia(`${label} is empty or too large.`, 'MEDIA_TOO_LARGE');
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 === 1) {
    throw invalidMedia(`${label} is not valid base64.`);
  }
  const bytes = Buffer.from(compact, 'base64');
  if (!bytes.length || bytes.length > maxBytes) {
    throw invalidMedia(`${label} is empty or too large.`, 'MEDIA_TOO_LARGE');
  }
  return bytes;
}

function imageType(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (bytes.length >= 2 && bytes.subarray(0, 2).toString('ascii') === 'BM') return 'image/bmp';
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp' && /^(avif|avis)$/.test(bytes.subarray(8, 12).toString('ascii'))) return 'image/avif';
  return undefined;
}

function imageDataUri(bytes, label) {
  if (bytes.length > MAX_REFERENCE_BYTES) {
    throw invalidMedia(`${label} is larger than 14 MB.`, 'MEDIA_TOO_LARGE');
  }
  const mediaType = imageType(bytes);
  if (!mediaType) throw invalidMedia(`${label} is not a supported image.`);
  return `data:${mediaType};base64,${bytes.toString('base64')}`;
}

function localMediaReference(value) {
  if (isWebMediaReference(value)) return value;
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (!LOOPBACK_HOSTS.has(url.hostname) || !url.pathname.startsWith('/media/')) return undefined;
    return url.pathname;
  } catch {
    return undefined;
  }
}

async function readLimitedResponse(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw invalidMedia('The reference image is larger than 14 MB.', 'MEDIA_TOO_LARGE');
  }
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw invalidMedia('The reference image is larger than 14 MB.', 'MEDIA_TOO_LARGE');
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw invalidMedia('The reference image is larger than 14 MB.', 'MEDIA_TOO_LARGE');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}

async function referenceToDataUri(value, options) {
  if (typeof value !== 'string' || !value.trim()) throw invalidMedia('The LTX-2.5 reference image is invalid.');
  const source = value.trim();
  if (source.startsWith('data:')) {
    const match = /^data:image\/[A-Za-z0-9.+-]+;base64,([\s\S]+)$/i.exec(source);
    if (!match) throw invalidMedia('The LTX-2.5 reference image data is invalid.');
    return imageDataUri(decodeBase64(match[1], 'The reference image', MAX_REFERENCE_BYTES), 'The reference image');
  }

  const localReference = localMediaReference(source);
  if (localReference) {
    const resolved = await resolveWebMediaPath(localReference, {
      dataRoot: options.dataRoot,
      label: 'LTX-2.5 reference image',
    });
    if (resolved.size > MAX_REFERENCE_BYTES) {
      throw invalidMedia('The reference image is larger than 14 MB.', 'MEDIA_TOO_LARGE');
    }
    return imageDataUri(await fs.readFile(resolved.diskPath), 'The reference image');
  }

  const url = validatePublicUrl(source, 'LTX-2.5 reference image');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.referenceTimeoutMs);
  try {
    const response = await options.fetchImpl(url, {
      headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.8' },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ServiceError(`CineGen could not download the LTX-2.5 reference image (${response.status}).`, {
        code: 'REFERENCE_UNAVAILABLE',
        statusCode: 502,
      });
    }
    return imageDataUri(await readLimitedResponse(response, MAX_REFERENCE_BYTES), 'The reference image');
  } catch (cause) {
    if (cause instanceof ServiceError) throw cause;
    throw new ServiceError('CineGen could not download the LTX-2.5 reference image.', {
      code: 'REFERENCE_UNAVAILABLE',
      statusCode: 502,
      cause,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function sessionImageReferenceToDataUri(value, options, index) {
  const dataUri = await referenceToDataUri(value, options);
  if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(dataUri)) {
    throw invalidMedia(`RunPod reference image ${index + 1} must be a PNG, JPEG, or WebP image.`);
  }
  return dataUri;
}

async function prepareSessionImageInput(value, options) {
  const input = requireRecord(value, 'RunPod session image generation input');
  const references = Array.isArray(input.referenceImages)
    ? input.referenceImages.filter((entry) => typeof entry === 'string' && entry.trim())
    : [];
  if (references.length > 3) {
    throw invalidMedia('RunPod session image jobs support up to three reference images.');
  }
  return {
    ...input,
    referenceImages: await Promise.all(references.map((reference, index) => (
      sessionImageReferenceToDataUri(reference.trim(), options, index)
    ))),
  };
}

function videoBytes(output) {
  const raw = typeof output.data === 'string' ? output.data.trim() : '';
  if (!raw) return undefined;
  const match = /^data:video\/[A-Za-z0-9.+-]+;base64,([\s\S]+)$/i.exec(raw);
  return decodeBase64(match?.[1] ?? raw, 'The generated video', MAX_VIDEO_BYTES);
}

function videoExtension(bytes, mediaType) {
  if (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'))) return '.webm';
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp') {
    return mediaType === 'video/quicktime' ? '.mov' : '.mp4';
  }
  throw invalidMedia('LTX-2.5 returned an unsupported video file.', 'INVALID_PROVIDER_RESPONSE');
}

async function persistVideo(output, dataRoot) {
  const bytes = videoBytes(output);
  if (!bytes) return output;
  const extension = videoExtension(bytes, output.mediaType);
  const directory = path.resolve(dataRoot, 'media', 'generated', 'ltx25');
  await fs.mkdir(directory, { recursive: true });
  const fileName = `${crypto.randomUUID()}${extension}`;
  const destination = path.join(directory, fileName);
  const temporary = path.join(directory, `.${fileName}.${process.pid}.tmp`);
  try {
    await fs.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, destination);
  } catch (cause) {
    await fs.unlink(temporary).catch(() => {});
    throw new ServiceError('CineGen could not save the generated LTX-2.5 video.', {
      code: 'MEDIA_WRITE_FAILED',
      statusCode: 500,
      cause,
    });
  }
  return {
    url: `/media/generated/ltx25/${encodeURIComponent(fileName)}`,
    durationSec: output.durationSec,
    model: output.model,
  };
}

function generatedImageBytes(output) {
  const raw = typeof output.data === 'string' ? output.data.trim() : '';
  if (!raw) return undefined;
  const match = /^data:image\/[A-Za-z0-9.+-]+;base64,([\s\S]+)$/i.exec(raw);
  return decodeBase64(match?.[1] ?? raw, 'The generated image', MAX_GENERATED_IMAGE_BYTES);
}

function generatedImageFileType(bytes) {
  const mediaType = imageType(bytes);
  if (mediaType === 'image/png') return { extension: '.png', mediaType };
  if (mediaType === 'image/jpeg') return { extension: '.jpg', mediaType };
  if (mediaType === 'image/webp') return { extension: '.webp', mediaType };
  throw invalidMedia('RunPod returned an unsupported image file.', 'INVALID_PROVIDER_RESPONSE');
}

async function persistSessionImage(output, dataRoot) {
  const bytes = generatedImageBytes(output);
  if (!bytes) return output;
  const { extension, mediaType } = generatedImageFileType(bytes);
  const directory = path.resolve(dataRoot, 'media', 'generated', 'runpod-images');
  await fs.mkdir(directory, { recursive: true });
  const fileName = `${crypto.randomUUID()}${extension}`;
  const destination = path.join(directory, fileName);
  const temporary = path.join(directory, `.${fileName}.${process.pid}.tmp`);
  try {
    await fs.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, destination);
  } catch (cause) {
    await fs.unlink(temporary).catch(() => {});
    throw new ServiceError('CineGen could not save the generated RunPod image.', {
      code: 'MEDIA_WRITE_FAILED',
      statusCode: 500,
      cause,
    });
  }
  const { data: _data, ...safeOutput } = output;
  return {
    ...safeOutput,
    url: `/media/generated/runpod-images/${encodeURIComponent(fileName)}`,
    mediaType,
  };
}

export function createRunpodLtx25Handlers(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new ServiceError('This Node runtime does not provide fetch.', {
      code: 'SERVER_MISCONFIGURED',
      statusCode: 500,
    });
  }
  const dataRoot = path.resolve(options.dataRoot ?? process.env.CINEGEN_WEB_DATA_ROOT ?? DEFAULT_DATA_ROOT);
  const service = options.runpodLtx25Service ?? options.service ?? {
    setup: setupRunpodLtx25,
    status: getRunpodLtx25Status,
    terminate: terminateRunpodLtx25,
    generate: runRunpodLtx25Job,
    generateSessionImage: runRunpodSessionImageJob,
  };
  const referenceOptions = {
    dataRoot,
    fetchImpl,
    referenceTimeoutMs: options.referenceTimeoutMs ?? REFERENCE_TIMEOUT_MS,
  };

  return {
    setupLtx25: (params) => service.setup(requireRecord(params, 'RunPod LTX-2.5 setup'), fetchImpl),
    statusLtx25: (params) => service.status(requireRecord(params, 'RunPod LTX-2.5 status'), fetchImpl),
    terminateLtx25: (params) => service.terminate(requireRecord(params, 'RunPod LTX-2.5 termination'), fetchImpl),
    generateLtx25: async (paramsValue) => {
      const params = requireRecord(paramsValue, 'RunPod LTX-2.5 generation');
      let prepared = params;
      if (!params.jobId && params.input !== undefined) {
        const input = requireRecord(params.input, 'LTX-2.5 generation input');
        const references = Array.isArray(input.referenceImages)
          ? input.referenceImages.filter((value) => typeof value === 'string' && value.trim()).slice(0, 1)
          : [];
        prepared = {
          ...params,
          input: {
            ...input,
            ...(references.length
              ? { referenceImages: [await referenceToDataUri(references[0], referenceOptions)] }
              : { referenceImages: [] }),
          },
        };
      }
      const result = await service.generate(prepared, fetchImpl);
      if (result?.status !== 'completed' || !result.output?.data) return result;
      return { ...result, output: await persistVideo(result.output, dataRoot) };
    },
    generateSessionImage: async (paramsValue) => {
      const params = requireRecord(paramsValue, 'RunPod session image generation');
      const prepared = !params.jobId && params.input !== undefined
        ? { ...params, input: await prepareSessionImageInput(params.input, referenceOptions) }
        : params;
      const result = await service.generateSessionImage(prepared, fetchImpl);
      if (result?.status !== 'completed' || !result.output?.data) return result;
      return { ...result, output: await persistSessionImage(result.output, dataRoot) };
    },
  };
}
