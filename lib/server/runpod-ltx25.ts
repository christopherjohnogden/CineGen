import {
  RunpodLtx25Error,
  getRunpodLtx25Status,
  runRunpodLtx25Job,
  runRunpodSessionImageJob,
  setupRunpodLtx25,
  terminateRunpodLtx25,
  type Ltx25GpuProfile,
  type Ltx25VideoInput,
  type RunpodSessionImageInput,
  type RunpodSessionImageModel,
} from "@/lib/runpod/ltx25-service";
import {
  SiteHttpError,
  contentTypeForName,
  encodeMediaPath,
  mediaPathFromReference,
  requireRecord,
} from "./common";

const MAX_REFERENCE_BYTES = 14 * 1024 * 1024;
const MAX_VIDEO_BYTES = 90 * 1024 * 1024;
const MAX_GENERATED_IMAGE_BYTES = 100 * 1024 * 1024;
const REFERENCE_TIMEOUT_MS = 45_000;

type RuntimeEnv = { MEDIA: R2Bucket };

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const encoded = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  if (!encoded || encoded.length > Math.ceil(MAX_VIDEO_BYTES / 3) * 4 + 8) {
    throw new SiteHttpError(413, "The generated LTX-2.5 video is larger than the hosted app can save automatically.", "MEDIA_TOO_LARGE");
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
    throw new SiteHttpError(502, "LTX-2.5 returned an invalid video file.", "INVALID_PROVIDER_RESPONSE");
  }
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function imageType(bytes: Uint8Array): string | undefined {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length >= 8 && bytes.subarray(0, 8).every((value, index) => value === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index])) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(ascii(0, 6))) return "image/gif";
  if (bytes.length >= 2 && ascii(0, 2) === "BM") return "image/bmp";
  if (bytes.length >= 12 && ascii(4, 8) === "ftyp" && /^(avif|avis)$/.test(ascii(8, 12))) return "image/avif";
  return undefined;
}

function imageDataUri(bytes: Uint8Array): string {
  const mime = imageType(bytes);
  if (!mime) throw new SiteHttpError(422, "LTX-2.5 requires a supported raster image as its first-frame Element.", "INVALID_REFERENCE");
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

function publicHttpsUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch {
    throw new SiteHttpError(400, "The LTX-2.5 first-frame Element is invalid.", "INVALID_REFERENCE");
  }
  const host = url.hostname.toLowerCase();
  const isIpLiteral = /^\d+(?:\.\d+){3}$/.test(host) || host.includes(":");
  if (url.protocol !== "https:" || url.username || url.password || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || isIpLiteral) {
    throw new SiteHttpError(400, "The LTX-2.5 first-frame Element must use a public HTTPS URL.", "INVALID_REFERENCE");
  }
  return url;
}

async function readLimitedImage(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_REFERENCE_BYTES) {
    throw new SiteHttpError(413, "The LTX-2.5 first-frame Element must be under 14 MB.", "REFERENCE_TOO_LARGE");
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_REFERENCE_BYTES) {
      throw new SiteHttpError(413, "The LTX-2.5 first-frame Element must be under 14 MB.", "REFERENCE_TOO_LARGE");
    }
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_REFERENCE_BYTES) {
        await reader.cancel();
        throw new SiteHttpError(413, "The LTX-2.5 first-frame Element must be under 14 MB.", "REFERENCE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function asSiteError(error: unknown): never {
  if (error instanceof SiteHttpError) throw error;
  if (error instanceof RunpodLtx25Error) {
    throw new SiteHttpError(error.statusCode, error.message, error.code);
  }
  throw error;
}

export function hostedMediaPath(value: string, siteOrigin: string): string | undefined {
  const source = value.trim();
  if (source.startsWith("/media/")) return mediaPathFromReference(source);
  let url: URL;
  try { url = new URL(source); } catch { return undefined; }
  if (url.origin !== siteOrigin || !url.pathname.startsWith("/media/")) return undefined;
  return mediaPathFromReference(source);
}

async function mediaReference(
  value: string,
  env: RuntimeEnv,
  workspaceId: string,
  siteOrigin: string,
): Promise<string> {
  if (value.startsWith("data:image/")) return value;
  const storedPath = hostedMediaPath(value, siteOrigin);
  if (storedPath !== undefined) {
    const path = storedPath;
    const object = await env.MEDIA.get(`workspaces/${workspaceId}/${path}`);
    if (!object) throw new SiteHttpError(404, "The LTX-2.5 first-frame Element could not be found.", "MEDIA_NOT_FOUND");
    if (object.size > MAX_REFERENCE_BYTES) {
      throw new SiteHttpError(413, "The LTX-2.5 first-frame Element must be under 14 MB.", "REFERENCE_TOO_LARGE");
    }
    const declaredMime = object.httpMetadata?.contentType || contentTypeForName(path);
    if (!declaredMime.startsWith("image/")) {
      throw new SiteHttpError(422, "LTX-2.5 requires an image as its first-frame Element.", "INVALID_REFERENCE");
    }
    return imageDataUri(new Uint8Array(await object.arrayBuffer()));
  }
  const url = publicHttpsUrl(value);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REFERENCE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { redirect: "error", signal: controller.signal });
    if (!response.ok) throw new SiteHttpError(502, "CineGen could not download the LTX-2.5 first-frame Element.", "REFERENCE_UNAVAILABLE");
    return imageDataUri(await readLimitedImage(response));
  } catch (error) {
    if (error instanceof SiteHttpError) throw error;
    throw new SiteHttpError(502, "CineGen could not download the LTX-2.5 first-frame Element.", "REFERENCE_UNAVAILABLE");
  } finally {
    clearTimeout(timeout);
  }
}

function sessionImageDataUri(value: string, index: number): string {
  const match = /^data:image\/[A-Za-z0-9.+-]+;base64,([\s\S]+)$/i.exec(value.trim());
  const encoded = match?.[1]?.replace(/\s+/g, "") ?? "";
  if (
    !encoded
    || encoded.length > Math.ceil(MAX_REFERENCE_BYTES / 3) * 4 + 8
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
    || encoded.length % 4 === 1
  ) {
    throw new SiteHttpError(422, `RunPod reference image ${index + 1} is invalid or larger than 14 MB.`, "INVALID_REFERENCE");
  }
  let binary: string;
  try { binary = atob(encoded); } catch {
    throw new SiteHttpError(422, `RunPod reference image ${index + 1} is invalid.`, "INVALID_REFERENCE");
  }
  if (!binary.length || binary.length > MAX_REFERENCE_BYTES) {
    throw new SiteHttpError(413, `RunPod reference image ${index + 1} must be under 14 MB.`, "REFERENCE_TOO_LARGE");
  }
  const bytes = new Uint8Array(binary.length);
  for (let offset = 0; offset < binary.length; offset += 1) bytes[offset] = binary.charCodeAt(offset);
  const mediaType = imageType(bytes);
  if (mediaType !== "image/png" && mediaType !== "image/jpeg" && mediaType !== "image/webp") {
    throw new SiteHttpError(422, `RunPod reference image ${index + 1} must be a PNG, JPEG, or WebP image.`, "INVALID_REFERENCE");
  }
  return `data:${mediaType};base64,${bytesToBase64(bytes)}`;
}

async function prepareSessionImageInput(
  value: unknown,
  env: RuntimeEnv,
  workspaceId: string,
  siteOrigin: string,
): Promise<RunpodSessionImageInput> {
  const input = requireRecord(value, "RunPod session image generation input");
  const references = Array.isArray(input.referenceImages)
    ? input.referenceImages.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
    : [];
  if (references.length > 3) {
    throw new SiteHttpError(422, "RunPod session image jobs support up to three reference images.", "INVALID_REFERENCE_COUNT");
  }
  const model = input.model === "sdxl" || input.model === "qwen-image-edit"
    ? input.model
    : input.model as RunpodSessionImageModel;
  const optionalNumber = (entry: unknown): number | undefined => {
    if (entry === undefined || entry === null || entry === "") return undefined;
    const parsed = Number(entry);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const negativePrompt = typeof input.negativePrompt === "string" ? input.negativePrompt : undefined;
  const preparedReferences = await Promise.all(references.map(async (reference, index) => (
    sessionImageDataUri(await mediaReference(reference.trim(), env, workspaceId, siteOrigin), index)
  )));
  return {
    model,
    prompt: typeof input.prompt === "string" ? input.prompt : "",
    ...(negativePrompt !== undefined ? { negativePrompt } : {}),
    ...(optionalNumber(input.width) !== undefined ? { width: optionalNumber(input.width) } : {}),
    ...(optionalNumber(input.height) !== undefined ? { height: optionalNumber(input.height) } : {}),
    ...(optionalNumber(input.steps) !== undefined ? { steps: optionalNumber(input.steps) } : {}),
    ...(optionalNumber(input.guidanceScale) !== undefined ? { guidanceScale: optionalNumber(input.guidanceScale) } : {}),
    ...(optionalNumber(input.seed) !== undefined ? { seed: optionalNumber(input.seed) } : {}),
    ...(preparedReferences.length ? { referenceImages: preparedReferences } : {}),
  };
}

async function prepareInput(
  value: unknown,
  env: RuntimeEnv,
  workspaceId: string,
  siteOrigin: string,
): Promise<Ltx25VideoInput> {
  const input = requireRecord(value, "LTX-2.5 generation input");
  const references = Array.isArray(input.referenceImages)
    ? input.referenceImages.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())).slice(0, 1)
    : [];
  return {
    prompt: typeof input.prompt === "string" ? input.prompt : "",
    durationSec: Number(input.durationSec),
    aspectRatio: typeof input.aspectRatio === "string" ? input.aspectRatio : undefined,
    resolution: typeof input.resolution === "string" ? input.resolution : undefined,
    generateAudio: input.generateAudio !== false,
    referenceImages: references.length ? [await mediaReference(references[0], env, workspaceId, siteOrigin)] : undefined,
  };
}

async function persistCompletedVideo(
  result: Awaited<ReturnType<typeof runRunpodLtx25Job>>,
  env: RuntimeEnv,
  workspaceId: string,
) {
  const output = result.output;
  const encoded = output?.data;
  if (!encoded) return result;
  const bytes = base64ToBytes(encoded);
  if (bytes.byteLength > MAX_VIDEO_BYTES) {
    throw new SiteHttpError(413, "The generated LTX-2.5 video is larger than the hosted app can save automatically.", "MEDIA_TOO_LARGE");
  }
  const isWebm = bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  const isMp4 = bytes.length >= 12 && String.fromCharCode(...bytes.subarray(4, 8)) === "ftyp";
  if (!isWebm && !isMp4) {
    throw new SiteHttpError(502, "LTX-2.5 returned an unsupported video file.", "INVALID_PROVIDER_RESPONSE");
  }
  const extension = isWebm ? "webm" : "mp4";
  const path = `generated/runpod-ltx25/${result.jobId}.${extension}`;
  const mediaType = isWebm ? "video/webm" : "video/mp4";
  await env.MEDIA.put(`workspaces/${workspaceId}/${path}`, bytes, {
    httpMetadata: { contentType: mediaType },
    customMetadata: { provider: "runpod", model: "LTX-2.5", jobId: result.jobId },
  });
  return {
    ...result,
    output: {
      ...result.output,
      url: `/media/${encodeMediaPath(path)}`,
      mediaType,
      data: undefined,
    },
  };
}

function generatedImageBytes(value: string): Uint8Array {
  const raw = value.trim();
  const match = /^data:image\/[A-Za-z0-9.+-]+;base64,([\s\S]+)$/i.exec(raw);
  const encoded = (match?.[1] ?? raw).replace(/\s+/g, "");
  if (
    !encoded
    || encoded.length > Math.ceil(MAX_GENERATED_IMAGE_BYTES / 3) * 4 + 8
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
    || encoded.length % 4 === 1
  ) {
    throw new SiteHttpError(502, "RunPod returned an invalid or oversized image file.", "INVALID_PROVIDER_RESPONSE");
  }
  let binary: string;
  try { binary = atob(encoded); } catch {
    throw new SiteHttpError(502, "RunPod returned an invalid image file.", "INVALID_PROVIDER_RESPONSE");
  }
  if (!binary.length || binary.length > MAX_GENERATED_IMAGE_BYTES) {
    throw new SiteHttpError(413, "The generated RunPod image is too large to save.", "MEDIA_TOO_LARGE");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function persistCompletedSessionImage(
  result: Awaited<ReturnType<typeof runRunpodSessionImageJob>>,
  env: RuntimeEnv,
  workspaceId: string,
) {
  const output = result.output;
  const encoded = output?.data;
  if (!encoded) return result;
  const bytes = generatedImageBytes(encoded);
  const mediaType = imageType(bytes);
  const extension = mediaType === "image/png"
    ? "png"
    : mediaType === "image/jpeg"
      ? "jpg"
      : mediaType === "image/webp"
        ? "webp"
        : undefined;
  if (!extension || !mediaType) {
    throw new SiteHttpError(502, "RunPod returned an unsupported image file.", "INVALID_PROVIDER_RESPONSE");
  }
  const path = `generated/runpod-session-images/${result.jobId}.${extension}`;
  await env.MEDIA.put(`workspaces/${workspaceId}/${path}`, bytes, {
    httpMetadata: { contentType: mediaType },
    customMetadata: { provider: "runpod", model: output.model, jobId: result.jobId },
  });
  const safeOutput = { ...output };
  delete safeOutput.data;
  return {
    ...result,
    output: {
      ...safeOutput,
      url: `/media/${encodeMediaPath(path)}`,
      mediaType,
    },
  };
}

export function createRunpodLtx25(env: RuntimeEnv, workspaceId: string, siteOrigin: string) {
  return {
    async setup(value: unknown) {
      try {
        const params = requireRecord(value, "LTX-2.5 setup parameters");
        return await setupRunpodLtx25({
          runpodKey: typeof params.runpodKey === "string" ? params.runpodKey : "",
          huggingFaceToken: typeof params.huggingFaceToken === "string" ? params.huggingFaceToken : "",
          gpuProfile: typeof params.gpuProfile === "string" ? params.gpuProfile as Ltx25GpuProfile : undefined,
          imageModels: Array.isArray(params.imageModels)
            ? params.imageModels.filter((model): model is RunpodSessionImageModel => model === "sdxl" || model === "qwen-image-edit")
            : undefined,
        });
      } catch (error) { asSiteError(error); }
    },
    async status(value: unknown) {
      try {
        const params = requireRecord(value, "LTX-2.5 status parameters");
        return await getRunpodLtx25Status({
          runpodKey: typeof params.runpodKey === "string" ? params.runpodKey : "",
          podId: typeof params.podId === "string" ? params.podId : "",
          podUrl: typeof params.podUrl === "string" ? params.podUrl : "",
          podAuthToken: typeof params.podAuthToken === "string" ? params.podAuthToken : "",
          secretIds: Array.isArray(params.secretIds) ? params.secretIds.filter((id): id is string => typeof id === "string") : [],
        });
      } catch (error) { asSiteError(error); }
    },
    async terminate(value: unknown) {
      try {
        const params = requireRecord(value, "LTX-2.5 termination parameters");
        return await terminateRunpodLtx25({
          runpodKey: typeof params.runpodKey === "string" ? params.runpodKey : "",
          podId: typeof params.podId === "string" ? params.podId : "",
          secretIds: Array.isArray(params.secretIds) ? params.secretIds.filter((id): id is string => typeof id === "string") : [],
        });
      } catch (error) { asSiteError(error); }
    },
    async generate(value: unknown) {
      try {
        const params = requireRecord(value, "LTX-2.5 generation parameters");
        const result = await runRunpodLtx25Job({
          podId: typeof params.podId === "string" ? params.podId : "",
          podUrl: typeof params.podUrl === "string" ? params.podUrl : "",
          podAuthToken: typeof params.podAuthToken === "string" ? params.podAuthToken : "",
          jobId: typeof params.jobId === "string" ? params.jobId : undefined,
          input: params.input ? await prepareInput(params.input, env, workspaceId, siteOrigin) : undefined,
        });
        return await persistCompletedVideo(result, env, workspaceId);
      } catch (error) { asSiteError(error); }
    },
    async generateSessionImage(value: unknown) {
      try {
        const params = requireRecord(value, "RunPod session image generation parameters");
        const result = await runRunpodSessionImageJob({
          podId: typeof params.podId === "string" ? params.podId : "",
          podUrl: typeof params.podUrl === "string" ? params.podUrl : "",
          podAuthToken: typeof params.podAuthToken === "string" ? params.podAuthToken : "",
          model: params.model === "sdxl" || params.model === "qwen-image-edit"
            ? params.model
            : undefined,
          jobId: typeof params.jobId === "string" ? params.jobId : undefined,
          input: params.input && typeof params.jobId !== "string"
            ? await prepareSessionImageInput(params.input, env, workspaceId, siteOrigin)
            : undefined,
        });
        return await persistCompletedSessionImage(result, env, workspaceId);
      } catch (error) { asSiteError(error); }
    },
  };
}
