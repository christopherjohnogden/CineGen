import { describe, expect, it } from 'vitest';
import type { Asset } from '@/types/project';
import type { Timeline } from '@/types/timeline';
import {
  detectVisualAnalysisIntent,
  extractSlashReferenceLabels,
  extractTimelineClipCitations,
  formatVisualAnalysisReply,
  hasCopilotVisualRefs,
  isGeminiVideoAnalysisRefusal,
  isPrimaryVisualDescribeQuestion,
  resolveCopilotVisualRefs,
  resolveCopilotVisualRefsForMessage,
} from '@/lib/llm/copilot-visual-refs';

const videoAsset: Asset = {
  id: 'asset-1',
  name: 'Storyboard shot',
  type: 'video',
  url: 'local-media://file/tmp/storyboard.mp4',
  fileRef: '/tmp/storyboard.mp4',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const imageAsset: Asset = {
  id: 'asset-2',
  name: 'Hero still',
  type: 'image',
  url: 'local-media://file/tmp/hero.jpg',
  fileRef: '/tmp/hero.jpg',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const timeline: Timeline = {
  id: 'timeline-1',
  name: 'Main',
  duration: 30,
  tracks: [{ id: 'track-1', name: 'V1', kind: 'video', color: '#fff', muted: false, solo: false, locked: false, visible: true, volume: 1 }],
  clips: [{
    id: 'clip-1',
    assetId: 'asset-1',
    trackId: 'track-1',
    name: 'Opening beat',
    startTime: 0,
    duration: 12,
    trimStart: 1,
    trimEnd: 2,
    speed: 1,
    opacity: 1,
    volume: 1,
    flipH: false,
    flipV: false,
    keyframes: [],
  }],
  transitions: [],
  markers: [],
};

describe('copilot-visual-refs', () => {
  it('extracts slash labels with spaces', () => {
    const labels = extractSlashReferenceLabels(
      'describe /Storyboard shot visually',
      ['Storyboard shot', 'Hero still'],
    );
    expect(labels).toEqual(['Storyboard shot']);
  });

  it('resolves asset visual refs', () => {
    const refs = resolveCopilotVisualRefs({
      text: 'what is in /Hero still',
      assets: [videoAsset, imageAsset],
      timelines: [timeline],
      mentionableAssetNames: ['Storyboard shot', 'Hero still'],
      mentionableClipNames: ['Opening beat'],
    });
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      label: 'Hero still',
      kind: 'asset',
      mediaType: 'image',
      fileRef: '/tmp/hero.jpg',
    });
  });

  it('resolves clip visual refs with trim metadata', () => {
    const refs = resolveCopilotVisualRefs({
      text: 'describe /Opening beat',
      assets: [videoAsset, imageAsset],
      timelines: [timeline],
      mentionableAssetNames: ['Storyboard shot', 'Hero still'],
      mentionableClipNames: ['Opening beat'],
    });
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      label: 'Opening beat',
      kind: 'clip',
      mediaType: 'video',
      trimStartSec: 1,
      trimDurationSec: 9,
    });
  });

  it('detects when visual refs are present', () => {
    expect(hasCopilotVisualRefs([])).toBe(false);
    expect(hasCopilotVisualRefs([{
      label: 'Hero still',
      kind: 'asset',
      mediaType: 'image',
      fileRef: '/tmp/hero.jpg',
    }])).toBe(true);
  });

  it('detects visual analysis intent', () => {
    expect(detectVisualAnalysisIntent('visually describe the first clip in the timeline')).toBe(true);
    expect(detectVisualAnalysisIntent('describe the first clip in the timeline')).toBe(true);
    expect(detectVisualAnalysisIntent('list all clips')).toBe(false);
  });

  it('extracts timeline clip citations', () => {
    expect(extractTimelineClipCitations(
      'see [timeline:Test / clip:Storyboard shot @ 00:00.0]',
    )).toEqual([{
      timelineName: 'Test',
      clipName: 'Storyboard shot',
      timeLabel: '00:00.0',
    }]);
  });

  it('auto-resolves the first video clip for visual questions', () => {
    const refs = resolveCopilotVisualRefsForMessage({
      text: 'describe the first clip in the timeline',
      assets: [videoAsset, imageAsset],
      timelines: [timeline],
      activeTimelineId: 'timeline-1',
      mentionableAssetNames: ['Storyboard shot', 'Hero still'],
      mentionableClipNames: ['Opening beat'],
    });
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      label: 'Opening beat',
      kind: 'clip',
      mediaType: 'video',
    });
  });

  it('treats plain clip describe prompts as primary visual questions', () => {
    expect(isPrimaryVisualDescribeQuestion('describe the first clip in the timeline')).toBe(true);
  });

  it('auto-resolves clips from timeline citations', () => {
    const refs = resolveCopilotVisualRefsForMessage({
      text: 'what do you see in [timeline:Main / clip:Opening beat @ 00:00.0]',
      assets: [videoAsset, imageAsset],
      timelines: [timeline],
      activeTimelineId: 'timeline-1',
      mentionableAssetNames: ['Storyboard shot', 'Hero still'],
      mentionableClipNames: ['Opening beat'],
    });
    expect(refs).toHaveLength(1);
    expect(refs[0]?.label).toBe('Opening beat');
  });

  it('prefers slash refs over auto resolution', () => {
    const refs = resolveCopilotVisualRefsForMessage({
      text: 'visually describe /Hero still',
      assets: [videoAsset, imageAsset],
      timelines: [timeline],
      activeTimelineId: 'timeline-1',
      mentionableAssetNames: ['Storyboard shot', 'Hero still'],
      mentionableClipNames: ['Opening beat'],
    });
    expect(refs).toHaveLength(1);
    expect(refs[0]?.label).toBe('Hero still');
  });

  it('detects primary visual describe questions', () => {
    expect(isPrimaryVisualDescribeQuestion('visually describe the first clip in the timeline')).toBe(true);
    expect(isPrimaryVisualDescribeQuestion('describe the first clip in the timeline')).toBe(true);
    expect(isPrimaryVisualDescribeQuestion('visually describe and trim the first clip')).toBe(false);
  });

  it('detects Gemini video refusal responses', () => {
    expect(isGeminiVideoAnalysisRefusal(
      'I do not have the ability to process or interpret the content of video files.',
    )).toBe(true);
  });
});
