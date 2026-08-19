# Faster Breakdown (Two-Phase Identify + Lazy Enrich) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the breakdown fast by having the breakdown LLM call only IDENTIFY assets (no per-character profile prose), sending only changed-scene text on incremental edits, and writing rich acting-profile/voice paragraphs lazily at generation time.

**Architecture:** A new `BREAKDOWN_IDENTIFY_SYSTEM_PROMPT` (current prompt minus the acting/voice/scene-event doctrines) drives the breakdown; `breakdownJobInput` gains an optional scene scope; a new pure `enrich.ts` builds/parses a per-character enrichment call; `generateOne` enriches a clip's characters on demand (cached via `enrichedAt`), falling back to `description`.

**Tech Stack:** React 18 + TypeScript, Vitest (`@/` → `src/`), existing `runDirectorJsonJob` LLM runner.

## Global Constraints

- Branch: `director-page-redesign`. No sub-branches, no merge, no PR.
- Never `git add .` — add only the task's own files. `.playwright-mcp/` is gitignored.
- Every commit message ends with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Characters-only enrichment (acting/voice); never enrich props/locations/vehicles.
- Enrichment is best-effort: on failure, generation proceeds with the `description` fallback — never block a shot.
- Enrich at generation time only; do not re-enrich when `enrichedAt` is set.
- Verify gate for every task: `npx tsc --noEmit -p tsconfig.json` exits 0 AND `npx vitest run tests/lib/director/` stays green (currently 145 passing; grows as tasks add tests).

---

## File Structure

- **Modify** `src/types/director.ts` — add `enrichedAt?: number` to `DirectorBreakdownItem`.
- **Modify** `src/lib/director/llm-jobs.ts` — add `BREAKDOWN_IDENTIFY_SYSTEM_PROMPT`.
- **Create** `src/lib/director/enrich.ts` — `ENRICH_CHARACTER_SYSTEM_PROMPT`, `buildEnrichInput`, `parseEnrichResult`.
- **Create** `tests/lib/director/enrich.test.ts`.
- **Modify** `src/lib/director/job-inputs.ts` — `breakdownJobInput` optional scene scope.
- **Modify** `tests/lib/director/prompts.test.ts` — assert identify prompt omits actingProfile/voice; add job-input scope test (or a new small test file).
- **Modify** `src/components/director/director-tab.tsx` — breakdown uses identify prompt + scoped input; `enrichCharacter` + `generateOne` pre-step.

---

## Task 1: Data model — `enrichedAt` on `DirectorBreakdownItem`

**Files:**
- Modify: `src/types/director.ts` (inside `interface DirectorBreakdownItem`, after `voice?`)

**Interfaces:**
- Produces: `DirectorBreakdownItem.enrichedAt?: number`.

- [ ] **Step 1: Add the field**

In `src/types/director.ts`, in `interface DirectorBreakdownItem`, immediately after the `voice?: string;` line, add:

```ts
  /** When the lazy per-character enrichment (actingProfile+voice) was written. */
  enrichedAt?: number;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/types/director.ts
git commit -m "feat(director): add enrichedAt to DirectorBreakdownItem

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `BREAKDOWN_IDENTIFY_SYSTEM_PROMPT`

**Files:**
- Modify: `src/lib/director/llm-jobs.ts` (add a new export after `BREAKDOWN_SYSTEM_PROMPT`)
- Test: `tests/lib/director/prompts.test.ts` (add assertions)

**Interfaces:**
- Produces: `export const BREAKDOWN_IDENTIFY_SYSTEM_PROMPT: string`.

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/director/prompts.test.ts` (import the new constant at the top alongside existing imports: `import { BREAKDOWN_IDENTIFY_SYSTEM_PROMPT, BREAKDOWN_SYSTEM_PROMPT } from '@/lib/director/llm-jobs';`):

```ts
describe('BREAKDOWN_IDENTIFY_SYSTEM_PROMPT', () => {
  it('drops the per-character profile prose (fast identify pass)', () => {
    expect(BREAKDOWN_IDENTIFY_SYSTEM_PROMPT).not.toMatch(/actingProfile/i);
    expect(BREAKDOWN_IDENTIFY_SYSTEM_PROMPT).not.toMatch(/\bvoice\b/i);
  });
  it('keeps the exhaustive extraction mandate', () => {
    expect(BREAKDOWN_IDENTIFY_SYSTEM_PROMPT).toMatch(/EXTRACTION COMPLETENESS/);
    expect(BREAKDOWN_IDENTIFY_SYSTEM_PROMPT).toMatch(/VEHICLES/);
  });
  it('the full BREAKDOWN_SYSTEM_PROMPT still asks for profiles', () => {
    expect(BREAKDOWN_SYSTEM_PROMPT).toMatch(/actingProfile/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lib/director/prompts.test.ts`
Expected: FAIL — `BREAKDOWN_IDENTIFY_SYSTEM_PROMPT` not exported.

- [ ] **Step 3: Implement**

In `src/lib/director/llm-jobs.ts`, directly AFTER the `BREAKDOWN_SYSTEM_PROMPT` definition (it ends with `Do not write shotlists or prompts.\`;`), add:

```ts
export const BREAKDOWN_IDENTIFY_SYSTEM_PROMPT = `You break a script or idea into a production bible for CineGen Director. This is the FAST IDENTIFY pass: list every asset and scene. Do NOT write acting profiles, voices, or deep event prose — those are written later.

Return ONLY JSON with this shape:
{
  "items": [
    {
      "kind": "character"|"location"|"prop"|"vehicle",
      "name": "Dr Jordan",
      "tag": "@Dr-Jordan",
      "description": "one or two concrete sentences: what it looks like / who they are",
      "blurb": "where it is used"
    }
  ],
  "scenes": [
    { "number": 1, "label": "SCENE 1 — ARRIVAL", "summary": "one sentence" }
  ]
}
EXTRACTION COMPLETENESS — this is the most important rule. Read the ENTIRE script start to finish and extract EVERY nameable entity. A breakdown that misses items is a failed breakdown. Do a second pass before answering and add anything you skipped. Err on the side of over-including: a borderline item belongs in the list.
Cover, exhaustively, in every scene:
- CHARACTERS: every person or creature, named OR unnamed — leads, minor speakers, and background/collective groups ("dozens of soldiers", "a lone armored warrior", "the crowd"). Give un-named groups a descriptive name (e.g. "Clashing Soldiers", "Human Warrior"). Do not list only the leads.
- LOCATIONS: every distinct place or setting, including sub-areas ("the clearing within the battlefield" is its own location). Record time of day and INT/EXT from the scene heading in the description (e.g. "EXT, DAY").
- PROPS: every physical object, INCLUDING (a) objects characters handle or wield — weapons, tools, banners; (b) worn items — armor, costume, helmets, cloaks, jewelry; (c) set dressing and furniture — sofas, tables, shelves, lamps, rugs (a furnished room implies its furniture); (d) notable atmospheric or FX elements when they are concrete story objects — an energy-spear's blade, a signal flare. Weapons, armor, and clothing are frequently missed — always scan for them.
- VEHICLES: every mount or conveyance — cars, ships, aircraft, and RIDDEN ANIMALS (a horse a character rides is a vehicle, the animal itself may also warrant a character entry if it acts).
No duplicates: if the same entity appears in several scenes, emit ONE item. Merge trivial variants ("the sofa" / "leather sofa" → one prop).
Keep each description short and factual. Match existing element names when they are provided. Use @Tags in Pascal-case-with-hyphens.
Do not write shotlists, prompts, acting profiles, or voices.`;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/lib/director/prompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/director/llm-jobs.ts tests/lib/director/prompts.test.ts
git commit -m "feat(director): fast identify-only breakdown system prompt

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `enrich.ts` — per-character enrichment builders + parser

**Files:**
- Create: `src/lib/director/enrich.ts`
- Test: `tests/lib/director/enrich.test.ts`

**Interfaces:**
- Consumes: `ACTING_AXIOM`, `ACTING_PROFILE_DOCTRINE`, `VOICE_DOCTRINE` from `@/lib/director/craft`; `extractJsonValue` from `@/lib/director/llm-jobs`; `DirectorBreakdownItem`, `DirectorScene` from `@/types/director`; `parseToScreenplay`/`splitScenes`, `detectSceneAssets`.
- Produces:
  - `ENRICH_CHARACTER_SYSTEM_PROMPT: string`
  - `buildEnrichInput(item: DirectorBreakdownItem, sourceText: string): string`
  - `parseEnrichResult(raw: unknown): { actingProfile?: string; voice?: string }`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/director/enrich.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildEnrichInput, parseEnrichResult, ENRICH_CHARACTER_SYSTEM_PROMPT } from '@/lib/director/enrich';
import type { DirectorBreakdownItem } from '@/types/director';

const item = (o: Partial<DirectorBreakdownItem>): DirectorBreakdownItem =>
  ({ id: 'i', kind: 'character', name: 'Dr Jordan', tag: '@Dr-Jordan', description: 'a weary scientist', ...o });

describe('ENRICH_CHARACTER_SYSTEM_PROMPT', () => {
  it('asks for a single character actingProfile + voice as JSON', () => {
    expect(ENRICH_CHARACTER_SYSTEM_PROMPT).toMatch(/actingProfile/);
    expect(ENRICH_CHARACTER_SYSTEM_PROMPT).toMatch(/voice/);
  });
});

describe('buildEnrichInput', () => {
  it('includes the character name/description and the scenes they appear in', () => {
    const src = 'INT. LAB - DAY\nDr Jordan studies a vial.\n\nEXT. PARK - DAY\nBirds sing.';
    const body = buildEnrichInput(item({}), src);
    expect(body).toMatch(/Dr Jordan/);
    expect(body).toMatch(/weary scientist/);
    expect(body).toMatch(/INT\. LAB - DAY/);       // scene they appear in
    expect(body).not.toMatch(/EXT\. PARK - DAY/);  // scene they do NOT appear in
  });
});

describe('parseEnrichResult', () => {
  it('extracts actingProfile and voice from clean JSON', () => {
    const r = parseEnrichResult({ actingProfile: 'holds still, watches', voice: 'low, measured' });
    expect(r.actingProfile).toBe('holds still, watches');
    expect(r.voice).toBe('low, measured');
  });
  it('tolerates missing voice', () => {
    const r = parseEnrichResult({ actingProfile: 'x' });
    expect(r.actingProfile).toBe('x');
    expect(r.voice).toBeUndefined();
  });
  it('returns {} on non-object', () => {
    expect(parseEnrichResult('nope')).toEqual({});
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lib/director/enrich.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/director/enrich.ts`:

```ts
import { ACTING_AXIOM, ACTING_PROFILE_DOCTRINE, VOICE_DOCTRINE } from '@/lib/director/craft';
import { parseToScreenplay } from '@/lib/director/screenplay';
import { splitScenes } from '@/lib/director/scene-split';
import { detectSceneAssets } from '@/lib/director/scene-assets';
import type { DirectorBreakdownItem } from '@/types/director';

export const ENRICH_CHARACTER_SYSTEM_PROMPT = `You write the acting and voice profile for ONE character in a film.

${ACTING_AXIOM}

${ACTING_PROFILE_DOCTRINE}

${VOICE_DOCTRINE}

Return ONLY JSON:
{ "actingProfile": "the master profile paragraph — observable behaviour", "voice": "the locked voice prompt, in quotes" }
No prose outside the JSON.`;

/** Character name/description + the text of the scenes they appear in, as context. */
export function buildEnrichInput(item: DirectorBreakdownItem, sourceText: string): string {
  const scenes = splitScenes(parseToScreenplay(sourceText));
  const appearsIn = scenes.filter((sc) =>
    detectSceneAssets(sc, [item]).some((h) => h.name === item.name),
  );
  const sceneText = appearsIn
    .map((sc) => `${sc.heading}\n${sc.elements.map((e) => e.text).join('\n')}`)
    .join('\n\n');
  return `CHARACTER: ${item.name}\nDESCRIPTION: ${item.description}\n\nSCENES THEY APPEAR IN:\n${sceneText || '(none found — infer from the description)'}`;
}

export function parseEnrichResult(raw: unknown): { actingProfile?: string; voice?: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: { actingProfile?: string; voice?: string } = {};
  if (typeof r.actingProfile === 'string' && r.actingProfile.trim()) out.actingProfile = r.actingProfile.trim();
  if (typeof r.voice === 'string' && r.voice.trim()) out.voice = r.voice.trim();
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/lib/director/enrich.test.ts`
Expected: PASS (6 assertions across 5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/director/enrich.ts tests/lib/director/enrich.test.ts
git commit -m "feat(director): per-character enrichment prompt + builders

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `breakdownJobInput` — optional scene scope

**Files:**
- Modify: `src/lib/director/job-inputs.ts:22-29` (`breakdownJobInput`)
- Test: `tests/lib/director/prompts.test.ts` (add a describe block) — or create `tests/lib/director/job-inputs.test.ts`

**Interfaces:**
- Consumes: `splitScenes`/`parseToScreenplay`; `DirectorShow`.
- Produces: `breakdownJobInput(show: DirectorShow, existingElements: string, scope?: { sceneIds: string[] }): string`. When `scope` is provided, the SCRIPT section contains only the changed scenes' text (matched from `show.scenes` ids → their label → the parsed scene with that heading), under `SCRIPT (changed scenes only):`. When absent, unchanged (full `show.sourceText`).

- [ ] **Step 1: Write the failing test**

Create `tests/lib/director/job-inputs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { breakdownJobInput } from '@/lib/director/job-inputs';
import type { DirectorShow, DirectorScene } from '@/types/director';

const show = (over: Partial<DirectorShow>): DirectorShow => ({
  sourceText: '', clipLengthSec: 10, stylePrefix: '', lookBible: {} as never,
  aspectRatio: '16:9', adapterId: '', resolution: '', generateAudio: false,
  genre: '', mode: 'source', breakdown: [], breakdownApproved: false,
  scenes: [], clips: [], ...over,
} as DirectorShow);

const SRC = 'INT. OFFICE - DAY\nDr Jordan enters.\n\nEXT. STREET - NIGHT\nHe walks fast.';
const SCENES: DirectorScene[] = [
  { id: 's1', number: 1, label: 'INT. OFFICE - DAY', summary: '', elementIds: [], clipIds: [] },
  { id: 's2', number: 2, label: 'EXT. STREET - NIGHT', summary: '', elementIds: [], clipIds: [] },
];

describe('breakdownJobInput', () => {
  it('sends the full script when no scope', () => {
    const body = breakdownJobInput(show({ sourceText: SRC }), 'none');
    expect(body).toMatch(/Dr Jordan enters/);
    expect(body).toMatch(/He walks fast/);
  });
  it('sends only the changed scene text when scoped', () => {
    const body = breakdownJobInput(show({ sourceText: SRC, scenes: SCENES }), 'none', { sceneIds: ['s1'] });
    expect(body).toMatch(/changed scenes only/i);
    expect(body).toMatch(/Dr Jordan enters/);   // scene s1 kept
    expect(body).not.toMatch(/He walks fast/);  // scene s2 omitted
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lib/director/job-inputs.test.ts`
Expected: FAIL — `breakdownJobInput` rejects a 3rd arg / test assertion fails.

- [ ] **Step 3: Implement**

Replace `breakdownJobInput` in `src/lib/director/job-inputs.ts` (currently lines 22-29):

```ts
import { parseToScreenplay } from './screenplay';
import { splitScenes } from './scene-split';

export function breakdownJobInput(
  show: DirectorShow,
  existingElements: string,
  scope?: { sceneIds: string[] },
): string {
  let scriptSection = `SCRIPT:\n${show.sourceText}`;
  if (scope) {
    // Map changed DirectorScene ids → their labels → the parsed scenes with that heading.
    const labels = new Set(
      show.scenes.filter((s) => scope.sceneIds.includes(s.id)).map((s) => s.label.trim().toUpperCase()),
    );
    const parsed = splitScenes(parseToScreenplay(show.sourceText));
    const changed = parsed.filter((sc) => labels.has(sc.heading.trim().toUpperCase()));
    const text = changed
      .map((sc) => sc.elements.map((e) => e.text).join('\n'))
      .join('\n\n');
    scriptSection = `SCRIPT (changed scenes only):\n${text}`;
  }
  return [
    `Clip length setting: ${show.clipLengthSec}s.`,
    `Existing elements: ${existingElements || 'none'}`,
    '',
    scriptSection,
  ].join('\n');
}
```

Add the two imports at the top of `job-inputs.ts` if not already present (`compiledLookFromRefs, compileLookBible` are already imported; add `parseToScreenplay` and `splitScenes`).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/lib/director/job-inputs.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Regression**

Run: `npx vitest run tests/lib/director/ && npx tsc --noEmit -p tsconfig.json`
Expected: all green; tsc 0. (Existing `breakdownJobInput` callers pass 2 args — still valid.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/director/job-inputs.ts tests/lib/director/job-inputs.test.ts
git commit -m "feat(director): scene-scoped breakdown job input

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Wire identify prompt + scoped input + lazy enrich into DirectorTab

**Files:**
- Modify: `src/components/director/director-tab.tsx` — `runBreakdown` (uses identify prompt + scoped input); add `enrichCharacter`; `generateOne` pre-step.

**Interfaces:**
- Consumes: `BREAKDOWN_IDENTIFY_SYSTEM_PROMPT` (Task 2); `ENRICH_CHARACTER_SYSTEM_PROMPT`, `buildEnrichInput`, `parseEnrichResult` (Task 3); scoped `breakdownJobInput` (Task 4); existing `runDirectorJsonJob`, `parseDirectorLlmProvider`, `showRef`, `setShow`.

- [ ] **Step 1: Point runBreakdown at the identify prompt + scoped input**

In `director-tab.tsx`, change the import of the breakdown prompt to also bring in the identify prompt:
```ts
import { BREAKDOWN_SYSTEM_PROMPT, BREAKDOWN_IDENTIFY_SYSTEM_PROMPT } from '@/lib/director/llm-jobs';
```
(keep whatever other names are already imported from that module.)

In `runBreakdown`, replace the `runDirectorJsonJob(BREAKDOWN_SYSTEM_PROMPT, breakdownJobInput(current, existing) + scopeNote, ...)` call so it uses the identify prompt and passes the scope object to `breakdownJobInput` (drop the freeform `scopeNote` string in favor of the real scoped input):

```ts
    const scopeArg = scope === 'all' ? undefined : { sceneIds: scope.sceneIds };
    const payload = await runDirectorJsonJob(
      BREAKDOWN_IDENTIFY_SYSTEM_PROMPT,
      breakdownJobInput(current, existing, scopeArg),
      parseDirectorLlmProvider(current.llmProvider),
      requestId,
      signal,
    );
```

Leave the rest of `runBreakdown` (merge, setShow, abort/error handling) unchanged.

- [ ] **Step 2: Add `enrichCharacter`**

Add an in-flight guard ref near the other refs at the top of `DirectorTab`:
```ts
const enrichingTags = useRef<Set<string>>(new Set());
```
Add these imports:
```ts
import { ENRICH_CHARACTER_SYSTEM_PROMPT, buildEnrichInput, parseEnrichResult } from '@/lib/director/enrich';
```
Add the callback (place it before `generateOne`):

```ts
const enrichCharacter = useCallback(async (tag: string): Promise<void> => {
  const cur = showRef.current;
  const item = cur.breakdown.find((b) => b.tag === tag && b.kind === 'character');
  if (!item || item.enrichedAt || item.actingProfile?.trim()) return;
  if (enrichingTags.current.has(tag)) return;
  enrichingTags.current.add(tag);
  try {
    const payload = await runDirectorJsonJob(
      ENRICH_CHARACTER_SYSTEM_PROMPT,
      buildEnrichInput(item, cur.sourceText),
      parseDirectorLlmProvider(cur.llmProvider),
    );
    const { actingProfile, voice } = parseEnrichResult(payload);
    const now = Date.now();
    setShow({
      ...showRef.current,
      breakdown: showRef.current.breakdown.map((b) =>
        b.tag === tag ? { ...b, actingProfile: actingProfile ?? b.actingProfile, voice: voice ?? b.voice, enrichedAt: now } : b,
      ),
    });
  } catch {
    // best-effort: leave the item un-enriched; generation falls back to description
  } finally {
    enrichingTags.current.delete(tag);
  }
}, [setShow]);
```

- [ ] **Step 3: Enrich a clip's characters before generating**

In `generateOne`, right after `if (!clip || !scene) return;` and BEFORE `const prepared = prepareDirectorGeneration(...)`, insert:

```ts
  // Lazily fill in acting profiles/voices for this clip's characters (best-effort).
  const charTags = current.breakdown
    .filter((b) => b.kind === 'character' && clip.elementTags.includes(b.tag) && !b.enrichedAt && !b.actingProfile?.trim())
    .map((b) => b.tag);
  for (const tag of charTags) await enrichCharacter(tag);
  const fresh = showRef.current; // re-read after enrich commits
  const freshScene = fresh.scenes.find((entry) => entry.id === clip.sceneId) ?? scene;
```

Then change the `prepareDirectorGeneration` call to use the fresh show/scene:
```ts
  const prepared = prepareDirectorGeneration({
    show: fresh,
    scene: freshScene,
    clip,
    folders: foldersRef.current,
  });
```
Add `enrichCharacter` to `generateOne`'s `useCallback` dependency array.

- [ ] **Step 4: Typecheck + tests**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run tests/lib/director/`
Expected: tsc 0; director tests green (145+). Fix any call-site/type issues surfaced.

- [ ] **Step 5: Commit**

```bash
git add src/components/director/director-tab.tsx
git commit -m "feat(director): fast identify breakdown + scoped input + lazy character enrich

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Manual live verification (no automated step)

**Files:** none.

- [ ] **Step 1: Verify speed + lazy enrich end-to-end**

Web dev on :5174 (`npm --prefix web run dev` if down). Open the project → Director:
1. Upload / create a script → the breakdown populates noticeably FASTER than before (no per-character profile prose in the identify call).
2. Open a breakdown character card → `actingProfile`/`voice` are EMPTY initially (identify pass only).
3. Generate a clip that features a character → a brief enrich runs for that character; afterward its breakdown item has `actingProfile`/`voice` and `enrichedAt` set; a second generate for the same character does NOT re-enrich.
4. Edit ONE scene → the breakdown re-run sends only that scene (faster); other scenes' assets preserved.
5. Force an enrich failure (e.g. offline) → generation still proceeds using the description; no blocking error.

- [ ] **Step 2: Record result in the ledger**

Append pass/fail + notes to `.superpowers/sdd/progress.md`.

---

## Self-Review

**Spec coverage:** identify prompt (T2), scene-scoped input (T4), lazy enrich builders (T3) + trigger at generation (T5), `enrichedAt` model (T1), description fallback + best-effort (T5 catch), characters-only (T5 filter on `kind==='character'`), sequential unchanged (untouched), tests (T2/T3/T4). Non-goals respected (no background pass, no re-enrich when set, no prop/location enrich).

**Placeholder scan:** every code step carries full code; commands have expected output. No TBD/TODO.

**Type consistency:** `buildEnrichInput(item, sourceText)` and `parseEnrichResult(raw)` identical in T3 and T5. `breakdownJobInput(show, existing, scope?)` identical in T4 and T5. `enrichCharacter(tag): Promise<void>` and the `enrichingTags` ref consistent within T5. `BREAKDOWN_IDENTIFY_SYSTEM_PROMPT` name consistent T2/T5.

**Note (carried, non-blocking):** the current `runBreakdown` builds a freeform `scopeNote` string appended to the job input (from the cascade work); Task 5 Step 1 replaces that with the real scoped `breakdownJobInput` argument — the implementer must remove the now-dead `scopeNote` local so tsc (unused) / review stays clean.
