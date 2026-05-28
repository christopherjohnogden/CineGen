export type SkillSurface = 'llm' | 'spaces' | 'edit' | 'elements' | 'export';

export interface SkillTemplate {
  name: string;
  description: string;
  instructions: string;
  surfaces?: SkillSurface[];
}

/** Shared guidance for skills that can emit app actions (Spaces, Edit, Export). */
export const SKILL_ACTION_GUIDE = `
When the user confirms they want CineGen to apply changes (not just plan in chat), include ONE \`cinegen-skill-action\` JSON block:

\`\`\`cinegen-skill-action
{"label":"Short button label","steps":[{"type":"navigate","tab":"edit"}]}
\`\`\`

Step types (use only what this skill needs):
- \`navigate\`: \`{ "type": "navigate", "tab": "llm" | "spaces" | "edit" | "elements" | "export" }\`
- \`create_space\`: \`{ "type": "create_space", "name": "...", "template": "storyboard" | "shot-ideas" | "multi-shot" | "b-roll", "prefill": { "scene": "...", "prompts": ["..."] } }\`
- \`edit_timeline\`: \`{ "type": "edit_timeline", "timelineId": "active", "ops": [...] }\` — ops: \`trim_silence\`, \`close_gaps\`, \`add_markers\`, \`create_timeline\`, \`insert_placeholders\`
- \`save_elements\`: \`{ "type": "save_elements", "items": [{ "kind": "character" | "location" | "select", "name": "...", "notes": "..." }] }\`
- \`start_export\`: \`{ "type": "start_export", "preset": "youtube-1080p" | "social-916" | "prores-master" }\`

Always summarize planned changes in chat before the action block. Destructive edit ops need explicit user confirmation first.`;

export const DEFAULT_SKILL_TEMPLATES: SkillTemplate[] = [
  {
    name: 'shot-list',
    surfaces: ['llm', 'spaces'],
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
6. Keep language production-ready — no filler.

If the user wants to generate shots in Spaces, offer a **Multi Prompt** workspace with one row per shot after the list is approved.
${SKILL_ACTION_GUIDE}`,
  },
  {
    name: 'storyboard',
    surfaces: ['llm', 'spaces'],
    description:
      'Breaks scenes into storyboard panels with composition notes and image prompts. Use when the user wants a storyboard, key frames, previz, or visual beat breakdown.',
    instructions: `# Storyboard

When storyboarding:

1. Clarify scene, aspect ratio, style reference, and panel count if missing.
2. Use script, brief, elements, and reference assets when available.
3. For each panel output:

\`\`\`
### Panel [N] — [Beat name]
- **Frame:** Composition (foreground / mid / background)
- **Subject & action:** What we see happening
- **Camera:** Angle, lens feel, movement
- **Mood / lighting:** Color, contrast, time of day
- **Prompt:** Single image-gen prompt ready for Storyboarder or Prompt nodes
- **Duration:** Hold time if animatic (seconds)
\`\`\`

4. Keep panel count practical (4–12 for a scene unless user asks for more).
5. Note continuity between panels (wardrobe, eyelines, screen direction).

When approved, emit a \`create_space\` action with template \`storyboard\` and prefill scene text plus panel prompts.
${SKILL_ACTION_GUIDE}`,
  },
  {
    name: 'editorial-brief',
    surfaces: ['llm', 'edit'],
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
4. Stay concise — this is a working brief, not a treatment.

If the user wants to start cutting, offer to navigate to Edit and add timeline markers at each key moment.
${SKILL_ACTION_GUIDE}`,
  },
  {
    name: 'rough-cut',
    surfaces: ['llm', 'edit'],
    description:
      'Proposes narrative rough cuts and stringouts from transcripts and project media. Use when the user wants a first assembly, rough cut, stringout, or interview edit plan.',
    instructions: `# Rough Cut

When building a rough cut plan:

1. Read transcripts, word timestamps, and asset metadata. Ask for target runtime and story goal if unclear.
2. Propose an ordered cut list:

\`\`\`
### Cut [N]
- **Source:** [asset:Name @ in–out]
- **Why:** Narrative purpose / quote / beat
- **Duration:** Estimated seconds
- **Transition:** Cut | J-cut | L-cut | fade
\`\`\`

3. Flag gaps (missing B-roll, unclear bridge, weak opening).
4. End with total runtime estimate and pacing notes.

When the user confirms, emit \`edit_timeline\` with \`create_timeline\` op including clip order, in/out times, and timeline name. Navigate to Edit first.
${SKILL_ACTION_GUIDE}`,
  },
  {
    name: 'remove-dead-space',
    surfaces: ['llm', 'edit'],
    description:
      'Finds silence, pauses, and dead air on the active timeline and proposes trims. Use when the user wants to remove dead space, clean up pauses, tighten an interview, or ripple-delete gaps.',
    instructions: `# Remove Dead Space

When cleaning dead space:

1. Focus on the **active timeline** and its clips. Use transcripts and word timestamps when available.
2. Identify regions to remove:
   - Long silences between speech
   - Filler pauses, false starts, long breaths
   - Gaps between clips that should ripple closed
3. Present a **preview table** before any apply:

\`\`\`
| # | Clip / region | Start | End | Remove (s) | Reason |
\`\`\`

4. Summarize total time saved and pacing impact.
5. Ask for explicit confirmation before applying destructive edits.

When confirmed, emit \`edit_timeline\` on \`timelineId: "active"\` with ops such as:
- \`trim_silence\`: \`{ "op": "trim_silence", "thresholdDb": -40, "minSilenceSec": 0.8 }\`
- \`close_gaps\`: \`{ "op": "close_gaps", "maxGapSec": 0.5, "ripple": true }\`

Navigate to Edit before timeline ops.
${SKILL_ACTION_GUIDE}`,
  },
  {
    name: 'prompt-writer',
    surfaces: ['llm', 'spaces'],
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
5. Keep each prompt under 200 words unless the user asks for detail.

If the user wants a workspace, offer \`create_space\` with template \`shot-ideas\` or \`multi-shot\` and prefill prompts array.
${SKILL_ACTION_GUIDE}`,
  },
  {
    name: 'selects-highlights',
    surfaces: ['llm', 'edit', 'elements'],
    description:
      'Finds quotable lines, emotional peaks, and usable moments in transcripts. Use when the user wants selects, highlights, best moments, or pull quotes from footage.',
    instructions: `# Selects & Highlights

When finding selects:

1. Scan transcripts and project index for high-value moments.
2. Rank by narrative strength, emotion, clarity, and uniqueness.
3. Output ranked selects:

\`\`\`
### Select [N] — [Tag: quote | peak | humor | insight]
- **Source:** [asset:Name @ time]
- **Pull:** Short quote or moment description
- **Why it works:** One sentence
- **Suggested use:** Opener | chapter break | montage | social clip
\`\`\`

4. Group by theme or story beat when helpful.
5. Note duplicates or weak alternatives to skip.

When the user wants markers or a saved collection, emit \`add_markers\` on the active timeline and/or \`save_elements\` with kind \`select\` for top picks.
${SKILL_ACTION_GUIDE}`,
  },
  {
    name: 'b-roll-planner',
    surfaces: ['llm', 'spaces', 'edit'],
    description:
      'Maps B-roll coverage over voiceover or interview audio. Use when the user needs B-roll ideas, visual coverage, cutaway plan, or placeholder timing over dialogue.',
    instructions: `# B-Roll Planner

When planning B-roll:

1. Read the VO/interview track or transcript on the active timeline (or ask which asset to plan against).
2. Break the timeline into beats and assign visuals:

\`\`\`
### Beat [N] — [time range]
- **Audio:** What we hear (paraphrase or quote)
- **Visual:** What to show
- **Type:** Archival | generated | location | detail insert
- **Prompt / search note:** For gen or stock lookup
- **Duration:** Seconds
\`\`\`

3. Flag beats with weak or generic visuals — offer stronger alternatives.
4. End with a shot-count and coverage summary.

When approved:
- For generation: \`create_space\` template \`b-roll\` with prefill prompts per beat.
- For editing: \`insert_placeholders\` on B-roll track aligned to beat times.
${SKILL_ACTION_GUIDE}`,
  },
  {
    name: 'delivery-prep',
    surfaces: ['llm', 'edit', 'export'],
    description:
      'Audits the active timeline before export — gaps, duration, audio, aspect ratio. Use when the user wants delivery prep, QC, pre-export checklist, or publish-ready review.',
    instructions: `# Delivery Prep

When preparing for delivery:

1. Audit the **active timeline** and report:

\`\`\`
## Delivery checklist
- [ ] Duration vs target
- [ ] Black frames / flash frames
- [ ] Timeline gaps or accidental cuts
- [ ] Audio peaks / inconsistent levels (note if data limited)
- [ ] Aspect ratio / safe margins
- [ ] Missing or offline media
- [ ] Captions / legal / credits (if applicable)
\`\`\`

2. Prioritize fixes: **Critical** (blocks export) vs **Recommended** vs **Optional**.
3. Suggest an export preset (YouTube 1080p, social 9:16, ProRes master) with rationale.

When the user confirms fixes, emit safe \`edit_timeline\` ops (\`close_gaps\` only when needed), then \`start_export\` with the chosen preset. Navigate to Edit or Export as appropriate.
${SKILL_ACTION_GUIDE}`,
  },
  {
    name: 'character-look-bible',
    surfaces: ['llm', 'elements', 'spaces'],
    description:
      'Builds consistent character, location, and look references for a project. Use when the user wants a look bible, style guide, character sheet, or visual continuity pack.',
    instructions: `# Character & Look Bible

When building a look bible:

1. Gather characters, locations, wardrobe, and visual tone from script, brief, or chat.
2. Structure output as:

\`\`\`
## Visual north star
[One paragraph — aesthetic, era, color palette, lens language]

## Characters
### [Name]
- **Silhouette / build:**
- **Wardrobe:**
- **Hair & makeup:**
- **Personality on camera:**
- **Gen prompt (hero portrait):**

## Locations
### [Name]
- **Mood / time of day:**
- **Key props:**
- **Gen prompt (establishing):**

## Continuity rules
[Screen direction, recurring props, do-not-break list]
\`\`\`

3. Keep descriptions consistent — reuse exact phrasing for recurring subjects across prompts.

When approved, \`save_elements\` for each character/location and optionally \`create_space\` with reference Prompt nodes per entry.
${SKILL_ACTION_GUIDE}`,
  },
];
