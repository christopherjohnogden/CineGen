import {
  DEFAULT_SKILL_TEMPLATES,
  type SkillSurface,
  type SkillTemplate,
} from '@/lib/llm/default-skill-templates';

export type { SkillSurface, SkillTemplate };

export interface LLMSkill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  createdAt: string;
  updatedAt: string;
  /** Shipped default skill — re-seeded on load if missing; instructions refresh when revision bumps. */
  builtIn?: boolean;
  surfaces?: SkillSurface[];
  templateRevision?: number;
}

const SKILLS_STORAGE_KEY = 'cinegen_llm_skills';

/** Bump when built-in skill copy changes so existing installs pick up updates. */
export const BUILTIN_SKILLS_REVISION = 4;

export const SKILL_TEMPLATES: SkillTemplate[] = DEFAULT_SKILL_TEMPLATES;

function slugifySkillName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function normalizeSkillName(value: string): string {
  const slug = slugifySkillName(value);
  return slug || 'untitled-skill';
}

export function builtinSkillId(name: string): string {
  return `cinegen-builtin-${normalizeSkillName(name)}`;
}

export function createBuiltinSkill(template: SkillTemplate): LLMSkill {
  const now = new Date().toISOString();
  return {
    id: builtinSkillId(template.name),
    name: normalizeSkillName(template.name),
    description: template.description.trim(),
    instructions: template.instructions.trim(),
    createdAt: now,
    updatedAt: now,
    builtIn: true,
    surfaces: template.surfaces,
    templateRevision: BUILTIN_SKILLS_REVISION,
  };
}

function parseStoredSkills(raw: string | null): LLMSkill[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is LLMSkill => (
        Boolean(entry)
        && typeof entry === 'object'
        && typeof (entry as LLMSkill).id === 'string'
        && typeof (entry as LLMSkill).name === 'string'
        && typeof (entry as LLMSkill).description === 'string'
        && typeof (entry as LLMSkill).instructions === 'string'
      ))
      .map((skill) => ({
        ...skill,
        name: normalizeSkillName(skill.name),
      }));
  } catch {
    return [];
  }
}

export function sortSkills(skills: LLMSkill[]): LLMSkill[] {
  return [...skills].sort((a, b) => {
    if (Boolean(a.builtIn) !== Boolean(b.builtIn)) {
      return a.builtIn ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

/** Ensures all 10 default skills exist; refreshes built-in copy when revision bumps. */
export function mergeBuiltinSkills(stored: LLMSkill[]): { skills: LLMSkill[]; changed: boolean } {
  const next = [...stored];
  const byId = new Map(next.map((skill) => [skill.id, skill]));
  const byName = new Map(next.map((skill) => [skill.name, skill]));
  let changed = false;

  for (const template of DEFAULT_SKILL_TEMPLATES) {
    const id = builtinSkillId(template.name);
    const name = normalizeSkillName(template.name);
    const existingById = byId.get(id);

    if (existingById?.builtIn) {
      if ((existingById.templateRevision ?? 0) < BUILTIN_SKILLS_REVISION) {
        const index = next.findIndex((skill) => skill.id === id);
        if (index >= 0) {
          next[index] = {
            ...existingById,
            description: template.description.trim(),
            instructions: template.instructions.trim(),
            surfaces: template.surfaces,
            templateRevision: BUILTIN_SKILLS_REVISION,
            updatedAt: new Date().toISOString(),
          };
          changed = true;
        }
      }
      continue;
    }

    if (byName.has(name)) continue;

    const skill = createBuiltinSkill(template);
    next.push(skill);
    byId.set(skill.id, skill);
    byName.set(skill.name, skill);
    changed = true;
  }

  return { skills: sortSkills(next), changed };
}

function parseFrontmatterBlock(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw.trim() };

  const meta: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key) meta[key] = value;
  }

  return { meta, body: match[2].trim() };
}

export function loadSkills(): LLMSkill[] {
  if (typeof window === 'undefined') return [];
  const stored = parseStoredSkills(localStorage.getItem(SKILLS_STORAGE_KEY));
  const { skills, changed } = mergeBuiltinSkills(stored);
  if (changed) saveSkills(skills);
  return skills;
}

export function saveSkills(skills: LLMSkill[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SKILLS_STORAGE_KEY, JSON.stringify(sortSkills(skills)));
    window.dispatchEvent(new CustomEvent('cinegen:skills-changed'));
  } catch {
    // ignore quota errors
  }
}

export function createSkillFromTemplate(template: SkillTemplate): LLMSkill {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: normalizeSkillName(template.name),
    description: template.description.trim(),
    instructions: template.instructions.trim(),
    createdAt: now,
    updatedAt: now,
    surfaces: template.surfaces,
  };
}

export function createBlankSkill(): LLMSkill {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: 'new-skill',
    description: 'Describe what this skill does and when Copilot should use it.',
    instructions: '# New Skill\n\nAdd step-by-step instructions here.',
    createdAt: now,
    updatedAt: now,
  };
}

export function updateSkillRecord(skill: LLMSkill, patch: Partial<Pick<LLMSkill, 'name' | 'description' | 'instructions'>>): LLMSkill {
  return {
    ...skill,
    ...patch,
    name: patch.name ? normalizeSkillName(patch.name) : skill.name,
    description: patch.description?.trim() ?? skill.description,
    instructions: patch.instructions?.trim() ?? skill.instructions,
    updatedAt: new Date().toISOString(),
  };
}

export function formatSkillForPrompt(skill: LLMSkill): string {
  const surfacesLine = skill.surfaces?.length
    ? `Surfaces: ${skill.surfaces.join(', ')}`
    : '';

  return [
    `## ACTIVE SKILL: ${skill.name}`,
    '',
    'Follow these instructions directly in your chat reply.',
    'Do NOT invoke Skill tool, slash commands, or say you will load the skill.',
    '',
    skill.description.trim(),
    surfacesLine,
    '',
    skill.instructions.trim(),
  ].filter(Boolean).join('\n');
}

export function buildSkillSystemPromptAddition(activeSkillId: string | null | undefined, skills: LLMSkill[]): string {
  if (!activeSkillId) return '';
  const skill = skills.find((entry) => entry.id === activeSkillId);
  if (!skill) return '';
  return formatSkillForPrompt(skill);
}

export function buildSkillsCatalogPromptAddition(skills: LLMSkill[]): string {
  const sorted = sortSkills(skills);
  const lines = [
    'CineGen SKILLS',
    'Saved skills for this project. When the user asks what skills exist, list these directly from this catalog.',
    'Do NOT invoke tools, the Skill tool, or say you will look skills up — they are already listed below.',
    'Users activate a skill in Copilot with Shift+Space or #skill-name in the composer.',
    '',
  ];

  if (sorted.length === 0) {
    lines.push('- No saved skills yet.');
    return lines.join('\n');
  }

  for (const skill of sorted) {
    const surfaces = formatSkillSurfaces(skill.surfaces);
    const builtInLabel = skill.builtIn ? ' (built-in)' : '';
    const surfaceLabel = surfaces ? ` · surfaces: ${surfaces}` : '';
    lines.push(`- **${skill.name}**${builtInLabel}${surfaceLabel}`);
    lines.push(`  ${skill.description.trim()}`);
  }

  return lines.join('\n');
}

export function serializeSkillToMarkdown(skill: LLMSkill): string {
  const surfaces = skill.surfaces?.length ? skill.surfaces.join(', ') : undefined;
  return [
    '---',
    `name: ${skill.name}`,
    `description: ${skill.description.replace(/\n/g, ' ')}`,
    ...(surfaces ? [`surfaces: ${surfaces}`] : []),
    '---',
    '',
    skill.instructions,
    '',
  ].join('\n');
}

export function parseSkillFromMarkdown(raw: string, fallbackName?: string): Omit<LLMSkill, 'id' | 'createdAt' | 'updatedAt'> {
  const { meta, body } = parseFrontmatterBlock(raw.trim());
  const name = normalizeSkillName(meta.name || fallbackName || 'imported-skill');
  const description = (meta.description || 'Imported skill.').trim();
  const instructions = body || '# Imported Skill\n\nAdd instructions.';
  const surfaces = meta.surfaces
    ? meta.surfaces.split(',').map((entry) => entry.trim()).filter(Boolean) as SkillSurface[]
    : undefined;
  return { name, description, instructions, surfaces };
}

export function isSkillNameTaken(name: string, skills: LLMSkill[], excludeId?: string): boolean {
  const normalized = normalizeSkillName(name);
  return skills.some((skill) => skill.id !== excludeId && skill.name === normalized);
}

export function formatSkillSurfaces(surfaces: SkillSurface[] | undefined): string {
  if (!surfaces?.length) return '';
  return surfaces.join(' · ');
}
