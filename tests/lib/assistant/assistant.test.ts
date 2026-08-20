import { describe, expect, it } from 'vitest';
import { createEmptyDirectorShow } from '@/lib/director/create-show';
import { assistantActionRunnable, assistantProviderReady, directorBrief, pickAssistantProvider, stampDirectorTags, visibleAssistantContent } from '@/lib/assistant/assistant';

describe('assistant', () => {
  it('picks an installed CLI, preferring the saved one', () => {
    const providers = [
      { id: 'claude-code', installed: false },
      { id: 'codex', installed: true },
      { id: 'gemini', installed: true },
    ];
    expect(pickAssistantProvider('claude-code', providers)).toBe('codex');
    expect(pickAssistantProvider('gemini', providers)).toBe('gemini');
    expect(pickAssistantProvider('claude-code', providers.map((row) => ({ ...row, installed: false })))).toBe('claude-code');
    const installed = { 'claude-code': false, codex: true, gemini: true };
    expect(assistantProviderReady('codex', installed, {})).toBe(true);
    expect(assistantProviderReady('luna', installed, {})).toBe(true);
    expect(assistantProviderReady('fal', installed, { falReady: true })).toBe(true);
    expect(assistantProviderReady('openai', installed, {})).toBe(false);
  });

  it('summarizes director scenes and clip shot times for the prompt', () => {
    const show = createEmptyDirectorShow();
    const brief = directorBrief({
      ...show,
      mode: 'generate',
      scenes: [{ id: 's1', number: 1, label: 'SCENE 1 — WARD', summary: '', elementIds: [], clipIds: ['a'] }],
      clips: [{
        id: 'a', title: '1A', seconds: 20, sceneId: 's1',
        beats: [
          { n: 1, from: '0:00', to: '0:07', dur: 7, text: 'ws' },
          { n: 2, from: '0:07', to: '0:13', dur: 6, text: 'ws' },
        ],
        subject: '', location: '', style: '', constraints: '', elementTags: ['@Peter', '@Sofa'],
        activeVariant: { kind: 'full' }, bodyEdits: {}, takes: [],
      }],
      breakdown: [
        { id: 'p', kind: 'character', name: 'Peter', tag: '@Peter', description: 'exhausted patient' },
        { id: 'j', kind: 'character', name: 'Dr. Jordan', tag: '@Dr-Jordan', description: 'therapist' },
        { id: 's', kind: 'prop', name: 'sofa', tag: '@Sofa', description: 'leather Chesterfield' },
      ],
      selectedClipId: 'a',
    });
    expect(brief).toContain('Page: generate');
    expect(brief).toContain('Selected clip: 1A');
    expect(brief).toContain('character @Peter Peter');
    expect(brief).toContain('prop @Sofa sofa');
    expect(brief).toContain('@Peter + @Sofa');
    expect(brief).toContain('S1 0:00–0:07 — ws');
    expect(brief).toContain('S2 0:07–0:13 — ws');
  });

  it('rewrites prompt names to Director @Tags', () => {
    const show = createEmptyDirectorShow();
    const stamped = stampDirectorTags(
      'Peter sits on the sofa across from Dr. Jordan. @Peter stays tagged.',
      {
        ...show,
        breakdown: [
          { id: 'p', kind: 'character', name: 'Peter', tag: '@Peter', description: '' },
          { id: 'j', kind: 'character', name: 'Dr. Jordan', tag: '@Dr-Jordan', description: '' },
          { id: 's', kind: 'prop', name: 'sofa', tag: '@Sofa', description: '' },
        ],
      },
    );
    expect(stamped).toBe('@Peter sits on the @Sofa across from @Dr-Jordan. @Peter stays tagged.');
  });

  it('hides skill-action JSON and trailing add offers from chat', () => {
    const raw = [
      'Here is a prompt.',
      '',
      '> Peter on the sofa',
      '',
      'Want me to add this as a generation node on the active Spaces workspace?',
      '',
      '```cinegen-skill-action',
      '{"label":"Add prompt to Spaces","steps":[{"type":"add_nodes","spaceId":"active","nodes":[{"nodeType":"prompt","label":"Peter","config":{"prompt":"x"}}]}]}',
      '```',
    ].join('\n');
    expect(visibleAssistantContent(raw)).toBe('Here is a prompt.\n\n> Peter on the sofa');
    expect(visibleAssistantContent(raw)).not.toContain('cinegen-skill-action');
    expect(assistantActionRunnable({
      label: 'Add',
      steps: [{ type: 'add_nodes', spaceId: 'active', nodes: [], navigate: true }],
    })).toBe(true);
    expect(assistantActionRunnable({
      label: 'Generate',
      steps: [{ type: 'generate_media', prompt: 'x', outputType: 'image', target: 'bin' }],
    })).toBe(false);
  });
});
