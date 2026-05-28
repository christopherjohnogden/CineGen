export interface LLMSkill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillTemplate {
  name: string;
  description: string;
  instructions: string;
}

const SKILLS_STORAGE_KEY = 'cinegen_llm_skills';

export const SKILL_TEMPLATES: SkillTemplate[] = [
  {
    name: 'shot-list',
    description:
      'Builds structured shot lists from scripts, briefs, or transcripts. Use when the user asks for a shot list, coverage plan, scene breakdown, or shooting schedule.',
    instructions: `# Shot List

When the user asks for a shot list:

1. Clarify scene count, runtime target, and style if missing.
2. Use project assets, transcripts, and elements when available.
3. Output a numbered shot list with this structure for each shot:

\`\`\`
### Shot [N] — [Scene / Beat name]
- **Type:** Wide | Medium | Close | Insert | POV | Drone | etc.
- **Subject:** Who or what is on screen
- **Action:** What happens in the shot
- **Camera:** Movement, lens feel, framing notes
- **Audio:** Dialogue, VO, ambience, music cue
- **Duration:** Estimated seconds
- **Notes:** Props, wardrobe, VFX, continuity
\`\`\`

4. Group shots by scene or location.
5. End with a brief coverage summary (total shots, est. runtime, priority setups).
6. Keep language production-ready — no filler.`,
  },
  {
    name: 'editorial-brief',
    description:
      'Drafts editorial briefs from transcripts and project context. Use when the user wants a creative brief, edit direction, story outline, or narrative plan before cutting.',
    instructions: `# Editorial Brief

When drafting an editorial brief:

1. Read available transcripts, visual summaries, and timeline context.
2. Structure the brief as:

\`\`\`
## Objective
[One paragraph — what this edit should achieve]

## Audience & Tone
[Who it's for, emotional register, pacing feel]

## Story Arc
[Beginning → middle → end beats]

## Key Moments
[Bullet list of must-include moments with source citations when possible]

## Structure Notes
[Act breaks, chapter markers, B-roll strategy]

## Open Questions
[What still needs a creative decision]
\`\`\`

3. Cite sources with \`[asset:Name @ time]\` or \`[timeline:Name / clip:Clip @ time]\` when referencing specific moments.
4. Stay concise — this is a working brief, not a treatment.`,
  },
  {
    name: 'prompt-writer',
    description:
      'Writes image and video generation prompts from project context. Use when the user wants prompts for AI generation nodes, storyboards, or visual references.',
    instructions: `# Prompt Writer

When writing generation prompts:

1. Match the user's target model style (cinematic, photoreal, stylized, etc.).
2. Structure each prompt as:
   - **Subject** — who/what is in frame
   - **Action** — movement or moment
   - **Environment** — location, time of day, weather
   - **Camera** — angle, lens, depth of field, movement
   - **Lighting** — key light direction, mood, color grade feel
   - **Style** — film stock, reference aesthetic, aspect ratio hint

3. Output prompts ready to paste into CineGen Spaces nodes.
4. Offer 2–3 variants when useful (safe, bold, minimal).
5. Keep each prompt under 200 words unless the user asks for detail.`,
  },
];

function slugifySkillName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function normalizeSkillName(value: string): string {
  const slug = slugifySkillName(value);
  return slug || 'untitled-skill';
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
  try {
    const raw = localStorage.getItem(SKILLS_STORAGE_KEY);
    if (!raw) return [];
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

export function saveSkills(skills: LLMSkill[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SKILLS_STORAGE_KEY, JSON.stringify(skills));
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
  return [
    `## Skill: ${skill.name}`,
    '',
    skill.description.trim(),
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

export function serializeSkillToMarkdown(skill: LLMSkill): string {
  return [
    '---',
    `name: ${skill.name}`,
    `description: ${skill.description.replace(/\n/g, ' ')}`,
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
  return { name, description, instructions };
}

export function isSkillNameTaken(name: string, skills: LLMSkill[], excludeId?: string): boolean {
  const normalized = normalizeSkillName(name);
  return skills.some((skill) => skill.id !== excludeId && skill.name === normalized);
}
