import { describe, expect, it } from 'vitest';
import { parseSkillActionFromContent, type SkillGenerateMediaStep } from '@/lib/llm/skill-actions';

function block(json: object): string {
  return `Sure, here you go:\n\n\`\`\`cinegen-skill-action\n${JSON.stringify(json)}\n\`\`\``;
}

describe('parseSkillActionFromContent — generate_media', () => {
  it('parses a video generate_media step targeting the timeline', () => {
    const action = parseSkillActionFromContent(block({
      label: 'Generate rain b-roll',
      steps: [{ type: 'generate_media', prompt: 'rain on a window', model: 'seedance_2_0', outputType: 'video', target: 'timeline' }],
    }));
    expect(action).not.toBeNull();
    const step = action!.steps.find((s): s is SkillGenerateMediaStep => s.type === 'generate_media');
    expect(step).toBeDefined();
    expect(step!.prompt).toBe('rain on a window');
    expect(step!.model).toBe('seedance_2_0');
    expect(step!.outputType).toBe('video');
    expect(step!.target).toBe('timeline');
  });

  it('defaults outputType to image and target to timeline', () => {
    const action = parseSkillActionFromContent(block({
      label: 'g', steps: [{ type: 'generate_media', prompt: 'a logo' }],
    }));
    const step = action!.steps.find((s): s is SkillGenerateMediaStep => s.type === 'generate_media')!;
    expect(step.outputType).toBe('image');
    expect(step.target).toBe('timeline');
    expect(step.model).toBeUndefined();
  });

  it('honors target:bin and a refClipId', () => {
    const action = parseSkillActionFromContent(block({
      label: 'g', steps: [{ type: 'generate_media', prompt: 'clean plate', outputType: 'image', target: 'bin', refClipId: 'clip-9' }],
    }));
    const step = action!.steps.find((s): s is SkillGenerateMediaStep => s.type === 'generate_media')!;
    expect(step.target).toBe('bin');
    expect(step.refClipId).toBe('clip-9');
  });

  it('drops a generate_media step with an empty prompt', () => {
    const action = parseSkillActionFromContent(block({
      label: 'g', steps: [{ type: 'generate_media', prompt: '   ', outputType: 'image', target: 'timeline' }],
    }));
    expect(action).toBeNull(); // no valid steps
  });
});
