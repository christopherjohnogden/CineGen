import type { DirectorBreakdownItem, DirectorClip, DirectorShow, DirectorStagingMap } from '@/types/director';
import { generateId } from '@/lib/utils/ids';
import { updateDirectorClip } from './director-state';
import { assignStagingFigures, emptyStagingMap } from './staging-map';
import { stagingBindKey, captureFramingLook, upsertFramingReserve } from './framing-reserve';

function isGeometryTag(tag: string): boolean {
  return /^@(staging|loc|map)[_-]/i.test(tag.startsWith('@') ? tag : `@${tag}`);
}

export function characterTagsForStaging(
  clip: Pick<DirectorClip, 'elementTags'>,
  breakdown: DirectorBreakdownItem[] = [],
): string[] {
  return clip.elementTags.filter((tag) => {
    if (isGeometryTag(tag)) return false;
    const item = breakdown.find((entry) => entry.tag === tag);
    return !item || item.kind === 'character';
  });
}

export function ensureClipStaging(
  clip: DirectorClip,
  sceneLabel: string,
  breakdown: DirectorBreakdownItem[] = [],
  project = 'SHOW',
): DirectorStagingMap {
  const base = clip.staging ?? emptyStagingMap(project, sceneLabel);
  if (base.figures.length > 0) return base;
  return { ...base, figures: assignStagingFigures(characterTagsForStaging(clip, breakdown)) };
}

export function upsertStagingBreakdown(
  show: DirectorShow,
  map: DirectorStagingMap,
  elementId: string,
): DirectorShow {
  const existing = show.breakdown.find((entry) => entry.tag === map.stagingTag);
  if (existing) {
    return {
      ...show,
      breakdown: show.breakdown.map((entry) => (
        entry.tag === map.stagingTag
          ? { ...entry, kind: 'prop', elementId, auto: false }
          : entry
      )),
    };
  }
  const item: DirectorBreakdownItem = {
    id: generateId(),
    kind: 'prop',
    name: map.stagingTag.replace(/^@/, ''),
    tag: map.stagingTag,
    description: 'Staging reference — positions only.',
    elementId,
  };
  return { ...show, breakdown: [...show.breakdown, item] };
}

export function applyStagingToScene(
  show: DirectorShow,
  sceneId: string,
  staging: DirectorStagingMap,
): DirectorShow {
  let next = show;
  for (const clip of show.clips) {
    if (clip.sceneId !== sceneId || clip.altOf) continue;
    next = updateDirectorClip(next, clip.id, (current) => ({
      ...current,
      staging: { ...staging, scope: 'scene' },
    }));
  }
  return next;
}

export function bindStagingDiagram(args: {
  show: DirectorShow;
  clipId: string;
  diagramUrl: string;
  elementId: string;
  assetId?: string;
  jobId?: string;
  scope: 'clip' | 'scene';
  framingName?: string;
}): DirectorShow {
  const clip = args.show.clips.find((entry) => entry.id === args.clipId);
  if (!clip) return args.show;
  const scene = args.show.scenes.find((entry) => entry.id === clip.sceneId);
  const staging: DirectorStagingMap = {
    ...ensureClipStaging(clip, scene?.label ?? 'scene', args.show.breakdown),
    enabled: true,
    diagramUrl: args.diagramUrl,
    elementId: args.elementId,
    assetId: args.assetId,
    jobId: args.jobId,
    status: 'ready',
    error: undefined,
    scope: args.scope,
  };
  let next = upsertStagingBreakdown(args.show, staging, args.elementId);
  const bindKey = staging.sourceBindKey ?? stagingBindKey(clip.activeVariant);
  const look = staging.sourceLook ?? captureFramingLook(clip, bindKey);
  const saved = upsertFramingReserve(next, {
    name: args.framingName?.trim() || 'Framing',
    map: { ...staging, sourceBindKey: bindKey, sourceLook: look },
    sourceClipId: clip.id,
    sourceSceneId: clip.sceneId,
    variantKey: bindKey,
    look,
  });
  const bound: DirectorStagingMap = { ...staging, reserveId: saved.framing.id, sourceBindKey: bindKey, sourceLook: look };
  next = updateDirectorClip(saved.show, args.clipId, (current) => ({
    ...current,
    staging: bound,
    stagingBinds: { ...current.stagingBinds, [bindKey]: saved.framing.id },
  }));
  if (args.scope === 'scene' && clip.sceneId) {
    next = applyStagingToScene(next, clip.sceneId, bound);
  }
  return next;
}

export function patchClipStaging(
  show: DirectorShow,
  clipId: string,
  patch: Partial<DirectorStagingMap>,
  sceneLabel: string,
): DirectorShow {
  return updateDirectorClip(show, clipId, (current) => ({
    ...current,
    staging: { ...ensureClipStaging(current, sceneLabel), ...patch },
  }));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function listedJobId(job: Record<string, unknown>): string | undefined {
  for (const key of ['id', 'job_id', 'jobId'] as const) {
    const value = job[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function listedJobType(job: Record<string, unknown>): string {
  return typeof job.job_type === 'string'
    ? job.job_type
    : (typeof job.job_set_type === 'string' ? job.job_set_type : '');
}

function listedPrompt(job: Record<string, unknown>): string {
  const rawParams = job.params;
  const params = asRecord(rawParams)
    ?? (typeof rawParams === 'string' ? asRecord(safeJson(rawParams)) : undefined);
  const prompt = typeof params?.prompt === 'string'
    ? params.prompt
    : (typeof job.prompt === 'string' ? job.prompt : '');
  return prompt.replace(/\s+/g, ' ').trim();
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

export function isStagingDiagramJobType(type: string): boolean {
  return /nano_banana/i.test(type);
}

export function isStagingDiagramPrompt(prompt: string): boolean {
  return /COMPOSITION-ONLY|LINE DRAWING|staging plan for a film scene/i.test(prompt);
}

/** Prefer the full PNG over the `_min.webp` thumbnail; never the input still. */
export function listedStagingMediaUrl(job: Record<string, unknown>): string | undefined {
  const candidates = [job.result_url, job.url, job.output_url, job.min_result_url];
  for (const value of candidates) {
    if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) continue;
    if (/_min\./i.test(value)) continue;
    return value;
  }
  return typeof job.min_result_url === 'string' && /^https?:\/\//i.test(job.min_result_url)
    ? job.min_result_url
    : undefined;
}

function isCompletedJob(job: Record<string, unknown>): boolean {
  return /^(completed|success|done|succeeded)$/i.test(String(job.status ?? job.state ?? ''));
}

function jobMatchesId(job: Record<string, unknown>, jobId: string): boolean {
  return [job.id, job.job_id, job.jobId, job.job_set_id, job.parent_id].includes(jobId);
}

/** Pick the Higgsfield list row for a blocking-map job (Nano Banana Pro lists as nano_banana_pro). */
export function matchListedStagingJob(
  jobs: Array<Record<string, unknown>>,
  opts: { jobId?: string } = {},
): Record<string, unknown> | undefined {
  const completed = jobs.filter((job) => isCompletedJob(job) && listedStagingMediaUrl(job));
  if (opts.jobId) {
    const hit = completed.find((job) => jobMatchesId(job, opts.jobId!));
    if (hit) return hit;
  }
  return completed.find((job) => (
    isStagingDiagramJobType(listedJobType(job)) && isStagingDiagramPrompt(listedPrompt(job))
  ));
}

export function listedStagingJobId(job: Record<string, unknown>): string | undefined {
  return listedJobId(job);
}
