import { beforeEach, describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import {
  clipComments,
  clipFileName,
  clipReview,
  formatClipTime,
  generationStatus,
  isNewClip,
  readFeedView,
  readSeen,
  writeFeedView,
  writeSeen,
} from '@/lib/studio/clips';
import type { ModelDefinition, WorkflowNodeData } from '@/types/workflow';

function node(config: Record<string, unknown> = {}, result?: Record<string, unknown>): Node<WorkflowNodeData> {
  return {
    id: 'n1',
    type: 'video-one',
    position: { x: 0, y: 0 },
    data: { type: 'video-one', label: 'Video', config, ...(result ? { result } : {}) } as unknown as WorkflowNodeData,
  };
}

describe('generationStatus', () => {
  it('reports the in-flight stages only from honest signals', () => {
    expect(generationStatus(node({}, { status: 'running', progressStage: 'queued' }), false, 0)).toBe('queued');
    expect(generationStatus(node({}, { status: 'running', progressStage: 'rendering' }), false, 0)).toBe('running');
    expect(generationStatus(node({}), true, 0)).toBe('running');
  });

  it('distinguishes a failure, a finished clip, and a Studio node that never started', () => {
    expect(generationStatus(node({}, { status: 'error', error: 'boom' }), false, 0)).toBe('error');
    expect(generationStatus(node({}), false, 2)).toBe('complete');
    expect(generationStatus(node({ __studioGenerated: true }), false, 0)).toBe('stalled');
    expect(generationStatus(node({}), false, 0)).toBe('queued');
  });
});

describe('seen bookkeeping', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('marks a clip new only when it arrived after the last visit and has not been opened', () => {
    const visit = Date.parse('2026-09-01T10:00:00Z');
    writeSeen('p1', { seenAt: visit });
    const seen = readSeen('p1');
    expect(isNewClip(visit + 1000, 'a', seen)).toBe(true);
    expect(isNewClip(visit - 1000, 'b', seen)).toBe(false);

    const opened = writeSeen('p1', { viewed: [...seen.viewed, 'a'], lastViewed: 'a' });
    expect(isNewClip(visit + 1000, 'a', opened)).toBe(false);
    expect(opened.lastViewed).toBe('a');
  });

  it('is scoped per project and survives a garbage entry', () => {
    writeSeen('p1', { seenAt: 5 });
    expect(readSeen('p2').seenAt).toBe(0);
    localStorage.setItem('cinegen_studio_seen:p3', '{not json');
    expect(readSeen('p3')).toEqual({ seenAt: 0, viewed: [], lastViewed: '' });
  });

  it('opens on the grid unless the person last chose the list', () => {
    expect(readFeedView()).toBe('grid');
    writeFeedView('list');
    expect(readFeedView()).toBe('list');
  });
});

describe('formatting', () => {
  it('formats standard time and millisecond timecode', () => {
    expect(formatClipTime(83.456)).toBe('1:23');
    expect(formatClipTime(83.456, 'timecode')).toBe('00:01:23:456');
    expect(formatClipTime(3725)).toBe('1:02:05');
    expect(formatClipTime(Number.NaN)).toBe('0:00');
  });

  it('names a download after the model and the minute it was made, keeping the real extension', () => {
    const model = { name: 'Seedance 2.5' } as ModelDefinition;
    const at = new Date(2026, 7, 20, 23, 13).getTime();
    expect(clipFileName(model, at, 'https://cdn/x/clip.MP4?sig=1', 'video')).toBe('seedance-2-5-20260820-2313.mp4');
    expect(clipFileName(model, at, 'local-media://abc', 'video')).toBe('seedance-2-5-20260820-2313.mp4');
    expect(clipFileName(model, at, 'local-media://abc', 'image')).toBe('seedance-2-5-20260820-2313.png');
  });
});

describe('config readers', () => {
  it('ignores unknown review values and malformed comments', () => {
    expect(clipReview(node({ __studioReview: 'approved' }))).toBe('approved');
    expect(clipReview(node({ __studioReview: 'shipped' }))).toBeUndefined();
    expect(clipComments(node({ __studioComments: [{ id: 'c1', text: 'nice', at: '2026-09-01T00:00:00Z', author: 'You' }, { text: 'no id' }, 'junk'] }))).toHaveLength(1);
  });
});
