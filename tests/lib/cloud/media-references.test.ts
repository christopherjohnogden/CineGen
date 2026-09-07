import { describe, expect, it } from 'vitest';
import { mediaSourceHash, restoreCloudMediaReferences } from '@/lib/cloud/media-references';

const source = 'blob:https://cinegen.example/video-preview';
const remote = 'https://firebasestorage.googleapis.com/v0/b/test/o/users%2Fowner%2Fprojects%2Fproject%2Fmedia%2Fvideo-id%2Foriginal-tvhc3p-video.mov?alt=media&token=test';
const asset = { id: 'video-id', source_url: remote, created_at: '2026-09-06T21:00:00Z' };

describe('cloud reference recovery', () => {
  it('repairs stored generation inputs and Recreate references using the exact uploaded asset fingerprint', () => {
    const state = { assets: [asset], workflow: { nodes: [{ config: { extra_images: { urls: [source] }, __studioAttachedRefs: [source] } }] } };
    const repaired = restoreCloudMediaReferences(state);
    expect(repaired.workflow.nodes[0].config.extra_images.urls).toEqual([remote]);
    expect(repaired.workflow.nodes[0].config.__studioAttachedRefs).toEqual([remote]);
    expect(state.workflow.nodes[0].config.__studioAttachedRefs).toEqual([source]);
    expect(restoreCloudMediaReferences(repaired)).toEqual(repaired);
  });
  it('never substitutes an unrelated file or a non-Firebase URL', () => {
    const state = { assets: [asset], refs: ['blob:https://cinegen.example/other-video'] };
    expect(restoreCloudMediaReferences(state)).toEqual(state);
    const untrusted = { assets: [{ ...asset, source_url: remote.replace('firebasestorage.googleapis.com', 'example.com') }], refs: [source] };
    expect(restoreCloudMediaReferences(untrusted)).toEqual(untrusted);
  });
  it('recovers a temporary HTTPS video link from its previously uploaded original', () => {
    const temporary = 'https://api.topview.ai/s/expired-video';
    const fingerprint = mediaSourceHash(`${temporary}|||${asset.created_at}`);
    const saved = remote.replace('tvhc3p', fingerprint);
    const state = {
      assets: [{ ...asset, source_url: saved }],
      workflow: { nodes: [{ result: { url: temporary }, generations: [{ url: temporary }] }] },
      references: [temporary, 'https://api.topview.ai/s/different-video'],
    };
    const repaired = restoreCloudMediaReferences(state);
    expect(repaired.workflow.nodes[0].result.url).toBe(saved);
    expect(repaired.workflow.nodes[0].generations[0].url).toBe(saved);
    expect(repaired.references).toEqual([saved, state.references[1]]);
    expect(state.workflow.nodes[0].result.url).toBe(temporary);
  });
});
