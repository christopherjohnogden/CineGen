# Faster Breakdown: Two-Phase Identify + Lazy Enrich — Design

**Status:** Approved (pending spec review)
**Branch:** `director-page-redesign`
**Date:** 2026-08-19

## Goal

Make "Breaking down script…" fast. Today one breakdown LLM call both
identifies every asset AND writes a rich acting-profile + locked-voice
paragraph for every character — the profile prose is the dominant latency
cost (output tokens). Split it: a fast IDENTIFY pass populates the breakdown
tab; the rich per-character profiles are written lazily, on demand, only for
characters actually generated. Also send only the changed scene's text to the
breakdown on incremental cascade edits.

## Decisions (locked in brainstorming)

| Question | Decision |
|---|---|
| Speed lever | Two-phase: fast identify list, lazy per-character profiles |
| Edit scope input | Incremental edit sends only the changed scene(s) text |
| Concurrency | Breakdown → shotlist stay sequential (shotlist depends on breakdown) |
| Enrich trigger | At generation time, auto — first time a clip with that character generates |
| Fallback before enrich | Generation uses the short `description` until the rich profile exists |

## Architecture & data flow

**Phase A — Identify (fast, always):** the breakdown call returns only
`{ kind, name, tag, description }` per asset + the scene list. No
`actingProfile` / `voice` / deep event prose. System prompt = current breakdown
prompt MINUS the acting-profile, voice, and scene-event doctrine blocks (those
stay in shotlist/generation prompts where they are consumed). Keeps the
exhaustiveness rules and JSON shape (without actingProfile/voice). Fewer output
tokens → the breakdown tab populates in a fraction of the time.

**Phase B — Enrich (lazy, per-character):** a character's `actingProfile` +
`voice` are written the first time a clip featuring that character is generated,
then cached on the breakdown item (`enrichedAt` set). A dedicated small LLM call
using the acting/voice doctrines. Until then, generation falls back to the
character's short `description`. Never blocks a shot.

**Scene-scoped input:** for an incremental cascade edit (scope
`{ sceneIds }`), `breakdownJobInput` sends only the changed scenes' text, not
full `sourceText`. `mergeBreakdownItems` already preserves untouched scenes'
assets. The first/whole run (scope `'all'`) still sends the full script.

Sequence unchanged: breakdown → shotlist (sequential).

## Components

### `src/lib/director/llm-jobs.ts`
- Add `BREAKDOWN_IDENTIFY_SYSTEM_PROMPT`: the current `BREAKDOWN_SYSTEM_PROMPT`
  with the `${ACTING_AXIOM}`, `${ACTING_PROFILE_DOCTRINE}`, `${VOICE_DOCTRINE}`,
  `${SCENE_EVENT_DOCTRINE}` blocks removed and the JSON-shape example trimmed to
  `{ kind, name, tag, description }` items + scenes without `event`/`physicalAction`
  prose requirements. Keep the completeness mandate (characters incl. unnamed,
  locations, props incl. worn/weapons, vehicles incl. mounts) and the tag/format
  rules. `BREAKDOWN_SYSTEM_PROMPT` stays exported (unused by the cascade path but
  retained for any full path / tests).

### `src/lib/director/enrich.ts` (new, pure builders + parser)
- `ENRICH_CHARACTER_SYSTEM_PROMPT` — instructs the model to write ONE
  `actingProfile` paragraph and ONE locked `voice` line for a single named
  character, using the acting/voice doctrines. JSON out:
  `{ "actingProfile": "...", "voice": "..." }`.
- `buildEnrichInput(item: DirectorBreakdownItem, scenes: DirectorScene[], sourceText: string): string`
  — the character's name/description + the scenes they appear in (matched by
  name via the existing detect logic) as context.
- `parseEnrichResult(raw: unknown): { actingProfile?: string; voice?: string }`
  — extract-json + tolerant field pull; both optional (missing → undefined).

### `src/lib/director/job-inputs.ts`
- `breakdownJobInput(show, existingElements, scope?: { sceneIds: string[] })`:
  when `scope` is given, resolve the changed scenes (map ids → `ScriptScene`
  via the scenes array / split), and send only those scenes' text under
  `SCRIPT (changed scenes only):`. When absent, send full `sourceText` as today.

### `src/components/director/director-tab.tsx`
- `runBreakdown` uses `BREAKDOWN_IDENTIFY_SYSTEM_PROMPT` and, when
  `scope !== 'all'`, passes the scope to `breakdownJobInput`.
- New `enrichCharacter(tag)`: if the item has no `enrichedAt` and no in-flight
  enrich for that tag, run `runDirectorJsonJob(ENRICH_CHARACTER_SYSTEM_PROMPT,
  buildEnrichInput(...), provider, requestId)`, parse, and `setShow` the item
  with `{ actingProfile, voice, enrichedAt: Date.now() }` (id/tag-based
  immutable update). In-flight guard: a `Set<string>` ref of tags.
- `generateOne`: before preparing generation, determine the clip's characters as
  the breakdown items with `kind === 'character'` whose `tag` is in
  `clip.elementTags`. For each such item whose `actingProfile` is empty AND
  `enrichedAt` is unset, await `enrichCharacter(tag)` (best-effort — on failure
  proceed with the `description` fallback). Then proceed unchanged. Because
  `enrichCharacter` commits via `setShow`, re-read `showRef.current` after the
  awaited enrich(es) so `prepareDirectorGeneration` sees the freshly-written
  profiles.

## Data model (`src/types/director.ts`)

`DirectorBreakdownItem` already has optional `actingProfile?` and `voice?`.
Add one field:
```ts
  /** When the lazy per-character enrichment (actingProfile+voice) was written. */
  enrichedAt?: number;
```
Persists via the existing opaque `director` JSON blob. No other model change.

## Error handling

- Enrich failure → generation proceeds using the `description` fallback; error
  is logged, not surfaced. Never blocks a shot.
- Identify-phase failure → existing `failJob` behavior; the cascade loop-guard
  (attemptedSig) already prevents auto-retry storms.
- In-flight enrich guard prevents duplicate enrich calls for the same character
  when back-to-back clips generate.

## Testing

- `enrich.ts`: `buildEnrichInput` includes the character name + at least one
  scene it appears in; excludes unrelated scenes. `parseEnrichResult` extracts
  both fields from clean JSON, tolerates missing `voice` (→ undefined), and
  falls back to `{}` on non-JSON.
- `job-inputs.ts`: `breakdownJobInput` with `scope` omits untouched scenes'
  text and includes the changed scene's; without scope sends the full script.
- Prompt test: `BREAKDOWN_IDENTIFY_SYSTEM_PROMPT` does NOT contain
  "actingProfile" or "voice" and DOES keep the completeness mandate; the full
  `BREAKDOWN_SYSTEM_PROMPT` still does (unchanged).

## Non-goals (YAGNI)

- No background enrichment pass (only at generation time).
- No re-enrich on script edits (only when `actingProfile` missing / `enrichedAt`
  unset).
- No enrichment for props/locations/vehicles — characters only (matches today's
  acting/voice scope).
- No model-tier change in this spec (a faster model is a separate lever, not
  chosen here).
