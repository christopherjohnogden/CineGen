import type { DirectorTake } from '@/types/director';

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

function createdDeltaMs(job: Record<string, unknown>, takeTime: number): number {
  const created = Date.parse(typeof job.created_at === 'string' ? job.created_at : '');
  return Number.isFinite(takeTime) && Number.isFinite(created)
    ? Math.abs(created - takeTime)
    : Number.POSITIVE_INFINITY;
}

/** Pick the Higgsfield list row that belongs to this in-flight take. */
export function matchListedJobToTake(
  jobs: Array<Record<string, unknown>>,
  take: Pick<DirectorTake, 'modelId' | 'createdAt' | 'promptSnapshot' | 'jobId'>,
): string | undefined {
  const needle = take.promptSnapshot.replace(/\s+/g, ' ').trim().slice(0, 80);
  const takeTime = Date.parse(take.createdAt);
  const sameModel = jobs.flatMap((job) => {
    const id = listedJobId(job);
    if (!id) return [];
    const jobType = listedJobType(job);
    if (jobType && jobType !== take.modelId) return [];
    return [{ job, id, delta: createdDeltaMs(job, takeTime) }];
  }).sort((a, b) => a.delta - b.delta);

  if (needle) {
    const ranked = sameModel.filter(({ job }) => {
      const prompt = listedPrompt(job);
      return prompt.startsWith(needle) || needle.startsWith(prompt.slice(0, 80));
    });
    if (ranked[0]) return ranked[0].id;
  }

  const nearby = sameModel.filter((entry) => entry.delta <= 30 * 60 * 1000);
  return nearby[0]?.id;
}
