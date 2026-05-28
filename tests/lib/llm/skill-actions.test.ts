import { describe, expect, it } from 'vitest';
import {
  extractShotPromptsFromMarkdown,
  extractStandalonePrompts,
  parseSkillActionFromContent,
  resolveSkillActionForMessage,
  stripSkillActionBlock,
} from '@/lib/llm/skill-actions';
import { isShotListMessage, parseShotListFromMarkdown } from '@/lib/llm/shot-list-parse';
import { planVideoClips } from '@/lib/llm/shot-list-planner';
import { buildNodesFromSpecs } from '@/lib/llm/space-node-factory';
import { buildSpaceFromTemplate, normalizePrefillPrompts } from '@/lib/llm/space-templates';

describe('skill-actions', () => {
  it('parses cinegen-skill-action blocks', () => {
    const content = [
      'Here is your clip plan.',
      '',
      '```cinegen-skill-action',
      '{"label":"Create video workspace","steps":[{"type":"create_space","name":"Father\'s Day","template":"video-from-shot-list","prefill":{"clipGroups":[{"label":"Shot 1","mode":"seedance-single","totalDuration":5,"combinedPrompt":"Wide establishing shot","shots":[{"label":"Shot 1","prompt":"Wide establishing shot","duration":5}]}]}}]}',
      '```',
    ].join('\n');

    const action = parseSkillActionFromContent(content);
    expect(action?.label).toBe('Create video workspace');
    expect(action?.steps[0]).toMatchObject({ type: 'create_space', name: "Father's Day", template: 'video-from-shot-list' });
    expect(stripSkillActionBlock(content)).not.toContain('cinegen-skill-action');
  });

  it('extracts image prompts from shot sections', () => {
    const content = [
      '### Shot 1 — Opening',
      '**Image prompt:**',
      '*"Wide shot at golden hour with a father and child."*',
      '',
      '### Shot 2 — Close-up',
      '**Prompt:** "Tight close-up on hands holding a gift."',
    ].join('\n');

    const prompts = extractShotPromptsFromMarkdown(content);
    expect(prompts).toHaveLength(2);
    expect(prompts[0].prompt).toContain('golden hour');
    expect(prompts[1].prompt).toContain('hands holding a gift');
  });

  it('does not infer a create-space action from raw shot-list skill output', () => {
    const content = [
      '## Coverage summary',
      'Total shots: 2',
      '',
      '### Shot 1 — Opening wide',
      '**Type:** Wide',
      '**Subject:** Father',
      '**Action:** Walks into frame',
      '**Duration:** 5',
      '',
      '### Shot 2 — Close-up',
      '**Type:** Close',
      '**Subject:** Hands',
      '**Action:** Hold a gift',
      '**Duration:** 3',
    ].join('\n');

    expect(isShotListMessage(content)).toBe(true);
    const action = resolveSkillActionForMessage(content, { activeSkillName: 'shot-list' });
    expect(action).toBeNull();
  });

  it('infers add prompt action when user asked for a node', () => {
    const content = [
      'Bonus — Shot 13 / Closing wide',
      '',
      'Image prompt:',
      '',
      'Wide shot at golden hour. A man in a tan jacket and a young child walk side by side away from camera down a quiet suburban street. Long shadows stretch ahead of them.',
      '',
      'Want me to add this prompt to the active Priority shots workspace as a generation node?',
    ].join('\n');

    const action = resolveSkillActionForMessage(content, {
      activeSpaceName: 'Priority shots',
      userMessage: 'give me a node for shot 13',
    });
    expect(action?.label).toContain('Priority shots');
    expect(action?.label).toContain('Shot 13');
    expect(action?.steps[0]).toMatchObject({ type: 'add_nodes' });
    const addStep = action?.steps[0];
    if (addStep?.type === 'add_nodes') {
      expect(addStep.nodes[0].config?.prompt).toContain('golden hour');
      expect(addStep.nodes[0].label).toContain('Shot 13');
    }
  });

  it('infers add prompt action when assistant offers to add', () => {
    const content = [
      '**Image prompt:** Wide shot at golden hour with father and child walking away from camera down a suburban street at sunset.',
      '',
      'Want me to add this prompt to the active Priority shots workspace as a generation node?',
    ].join('\n');

    const action = resolveSkillActionForMessage(content, {
      activeSpaceName: 'Priority shots',
      userMessage: 'what would shot 13 look like',
    });
    expect(action?.steps[0]).toMatchObject({ type: 'add_nodes' });
  });

  it('infers add prompt action for prompt-writer output', () => {
    const content = [
      'Here is a cinematic prompt for your scene.',
      '',
      '**Prompt:** A father kneels on a suburban driveway at golden hour, eye-level with his young daughter, warm lens flare and shallow depth of field.',
    ].join('\n');

    const prompts = extractStandalonePrompts(content);
    expect(prompts).toHaveLength(1);

    const action = resolveSkillActionForMessage(content, {
      activeSkillName: 'prompt-writer',
      activeSpaceName: 'Father\'s Day',
    });
    expect(action?.label).toContain('Father\'s Day');
    expect(action?.steps[0]).toMatchObject({ type: 'add_nodes' });
  });

  it('parses add_nodes actions', () => {
    const content = [
      '```cinegen-skill-action',
      '{"label":"Add prompt to Demo","steps":[{"type":"add_nodes","spaceId":"active","nodes":[{"nodeType":"prompt","label":"Hero","config":{"prompt":"Wide shot at dusk"}}]}]}',
      '```',
    ].join('\n');

    const action = parseSkillActionFromContent(content);
    expect(action?.steps[0]).toMatchObject({ type: 'add_nodes' });
  });

  it('builds prompt nodes from specs', () => {
    const nodes = buildNodesFromSpecs([{
      nodeType: 'prompt',
      label: 'Hero',
      config: { prompt: 'Wide shot at dusk' },
    }], []);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe('prompt');
    expect(nodes[0].data.config.prompt).toBe('Wide shot at dusk');
  });

  it('infers storyboard workspace actions for storyboard skill output', () => {
    const content = [
      '### Panel 1 — Opening wide',
      '**Prompt:** Father walks into frame.',
      '',
      '### Panel 2 — Close-up',
      '**Prompt:** Hands on a wrapped gift.',
    ].join('\n');

    const action = resolveSkillActionForMessage(content, { activeSkillName: 'storyboard' });
    expect(action?.label).toBe('Create storyboard workspace');
    expect(action?.steps[0]).toMatchObject({ template: 'storyboard-images' });
  });
});

describe('shot-list planner', () => {
  it('combines consecutive shots up to 15 seconds', () => {
    const shots = parseShotListFromMarkdown([
      '### Shot 1 — Scene A',
      '**Type:** Wide',
      '**Duration:** 5',
      '',
      '### Shot 2 — Scene A',
      '**Type:** Medium',
      '**Duration:** 5',
      '',
      '### Shot 3 — Scene A',
      '**Type:** Close',
      '**Duration:** 5',
    ].join('\n'));

    const plans = planVideoClips(shots, { combineShots: true, preferKlingForMulti: false });
    expect(plans).toHaveLength(1);
    expect(plans[0].totalDuration).toBe(15);
    expect(plans[0].mode).toBe('seedance-single');
  });
});

describe('buildSpaceFromTemplate', () => {
  it('creates wired storyboard rows with model and asset output nodes', () => {
    const space = buildSpaceFromTemplate('Father\'s Day', 'storyboard-images', {
      prompts: [
        { label: 'Panel 1', prompt: 'Wide shot', duration: 4 },
        { label: 'Panel 2', prompt: 'Close-up', duration: 3 },
      ],
    }, []);

    expect(space.name).toBe("Father's Day");
    expect(space.nodes.filter((node) => node.type === 'prompt')).toHaveLength(2);
    expect(space.nodes.filter((node) => node.type === 'nano-banana-2')).toHaveLength(2);
    expect(space.nodes.filter((node) => node.type === 'assetOutput')).toHaveLength(2);
    expect(space.edges.length).toBeGreaterThanOrEqual(4);
  });

  it('creates per-clip video rows instead of one multi prompt node', () => {
    const space = buildSpaceFromTemplate('Father\'s Day', 'video-from-shot-list', {
      combineShots: false,
      prompts: [
        { label: 'Shot 1', prompt: 'Wide shot', duration: 5 },
        { label: 'Shot 2', prompt: 'Close-up', duration: 3 },
      ],
    }, []);

    expect(space.nodes.some((node) => node.type === 'multiPrompt')).toBe(false);
    expect(space.nodes.filter((node) => node.type === 'seedance-2')).toHaveLength(2);
    expect(space.edges.length).toBeGreaterThanOrEqual(4);
  });

  it('creates a kling multi-prompt row for combined clip groups', () => {
    const space = buildSpaceFromTemplate('Father\'s Day', 'video-from-shot-list', {
      clipGroups: [{
        label: 'Shots 1–2',
        mode: 'kling-multi',
        totalDuration: 10,
        shots: [
          { label: 'Shot 1', prompt: 'Wide shot', duration: 5 },
          { label: 'Shot 2', prompt: 'Close-up', duration: 5 },
        ],
      }],
    }, []);

    expect(space.nodes.filter((node) => node.type === 'multiPrompt')).toHaveLength(1);
    expect(space.nodes.filter((node) => node.type === 'kling-3-text')).toHaveLength(1);
    expect(normalizePrefillPrompts({ prompts: [] })).toHaveLength(0);
  });
});
