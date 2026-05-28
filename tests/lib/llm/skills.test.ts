import { describe, expect, it } from 'vitest';
import {
  BUILTIN_SKILLS_REVISION,
  builtinSkillId,
  createBuiltinSkill,
  mergeBuiltinSkills,
  normalizeSkillName,
  type LLMSkill,
} from '@/lib/llm/skills';
import { DEFAULT_SKILL_TEMPLATES } from '@/lib/llm/default-skill-templates';

describe('mergeBuiltinSkills', () => {
  it('seeds all default skills when storage is empty', () => {
    const { skills, changed } = mergeBuiltinSkills([]);
    expect(changed).toBe(true);
    expect(skills).toHaveLength(DEFAULT_SKILL_TEMPLATES.length);
    expect(skills.every((skill) => skill.builtIn)).toBe(true);
    expect(skills.map((skill) => skill.name).sort()).toEqual(
      DEFAULT_SKILL_TEMPLATES.map((template) => normalizeSkillName(template.name)).sort(),
    );
  });

  it('does not duplicate when a custom skill already uses the same name', () => {
    const custom: LLMSkill = {
      id: 'user-shot-list',
      name: 'shot-list',
      description: 'Custom shot list',
      instructions: '# Custom',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const { skills, changed } = mergeBuiltinSkills([custom]);
    expect(changed).toBe(true);
    expect(skills.filter((skill) => skill.name === 'shot-list')).toHaveLength(1);
    expect(skills.find((skill) => skill.name === 'shot-list')?.id).toBe('user-shot-list');
    expect(skills.length).toBe(DEFAULT_SKILL_TEMPLATES.length);
  });

  it('refreshes built-in copy when template revision bumps', () => {
    const stale = createBuiltinSkill(DEFAULT_SKILL_TEMPLATES[0]);
    stale.templateRevision = BUILTIN_SKILLS_REVISION - 1;
    stale.description = 'Old description';
    const { skills, changed } = mergeBuiltinSkills([stale]);
    expect(changed).toBe(true);
    const updated = skills.find((skill) => skill.id === builtinSkillId('shot-list'));
    expect(updated?.description).toBe(DEFAULT_SKILL_TEMPLATES[0].description);
    expect(updated?.templateRevision).toBe(BUILTIN_SKILLS_REVISION);
  });
});
