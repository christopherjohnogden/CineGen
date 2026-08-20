import { describe, expect, it } from 'vitest';
import { matchListedJobToTake } from '@/lib/director/rejoin-takes';

describe('matchListedJobToTake', () => {
  const take = {
    modelId: 'seedance_2_5',
    createdAt: '2026-08-20T05:00:34.000Z',
    promptSnapshot: 'Naturalistic late-afternoon psychological drama in a small green-walled office.',
  };

  it('matches a Seedance job by prompt and model', () => {
    expect(matchListedJobToTake([
      {
        id: 'job-1',
        job_type: 'seedance_2_5',
        created_at: '2026-08-20T05:00:34.268956Z',
        params: { prompt: `${take.promptSnapshot}\n\nELEMENTS — @Peter` },
      },
    ], take)).toBe('job-1');
  });

  it('matches job_id when list rows omit id', () => {
    expect(matchListedJobToTake([
      {
        job_id: '54a6e548-2a69-4073-80a0-bbce1641a7e9',
        job_type: 'seedance_2_5',
        created_at: take.createdAt,
        params: { prompt: take.promptSnapshot },
      },
    ], take)).toBe('54a6e548-2a69-4073-80a0-bbce1641a7e9');
  });

  it('falls back to the nearest same-model job within 30 minutes', () => {
    expect(matchListedJobToTake([
      {
        id: 'job-near',
        job_type: 'seedance_2_5',
        created_at: '2026-08-20T05:08:00.000Z',
      },
    ], { ...take, promptSnapshot: 'A completely different compiled prompt' })).toBe('job-near');
  });

  it('ignores jobs from a different model', () => {
    expect(matchListedJobToTake([
      {
        id: 'job-2',
        job_type: 'kling_3',
        created_at: take.createdAt,
        params: { prompt: take.promptSnapshot },
      },
    ], take)).toBeUndefined();
  });
});
