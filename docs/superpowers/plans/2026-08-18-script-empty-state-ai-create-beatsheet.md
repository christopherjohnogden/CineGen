# Script Empty State, AI Creation & Beat Sheets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Script-tab empty state (Upload / New Screenplay / New Beat Sheet + AI prompt), an AI creation flow (brainstorm vs draft), and a distinct beat-sheet document type whose beats feed the existing breakdown→shotlist→generate pipeline via a serialized `sourceText` mirror.

**Architecture:** A pure `beatsheet.ts` (Beat model + serialize + renumber). `DirectorShow` gains `docKind` + `beatSheet`. The assistant contract extends with `beatEdits`/`applyBeatEdits` and a beat-sheet system prompt. New components: an empty state (two-step in-place flow) and a beat-sheet card editor. `director-script-tab.tsx` routes by content/`docKind`; the chat gets docKind + mode. Coherence rule: the active structured store (`sourceElements` for screenplay, `beatSheet` for beat sheet) is authoritative; `sourceText` is always written together with it, so the pipeline is unchanged.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest (`@/` → `src/`), existing `director-tab.css`.

## Global Constraints

- Test runner: `npx vitest run <path>`; full-project typecheck gate `npx tsc --noEmit -p tsconfig.json` must stay clean.
- Pure modules (`beatsheet.ts`, assistant contract additions) unit-tested TDD (failing test first).
- Beat model (verbatim): `Beat { id; n; action; location; shot; duration?; mood? }`; `BeatSheet { beats: Beat[] }`.
- `DirectorShow` additive optional fields: `docKind?: 'screenplay' | 'beatsheet'` (absent = screenplay); `beatSheet?: BeatSheet`.
- Coherence rule: whichever structured store is active is authoritative; every edit writes it AND `serialize→sourceText` from the same data. Only one structured store active per docKind. Breakdown/shotlist/generate read `sourceText` — DO NOT change them.
- Beat-edit contract (verbatim): `BeatEdit { op: 'replace'|'insert-after'|'delete'; targetBeatId?; beats? }`; `AssistantResponse` gains optional `beatEdits?: BeatEdit[]`.
- Reuse: `Screenplay`/`ScreenplayElement` from `@/lib/director/screenplay`; `generateId` from `@/lib/utils/ids`; existing `AssistantEdit`/`AssistantResponse`/`parseAssistantResponse`/`buildAssistantMessage`/`applyAssistantEdits`/`SCRIPT_ASSISTANT_SYSTEM_PROMPT` in `@/lib/director/script-assistant`; `invokeCliCopilotChat` from `@/lib/llm/cli-copilot-client`.
- `git add` only each task's files; never `git add .` (`.playwright-mcp/` is gitignored scratch).
- Commit after every task.

---

### Task 1: Beat-sheet model (`beatsheet.ts`)

**Files:**
- Create: `src/lib/director/beatsheet.ts`
- Test: `tests/lib/director/beatsheet.test.ts`

**Interfaces:**
- Consumes: `generateId` from `@/lib/utils/ids`.
- Produces:
  ```ts
  export interface Beat { id: string; n: number; action: string; location: string; shot: string; duration?: number; mood?: string }
  export interface BeatSheet { beats: Beat[] }
  export function emptyBeatSheet(): BeatSheet;
  export function renumberBeats(beats: Beat[]): Beat[];
  export function serializeBeatSheet(bs: BeatSheet): string;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/lib/director/beatsheet.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { emptyBeatSheet, renumberBeats, serializeBeatSheet, type Beat } from '@/lib/director/beatsheet';

const beat = (over: Partial<Beat>): Beat => ({ id: over.id ?? 'b', n: over.n ?? 1, action: '', location: '', shot: '', ...over });

describe('emptyBeatSheet', () => {
  it('is a beat sheet with no beats', () => {
    expect(emptyBeatSheet()).toEqual({ beats: [] });
  });
});

describe('renumberBeats', () => {
  it('assigns sequential n from 1', () => {
    const out = renumberBeats([beat({ id: 'a', n: 5 }), beat({ id: 'b', n: 9 }), beat({ id: 'c', n: 2 })]);
    expect(out.map((b) => b.n)).toEqual([1, 2, 3]);
    expect(out.map((b) => b.id)).toEqual(['a', 'b', 'c']); // order preserved, only n changes
  });
});

describe('serializeBeatSheet', () => {
  it('emits a labeled block per beat with location, duration, mood, action, shot', () => {
    const bs = { beats: [beat({
      id: 'a', n: 1, action: 'She returns the wallet.', location: 'INT. ALLEY', shot: 'Handheld medium.', duration: 12, mood: 'tense',
    })] };
    const text = serializeBeatSheet(bs);
    expect(text).toMatch(/BEAT 1 — INT\. ALLEY \(12s, tense\)/);
    expect(text).toMatch(/Action: She returns the wallet\./);
    expect(text).toMatch(/Shot: Handheld medium\./);
  });

  it('omits empty optional fields and empty lines', () => {
    const bs = { beats: [beat({ id: 'a', n: 1, action: 'A city wakes.', location: 'EXT. CITY' })] };
    const text = serializeBeatSheet(bs);
    expect(text).toMatch(/BEAT 1 — EXT\. CITY$/m);   // no "(…)" when no duration/mood
    expect(text).not.toMatch(/Shot:/);               // no empty Shot line
  });

  it('skips beats whose fields are all empty', () => {
    const bs = { beats: [beat({ id: 'a', n: 1 }), beat({ id: 'b', n: 2, action: 'Real.' })] };
    const text = serializeBeatSheet(bs);
    expect(text).toMatch(/Action: Real\./);
    expect(text).not.toMatch(/BEAT 1/); // the all-empty beat is skipped
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/director/beatsheet.test.ts`
Expected: FAIL — cannot resolve `@/lib/director/beatsheet`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/director/beatsheet.ts`:

```ts
export interface Beat {
  id: string;
  n: number;
  action: string;
  location: string;
  shot: string;
  duration?: number;
  mood?: string;
}
export interface BeatSheet { beats: Beat[] }

export function emptyBeatSheet(): BeatSheet {
  return { beats: [] };
}

export function renumberBeats(beats: Beat[]): Beat[] {
  return beats.map((b, i) => ({ ...b, n: i + 1 }));
}

function beatIsEmpty(b: Beat): boolean {
  return !b.action.trim() && !b.location.trim() && !b.shot.trim() && !(b.mood ?? '').trim() && b.duration == null;
}

export function serializeBeatSheet(bs: BeatSheet): string {
  const blocks: string[] = [];
  for (const b of bs.beats) {
    if (beatIsEmpty(b)) continue;
    const meta = [b.duration != null ? `${b.duration}s` : '', (b.mood ?? '').trim()].filter(Boolean).join(', ');
    const head = `BEAT ${b.n} — ${b.location.trim()}${meta ? ` (${meta})` : ''}`;
    const lines = [head];
    if (b.action.trim()) lines.push(`Action: ${b.action.trim()}`);
    if (b.shot.trim()) lines.push(`Shot: ${b.shot.trim()}`);
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/director/beatsheet.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/director/beatsheet.ts tests/lib/director/beatsheet.test.ts
git commit -m "feat(director): beat-sheet model (Beat, serialize, renumber)"
```

---

### Task 2: Assistant beat-edit contract (`script-assistant.ts`)

**Files:**
- Modify: `src/lib/director/script-assistant.ts`
- Test: `tests/lib/director/beat-assistant.test.ts`

**Interfaces:**
- Consumes: `Beat`/`BeatSheet` from `@/lib/director/beatsheet`.
- Produces:
  ```ts
  export interface BeatEdit { op: 'replace' | 'insert-after' | 'delete'; targetBeatId?: string; beats?: Beat[] }
  // AssistantResponse gains: beatEdits?: BeatEdit[]
  export const BEATSHEET_ASSISTANT_SYSTEM_PROMPT: string;
  export function buildBeatsheetMessage(bs: BeatSheet, userText: string, selection?: { beatId?: string }): string;
  export function applyBeatEdits(bs: BeatSheet, edits: BeatEdit[]): BeatSheet;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/lib/director/beat-assistant.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseAssistantResponse, applyBeatEdits, buildBeatsheetMessage, type BeatEdit } from '@/lib/director/script-assistant';
import type { BeatSheet } from '@/lib/director/beatsheet';

const bs: BeatSheet = { beats: [
  { id: 'b1', n: 1, action: 'Old action.', location: 'INT. A', shot: '' },
  { id: 'b2', n: 2, action: 'Second.', location: 'EXT. B', shot: '' },
] };

describe('parseAssistantResponse beatEdits', () => {
  it('parses a reply with beatEdits', () => {
    const raw = JSON.stringify({ reply: 'Added a beat.', beatEdits: [
      { op: 'insert-after', targetBeatId: 'b1', beats: [{ id: 'n1', n: 0, action: 'New.', location: 'INT. C', shot: '' }] },
    ] });
    const res = parseAssistantResponse(raw);
    expect(res.reply).toBe('Added a beat.');
    expect(res.beatEdits).toHaveLength(1);
    expect(res.beatEdits![0].op).toBe('insert-after');
  });
  it('malformed → plain reply, no beatEdits', () => {
    const res = parseAssistantResponse('just prose');
    expect(res.beatEdits).toBeUndefined();
  });
});

describe('applyBeatEdits', () => {
  it('replaces a beat by id', () => {
    const next = applyBeatEdits(bs, [{ op: 'replace', targetBeatId: 'b1', beats: [{ id: 'b1', n: 1, action: 'New.', location: 'INT. A', shot: '' }] }]);
    expect(next.beats[0].action).toBe('New.');
  });
  it('inserts after and renumbers', () => {
    const next = applyBeatEdits(bs, [{ op: 'insert-after', targetBeatId: 'b1', beats: [{ id: 'x', n: 0, action: 'Ins.', location: 'INT. C', shot: '' }] }]);
    expect(next.beats.map((b) => b.n)).toEqual([1, 2, 3]);
    expect(next.beats[1].id).toBe('x');
  });
  it('deletes by id and renumbers', () => {
    const next = applyBeatEdits(bs, [{ op: 'delete', targetBeatId: 'b1' }]);
    expect(next.beats).toHaveLength(1);
    expect(next.beats[0].n).toBe(1);
  });
});

describe('buildBeatsheetMessage', () => {
  it('includes the beats and selection', () => {
    const msg = buildBeatsheetMessage(bs, 'punch up beat 1', { beatId: 'b1' });
    expect(msg).toMatch(/b1/);
    expect(msg).toMatch(/Old action\./);
    expect(msg).toMatch(/punch up beat 1/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/director/beat-assistant.test.ts`
Expected: FAIL — `applyBeatEdits`/`buildBeatsheetMessage` not exported.

- [ ] **Step 3: Extend `script-assistant.ts`**

Add the import at the top:
```ts
import { renumberBeats, type Beat, type BeatSheet } from '@/lib/director/beatsheet';
```

Add after the `AssistantEdit`/`AssistantResponse` block (change `AssistantResponse` to include `beatEdits`):
```ts
export interface BeatEdit {
  op: 'replace' | 'insert-after' | 'delete';
  targetBeatId?: string;
  beats?: Beat[];
}
```
Change:
```ts
export interface AssistantResponse { reply: string; edits?: AssistantEdit[] }
```
to:
```ts
export interface AssistantResponse { reply: string; edits?: AssistantEdit[]; beatEdits?: BeatEdit[] }
```

Add the beat-sheet system prompt + message builder (after `buildAssistantMessage`):
```ts
export const BEATSHEET_ASSISTANT_SYSTEM_PROMPT = `You are a video beat-sheet assistant. A beat sheet has NO dialogue — it is a list of beats, each describing what happens on screen so it can become a video-generation prompt.
Each beat has an id and fields: action (what happens), location, shot (camera/framing/movement), duration (seconds, optional), mood (optional).
When the user asks you to write or change beats, return edits referencing beat ids.
Return ONLY JSON with this shape:
{
  "reply": "one short sentence",
  "beatEdits": [
    { "op": "insert-after", "targetBeatId": "<id or omit to append at start>", "beats": [ { "id": "new1", "n": 0, "action": "...", "location": "INT. ...", "shot": "...", "duration": 8, "mood": "..." } ] },
    { "op": "replace", "targetBeatId": "<id>", "beats": [ { "id": "<id>", "n": 0, "action": "...", "location": "...", "shot": "..." } ] },
    { "op": "delete", "targetBeatId": "<id>" }
  ]
}
Omit "beatEdits" entirely for a pure question/answer. Write vivid, concrete, film-able action. No dialogue. n will be renumbered automatically — set it to 0.`;

export function buildBeatsheetMessage(
  bs: BeatSheet,
  userText: string,
  selection?: { beatId?: string },
): string {
  const sheet = bs.beats.map((b) =>
    `[${b.id}] BEAT ${b.n} @ ${b.location} | action: ${b.action} | shot: ${b.shot}${b.duration != null ? ` | ${b.duration}s` : ''}${b.mood ? ` | ${b.mood}` : ''}`,
  ).join('\n');
  const sel = selection?.beatId ? `\nSELECTED BEAT: ${selection.beatId}` : '';
  return `BEAT SHEET:\n${sheet || '(empty)'}${sel}\n\nUSER:\n${userText}`;
}

export function applyBeatEdits(bs: BeatSheet, edits: BeatEdit[]): BeatSheet {
  let beats = [...bs.beats];
  for (const edit of edits) {
    const i = edit.targetBeatId ? beats.findIndex((b) => b.id === edit.targetBeatId) : -1;
    if (edit.op === 'replace' && i >= 0 && edit.beats) {
      beats = [...beats.slice(0, i), ...edit.beats, ...beats.slice(i + 1)];
    } else if (edit.op === 'insert-after' && edit.beats) {
      const at = i >= 0 ? i + 1 : 0; // no target → prepend
      beats = [...beats.slice(0, at), ...edit.beats, ...beats.slice(at)];
    } else if (edit.op === 'delete' && i >= 0) {
      beats = [...beats.slice(0, i), ...beats.slice(i + 1)];
    }
  }
  return { beats: renumberBeats(beats) };
}
```

Extend `parseAssistantResponse` to also pull `beatEdits`. Replace its body's success branch:
```ts
if (obj && typeof obj.reply === 'string') {
  const edits = Array.isArray(obj.edits) ? obj.edits.filter((e): e is AssistantEdit =>
    !!e && (e.op === 'replace' || e.op === 'insert-after' || e.op === 'delete')) : undefined;
  return { reply: obj.reply, edits: edits && edits.length ? edits : undefined };
}
```
with:
```ts
if (obj && typeof obj.reply === 'string') {
  const edits = Array.isArray(obj.edits) ? obj.edits.filter((e): e is AssistantEdit =>
    !!e && (e.op === 'replace' || e.op === 'insert-after' || e.op === 'delete')) : undefined;
  const beatEdits = Array.isArray(obj.beatEdits) ? obj.beatEdits.filter((e): e is BeatEdit =>
    !!e && (e.op === 'replace' || e.op === 'insert-after' || e.op === 'delete')) : undefined;
  return {
    reply: obj.reply,
    edits: edits && edits.length ? edits : undefined,
    beatEdits: beatEdits && beatEdits.length ? beatEdits : undefined,
  };
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/lib/director/beat-assistant.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/director/script-assistant.ts tests/lib/director/beat-assistant.test.ts
git commit -m "feat(director): beat-edit assistant contract (BeatEdit, applyBeatEdits, prompt)"
```

---

### Task 3: Data-model fields (`director.ts`)

**Files:**
- Modify: `src/types/director.ts`

**Interfaces:**
- Produces: `DirectorShow.docKind?: 'screenplay' | 'beatsheet'`; `DirectorShow.beatSheet?: BeatSheet`.

- [ ] **Step 1: Add the fields**

In `src/types/director.ts`, add the import near the existing `ScreenplayElement` import:
```ts
import type { BeatSheet } from '@/lib/director/beatsheet';
```
In `DirectorShow`, after `sourceElements?: ScreenplayElement[];` add:
```ts
  /** Which document the Script tab is editing. Absent = screenplay. */
  docKind?: 'screenplay' | 'beatsheet';
  /** Beat-sheet store (present when docKind === 'beatsheet'); kept in sync with sourceText. */
  beatSheet?: BeatSheet;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors (no import cycle — `beatsheet.ts` imports only `generateId`).

- [ ] **Step 3: Commit**

```bash
git add src/types/director.ts
git commit -m "feat(director): docKind + beatSheet fields on DirectorShow"
```

---

### Task 4: CSS for empty state + beat cards

**Files:**
- Modify: `src/styles/director-tab.css` (append)

**Interfaces:**
- Produces classes consumed by Tasks 5–6: `des-*` (empty state) and `dbs-*` (beat sheet). Full list in Step 1.

- [ ] **Step 1: Append the classes**

Append to `src/styles/director-tab.css`:

```css
/* ── Script empty state ─────────────────────────────── */
.des-wrap { flex:1; display:flex; align-items:center; justify-content:center; padding:40px; overflow:auto; }
.des-card { width:640px; max-width:100%; }
.des-h1 { font-size:22px; margin:0 0 6px; text-align:center; }
.des-sub { color:var(--text-secondary); text-align:center; margin:0 0 28px; font-size:14px; }
.des-choices { display:grid; grid-template-columns:1fr 1fr 1fr; gap:14px; margin-bottom:26px; }
.des-choice { background:var(--bg-raised); border:1px solid var(--border-subtle); border-radius:12px; padding:22px 18px; text-align:center; cursor:pointer; }
.des-choice:hover { border-color:var(--accent); }
.des-choice .ic { font-size:30px; margin-bottom:10px; }
.des-choice h3 { margin:0 0 5px; font-size:15px; }
.des-choice p { margin:0; font-size:12px; color:var(--text-tertiary); line-height:1.4; }
.des-or { display:flex; align-items:center; gap:12px; color:var(--text-tertiary); font-size:12px; margin:0 0 18px; }
.des-or::before, .des-or::after { content:""; height:1px; background:var(--border-subtle); flex:1; }
.des-promptbox { background:var(--bg-raised); border:1px solid var(--border-medium); border-radius:12px; padding:14px; }
.des-promptbox textarea { width:100%; background:transparent; border:none; color:var(--text-primary); font:inherit; font-size:14px; resize:none; outline:none; min-height:54px; }
.des-prow { display:flex; align-items:center; gap:8px; margin-top:8px; }
.des-back { background:none; border:none; color:var(--text-tertiary); font-size:12px; cursor:pointer; margin-bottom:16px; padding:0; }
.des-back:hover { color:var(--text-primary); }
.des-askq { font-size:16px; line-height:1.5; margin:0 0 4px; }
.des-asksub { color:var(--text-secondary); font-size:13px; margin:0 0 22px; }
.des-askrow { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
.des-opt { text-align:left; background:var(--bg-raised); border:1px solid var(--border-subtle); border-radius:12px; padding:18px; cursor:pointer; }
.des-opt:hover { border-color:var(--accent); }
.des-opt h4 { margin:0 0 5px; font-size:15px; }
.des-opt p { margin:0; font-size:12px; color:var(--text-tertiary); line-height:1.4; }
.des-kindtoggle { display:flex; gap:8px; margin:0 0 18px; }
.des-kindtoggle button { font:inherit; font-size:12px; padding:5px 12px; border-radius:8px; border:1px solid var(--border-medium); background:var(--bg-elevated); color:var(--text-secondary); cursor:pointer; }
.des-kindtoggle button.on { background:var(--accent); color:var(--bg-base); border-color:var(--accent); }

/* ── Beat-sheet editor ──────────────────────────────── */
.dbs-wrap { flex:1; overflow:auto; padding:20px; display:flex; flex-direction:column; align-items:center; gap:14px; }
.dbs-list { width:640px; max-width:100%; display:flex; flex-direction:column; gap:14px; }
.dbs-card { background:var(--bg-raised); border:1px solid var(--border-subtle); border-radius:12px; padding:14px 16px; }
.dbs-card--diffadd { border-color:var(--success); box-shadow:0 0 0 1px var(--success); }
.dbs-card--diffdel { border-color:var(--error); opacity:.7; text-decoration:line-through; }
.dbs-head { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
.dbs-num { font-family:'Space Mono',monospace; font-weight:700; color:var(--accent); }
.dbs-head input { flex:1; }
.dbs-fields { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.dbs-fields .full { grid-column:1 / -1; }
.dbs-flabel { font-size:10px; text-transform:uppercase; letter-spacing:.05em; color:var(--text-tertiary); font-weight:600; margin-bottom:3px; display:block; }
.dbs-actions { display:flex; gap:6px; margin-top:10px; }
.dbs-diffbar { display:flex; gap:6px; align-items:center; }
.dbs-add { width:640px; max-width:100%; }
```

- [ ] **Step 2: Typecheck (CSS regression guard)**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/styles/director-tab.css
git commit -m "style(director): empty-state + beat-card classes"
```

---

### Task 5: Empty-state component (`script-empty-state.tsx`)

**Files:**
- Create: `src/components/director/script-empty-state.tsx`

**Interfaces:**
- Consumes: `SCRIPT_ACCEPT` from `@/lib/director/look-bible`.
- Produces:
  ```ts
  type CreateKind = 'screenplay' | 'beatsheet';
  interface ScriptEmptyStateProps {
    onNewScreenplay: () => void;
    onNewBeatSheet: () => void;
    onUpload: () => void;                                   // triggers file picker
    onCreateFromPrompt: (idea: string, kind: CreateKind, mode: 'draft' | 'brainstorm') => void;
  }
  export function ScriptEmptyState(props: ScriptEmptyStateProps): JSX.Element;
  ```

- [ ] **Step 1: Create the component**

Create `src/components/director/script-empty-state.tsx`:

```tsx
import { useState } from 'react';

type CreateKind = 'screenplay' | 'beatsheet';

interface ScriptEmptyStateProps {
  onNewScreenplay: () => void;
  onNewBeatSheet: () => void;
  onUpload: () => void;
  onCreateFromPrompt: (idea: string, kind: CreateKind, mode: 'draft' | 'brainstorm') => void;
}

export function ScriptEmptyState({ onNewScreenplay, onNewBeatSheet, onUpload, onCreateFromPrompt }: ScriptEmptyStateProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [idea, setIdea] = useState('');
  const [kind, setKind] = useState<CreateKind>('screenplay');

  return (
    <div className="des-wrap">
      <div className="des-card">
        {step === 1 ? (
          <>
            <h1 className="des-h1">Start your script</h1>
            <p className="des-sub">Upload a Final Draft / Fountain file, start a blank document, or tell the assistant what you want to make.</p>
            <div className="des-choices">
              <div className="des-choice" onClick={onNewScreenplay}><div className="ic">📄</div><h3>New Screenplay</h3><p>Blank screenplay with dialogue. Write scenes, characters, action.</p></div>
              <div className="des-choice" onClick={onNewBeatSheet}><div className="ic">🎬</div><h3>New Beat Sheet</h3><p>No dialogue. Detailed beats (action, location, shot, mood) for video prompts.</p></div>
              <div className="des-choice" onClick={onUpload}><div className="ic">⬆️</div><h3>Upload</h3><p>.fdx, .fountain, .txt, .md — imported with correct formatting.</p></div>
            </div>
            <div className="des-or">or tell the assistant</div>
            <div className="des-promptbox">
              <textarea
                value={idea}
                placeholder="e.g. “A short film about a thief who returns what she steals” — or — “A video about a city waking up at dawn, no dialogue”"
                onChange={(e) => setIdea(e.target.value)}
              />
              <div className="des-prow">
                <span className="director-tab__chip" onClick={() => setIdea('A short film about ')}>Short film about…</span>
                <span className="director-tab__chip" onClick={() => { setIdea('A video, no dialogue, about '); setKind('beatsheet'); }}>No-dialogue video about…</span>
                <span className="director-tab__chip" onClick={() => setIdea('Help me brainstorm ')}>Help me brainstorm…</span>
                <button type="button" className="director-tab__btn director-tab__btn--accent" style={{ marginLeft: 'auto' }} disabled={!idea.trim()} onClick={() => setStep(2)}>Send ▸</button>
              </div>
            </div>
          </>
        ) : (
          <>
            <button type="button" className="des-back" onClick={() => setStep(1)}>‹ Back</button>
            <p className="des-askq">🤖 <b>{idea.trim()}</b></p>
            <p className="des-asksub">How do you want to start?</p>
            <div className="des-kindtoggle">
              <button type="button" className={kind === 'screenplay' ? 'on' : ''} onClick={() => setKind('screenplay')}>Screenplay</button>
              <button type="button" className={kind === 'beatsheet' ? 'on' : ''} onClick={() => setKind('beatsheet')}>Beat Sheet</button>
            </div>
            <div className="des-askrow">
              <div className="des-opt" onClick={() => onCreateFromPrompt(idea.trim(), kind, 'draft')}>
                <h4>✍️ Draft it</h4><p>Write a first version now — it appears in the {kind === 'beatsheet' ? 'beat sheet' : 'script'} as a diff you can accept or decline.</p>
              </div>
              <div className="des-opt" onClick={() => onCreateFromPrompt(idea.trim(), kind, 'brainstorm')}>
                <h4>💭 Brainstorm first</h4><p>Talk through the story and structure in the chat before anything is written.</p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors (note: `SCRIPT_ACCEPT` import is unused here — the file picker lives in the tab; do NOT import it. Remove any unused import.)

- [ ] **Step 3: Commit**

```bash
git add src/components/director/script-empty-state.tsx
git commit -m "feat(director): script empty-state (two-step create flow)"
```

---

### Task 6: Beat-sheet editor (`beatsheet-editor.tsx`)

**Files:**
- Create: `src/components/director/beatsheet-editor.tsx`

**Interfaces:**
- Consumes: `Beat`/`BeatSheet`/`renumberBeats` from `@/lib/director/beatsheet`; `BeatEdit` from `@/lib/director/script-assistant`; `generateId` from `@/lib/utils/ids`.
- Produces:
  ```ts
  interface BeatsheetEditorProps {
    beatSheet: BeatSheet;
    selectedBeatId?: string;
    pendingBeatEdits?: BeatEdit[];
    onChange: (bs: BeatSheet) => void;
    onSelect: (beatId: string) => void;
    onAcceptEdits: () => void;
    onDeclineEdits: () => void;
  }
  export function BeatsheetEditor(props: BeatsheetEditorProps): JSX.Element;
  ```

- [ ] **Step 1: Create the component**

Create `src/components/director/beatsheet-editor.tsx`:

```tsx
import type { Beat, BeatSheet } from '@/lib/director/beatsheet';
import { renumberBeats } from '@/lib/director/beatsheet';
import type { BeatEdit } from '@/lib/director/script-assistant';
import { generateId } from '@/lib/utils/ids';

interface BeatsheetEditorProps {
  beatSheet: BeatSheet;
  selectedBeatId?: string;
  pendingBeatEdits?: BeatEdit[];
  onChange: (bs: BeatSheet) => void;
  onSelect: (beatId: string) => void;
  onAcceptEdits: () => void;
  onDeclineEdits: () => void;
}

export function BeatsheetEditor({ beatSheet, selectedBeatId, pendingBeatEdits, onChange, onSelect, onAcceptEdits, onDeclineEdits }: BeatsheetEditorProps) {
  const beats = beatSheet.beats;
  const patch = (next: Beat[]) => onChange({ beats: renumberBeats(next) });
  const setField = (id: string, field: keyof Beat, value: string | number | undefined) =>
    patch(beats.map((b) => (b.id === id ? { ...b, [field]: value } : b)));
  const addBeat = () => {
    const b: Beat = { id: generateId(), n: beats.length + 1, action: '', location: '', shot: '' };
    patch([...beats, b]);
    onSelect(b.id);
  };
  const removeBeat = (id: string) => patch(beats.filter((b) => b.id !== id));
  const move = (id: string, dir: -1 | 1) => {
    const i = beats.findIndex((b) => b.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= beats.length) return;
    const next = [...beats];
    [next[i], next[j]] = [next[j], next[i]];
    patch(next);
  };

  const hasPending = !!pendingBeatEdits && pendingBeatEdits.length > 0;
  const delTargets = new Set((pendingBeatEdits ?? []).filter((e) => e.op === 'replace' || e.op === 'delete').map((e) => e.targetBeatId).filter(Boolean) as string[]);
  const addsFor = (id: string) => (pendingBeatEdits ?? []).find((e) => e.targetBeatId === id && (e.op === 'replace' || e.op === 'insert-after'))?.beats ?? [];

  return (
    <div className="dbs-wrap">
      <div className="dbs-list">
        {beats.length === 0 && !hasPending && <p className="director-tab__empty">No beats yet — add one, or ask the assistant to draft the beat sheet.</p>}
        {beats.map((b) => (
          <div key={b.id}>
            <div className={`dbs-card${delTargets.has(b.id) ? ' dbs-card--diffdel' : ''}${b.id === selectedBeatId ? ' director-tab__item--active' : ''}`} onFocusCapture={() => onSelect(b.id)}>
              <div className="dbs-head">
                <span className="dbs-num">BEAT {b.n}</span>
                <input value={b.location} placeholder="INT./EXT. Location" onChange={(e) => setField(b.id, 'location', e.target.value)} disabled={hasPending} />
                <button type="button" className="director-tab__btn" onClick={() => move(b.id, -1)} disabled={hasPending} title="Move up">↑</button>
                <button type="button" className="director-tab__btn" onClick={() => move(b.id, 1)} disabled={hasPending} title="Move down">↓</button>
                <button type="button" className="director-tab__btn" onClick={() => removeBeat(b.id)} disabled={hasPending} title="Remove">✕</button>
              </div>
              <div className="dbs-fields">
                <div className="full">
                  <label className="dbs-flabel">Action — what happens</label>
                  <textarea value={b.action} onChange={(e) => setField(b.id, 'action', e.target.value)} disabled={hasPending} />
                </div>
                <div>
                  <label className="dbs-flabel">Shot / camera</label>
                  <input value={b.shot} onChange={(e) => setField(b.id, 'shot', e.target.value)} disabled={hasPending} />
                </div>
                <div>
                  <label className="dbs-flabel">Mood</label>
                  <input value={b.mood ?? ''} onChange={(e) => setField(b.id, 'mood', e.target.value)} disabled={hasPending} />
                </div>
                <div>
                  <label className="dbs-flabel">Duration (s)</label>
                  <input type="number" min={1} value={b.duration ?? ''} onChange={(e) => setField(b.id, 'duration', e.target.value === '' ? undefined : Number(e.target.value))} disabled={hasPending} />
                </div>
              </div>
            </div>
            {addsFor(b.id).map((n) => (
              <div key={n.id} className="dbs-card dbs-card--diffadd">
                <div className="dbs-head"><span className="dbs-num">+ {n.location}</span></div>
                <p className="director-tab__meta">{n.action}{n.shot ? ` · ${n.shot}` : ''}</p>
              </div>
            ))}
          </div>
        ))}
        {hasPending && (
          <div className="dbs-diffbar">
            <button type="button" className="director-tab__btn director-tab__btn--accent" onClick={onAcceptEdits}>✓ Accept</button>
            <button type="button" className="director-tab__btn" onClick={onDeclineEdits}>✕ Decline</button>
            <span className="director-tab__meta">assistant edit · {pendingBeatEdits!.length} change{pendingBeatEdits!.length === 1 ? '' : 's'}</span>
          </div>
        )}
      </div>
      {!hasPending && (
        <div className="dbs-add">
          <button type="button" className="director-tab__btn" onClick={addBeat}>+ Add beat</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/director/beatsheet-editor.tsx
git commit -m "feat(director): beat-sheet card editor (fields, add/remove/move, beat diff)"
```

---

### Task 7: Wire empty state + beat editor + chat modes into the Script tab

**Files:**
- Modify: `src/components/director/director-script-tab.tsx`
- Modify: `src/components/director/director-script-chat.tsx`

**Interfaces:**
- Consumes Tasks 1, 2, 5, 6 + existing editor/chat/panels.

- [ ] **Step 1: Chat — docKind + create mode (`director-script-chat.tsx`)**

Add props and beat-sheet support. Change the props interface to add:
```tsx
  docKind: 'screenplay' | 'beatsheet';
  beatSheet?: import('@/lib/director/beatsheet').BeatSheet;
  onProposeBeatEdits: (res: import('@/lib/director/script-assistant').AssistantResponse) => void;
  initialMessage?: { idea: string; mode: 'draft' | 'brainstorm' };
```
Update the imports to include the beat-sheet path:
```tsx
import {
  SCRIPT_ASSISTANT_SYSTEM_PROMPT, BEATSHEET_ASSISTANT_SYSTEM_PROMPT,
  buildAssistantMessage, buildBeatsheetMessage, parseAssistantResponse, type AssistantResponse,
} from '@/lib/director/script-assistant';
```
In `send`, branch on `docKind` to pick the system prompt + message builder + which propose callback to call:
```tsx
const isBeat = docKind === 'beatsheet';
const systemPrompt = isBeat ? BEATSHEET_ASSISTANT_SYSTEM_PROMPT : SCRIPT_ASSISTANT_SYSTEM_PROMPT;
const message = isBeat
  ? buildBeatsheetMessage(beatSheet ?? { beats: [] }, text, selectedId ? { beatId: selectedId } : undefined)
  : buildAssistantMessage(doc, text, selectedId ? { elementId: selectedId } : undefined);
// … after parseAssistantResponse:
if (isBeat) { if (res.beatEdits?.length) onProposeBeatEdits(res); }
else { if (res.edits?.length) onProposeEdits(res); }
```
**Auto-send the create seed exactly once (loop-safe).** Change `send` to accept an optional text + mode override so the effect never races on `draft` state:
```tsx
const send = async (override?: { text: string; mode?: 'draft' | 'brainstorm' }) => {
  const text = (override?.text ?? draft).trim();
  if (!text || busy) return;
  setDraft('');
  setMessages((m) => [...m, { role: 'user', text }]);
  setBusy(true);
  try {
    const isBeat = docKind === 'beatsheet';
    const brainstorm = override?.mode === 'brainstorm';
    const systemPrompt = isBeat ? BEATSHEET_ASSISTANT_SYSTEM_PROMPT : SCRIPT_ASSISTANT_SYSTEM_PROMPT;
    // In brainstorm mode, nudge the model to converse only (no edits/beatEdits this turn).
    const userMessage = (isBeat
      ? buildBeatsheetMessage(beatSheet ?? { beats: [] }, text, selectedId ? { beatId: selectedId } : undefined)
      : buildAssistantMessage(doc, text, selectedId ? { elementId: selectedId } : undefined))
      + (brainstorm ? '\n\n(Brainstorm mode: discuss and outline only — do NOT return edits/beatEdits this turn.)' : '');
    const result = await invokeCliCopilotChat(provider, { systemPrompt, userMessage, purpose: 'copilot' });
    const res = parseAssistantResponse(result.message);
    const count = isBeat ? res.beatEdits?.length : res.edits?.length;
    setMessages((m) => [...m, { role: 'ai', text: res.reply + (count ? `\n(proposed ${count} change${count === 1 ? '' : 's'})` : '') }]);
    if (!brainstorm) { if (isBeat) { if (res.beatEdits?.length) onProposeBeatEdits(res); } else { if (res.edits?.length) onProposeEdits(res); } }
  } catch (err) {
    setMessages((m) => [...m, { role: 'ai', text: err instanceof Error ? err.message : 'Assistant failed.' }]);
  } finally { setBusy(false); }
};
```
Auto-send effect (fires once per distinct seed, guarded so it can't loop):
```tsx
const seededRef = useRef<string | undefined>();
useEffect(() => {
  if (initialMessage && seededRef.current !== initialMessage.idea) {
    seededRef.current = initialMessage.idea;
    void send({ text: initialMessage.idea, mode: initialMessage.mode });
  }
}, [initialMessage]);
```
(Add `useEffect`, `useRef` to the `react` import.) The user's own composer `Send` button calls `send()` (no override) as before.

- [ ] **Step 2: Script tab — routing + create + coherent commits (`director-script-tab.tsx`)**

Add imports:
```tsx
import { ScriptEmptyState } from './script-empty-state';
import { BeatsheetEditor } from './beatsheet-editor';
import { emptyBeatSheet, serializeBeatSheet, type BeatSheet } from '@/lib/director/beatsheet';
import { applyBeatEdits, type BeatEdit, type AssistantResponse } from '@/lib/director/script-assistant';
```

Add state for beat sheet + pending beat edits + the create seed:
```tsx
const [pendingBeats, setPendingBeats] = useState<BeatEdit[] | undefined>();
const [createSeed, setCreateSeed] = useState<{ idea: string; mode: 'draft' | 'brainstorm' } | undefined>();
const docKind = show.docKind ?? 'screenplay';
const beatSheet = show.beatSheet ?? emptyBeatSheet();
```

Add a beat-sheet commit (debounced not required for v1 — write immediately, coherent):
```tsx
const setBeatSheet = (bs: BeatSheet) => onChange({ ...show, beatSheet: bs, sourceText: serializeBeatSheet(bs) });
```

Empty-state predicate + handlers (place before the return):
```tsx
const isEmpty = docKind === 'beatsheet' ? beatSheet.beats.length === 0 : (!show.sourceText.trim() && !show.sourceElements);
const newScreenplay = () => onChange({ ...show, docKind: 'screenplay', sourceText: '', sourceElements: undefined });
const newBeatSheet = () => onChange({ ...show, docKind: 'beatsheet', beatSheet: emptyBeatSheet(), sourceText: '' });
const createFromPrompt = (idea: string, kind: 'screenplay' | 'beatsheet', mode: 'draft' | 'brainstorm') => {
  if (kind === 'beatsheet') onChange({ ...show, docKind: 'beatsheet', beatSheet: emptyBeatSheet(), sourceText: '' });
  else onChange({ ...show, docKind: 'screenplay', sourceText: '', sourceElements: undefined });
  setRightOpen(true);
  setCreateSeed({ idea, mode });
};
```

In the `return`, when `isEmpty`, render the empty state INSTEAD of the `dse-shell`/editor (keep the toolbar). Wrap the existing editor block:
```tsx
{isEmpty ? (
  <ScriptEmptyState onNewScreenplay={newScreenplay} onNewBeatSheet={newBeatSheet} onUpload={() => fileRef.current?.click()} onCreateFromPrompt={createFromPrompt} />
) : (
  <div className="dse-shell" data-left={leftOpen ? 'open' : 'closed'} data-right={rightOpen ? 'open' : 'closed'}>
    {/* reopen tabs unchanged */}
    {/* left panel unchanged */}
    {docKind === 'beatsheet' ? (
      <BeatsheetEditor
        beatSheet={beatSheet}
        selectedBeatId={selectedId}
        pendingBeatEdits={pendingBeats}
        onChange={setBeatSheet}
        onSelect={setSelectedId}
        onAcceptEdits={() => { setBeatSheet(applyBeatEdits(beatSheet, pendingBeats ?? [])); setPendingBeats(undefined); }}
        onDeclineEdits={() => setPendingBeats(undefined)}
      />
    ) : (
      /* existing <PaginatedEditor …/> unchanged */
    )}
    {/* right chat panel — pass docKind + beatSheet + onProposeBeatEdits + initialMessage=createSeed */}
  </div>
)}
```
Pass to `DirectorScriptChat` (right panel): `docKind={docKind}`, `beatSheet={beatSheet}`, `onProposeBeatEdits={(res: AssistantResponse) => setPendingBeats(res.beatEdits)}`, `initialMessage={createSeed}`. When the chat consumes `createSeed`, clear it (pass an `onSeedConsumed={() => setCreateSeed(undefined)}` or clear in the chat's mount effect via a callback — simplest: clear `createSeed` after passing by giving the chat an `onConsumeInitial` prop it calls once).

Keep the bottom legend rendering only for `docKind === 'screenplay'`.

- [ ] **Step 3: Full typecheck + director tests**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors. Resolve any prop mismatches (the chat's new required props must all be passed).
Run: `npx vitest run tests/lib/director/`
Expected: PASS (existing + beatsheet + beat-assistant tests).

- [ ] **Step 4: Commit**

```bash
git add src/components/director/director-script-tab.tsx src/components/director/director-script-chat.tsx
git commit -m "feat(director): empty-state + beat-sheet editor + chat create modes in Script tab"
```

---

### Task 8: Browser-driven verification

No new code unless a fix is needed.

- [ ] **Step 1: Launch + empty state**

Launch the app; open Director → Script with an empty project. Confirm the empty state shows (New Screenplay / New Beat Sheet / Upload + prompt box).

- [ ] **Step 2: Each entry point**

- New Screenplay → blank paginated editor.
- New Beat Sheet → blank beat-sheet editor (Add beat works; fields edit).
- Upload → file picker (FDX still imports correctly).
- Prompt + Send → step 2 (Draft it / Brainstorm first + kind toggle). Draft it → the assistant proposes content as a diff you Accept/Decline; Brainstorm first → the chat converses, nothing lands.

- [ ] **Step 3: Beat sheet → pipeline**

On a beat sheet with a few beats, run **breakdown** (from the toolbar) → it extracts characters/locations/props; then **shotlist** → beats become clips. Confirms `serializeBeatSheet` feeds the pipeline. Screenplay path still works unchanged.

- [ ] **Step 4: Commit any fixes**

Smallest fix if needed; else no commit.

---

## Self-Review Notes

- **Spec coverage:** beat model + serialize + renumber (T1); beat-edit contract + prompt + parse (T2); docKind/beatSheet fields (T3); empty-state + beat CSS (T4); empty-state component two-step + kind toggle (T5); beat-sheet editor with add/remove/move + beat diff (T6); tab routing (empty vs screenplay vs beatsheet) + create handlers + coherent commits + chat docKind/mode wiring (T7); driven verification incl. beat→pipeline (T8). Covered.
- **Type consistency:** `Beat`/`BeatSheet`/`renumberBeats`/`serializeBeatSheet`/`emptyBeatSheet` consistent T1→T3/T6/T7; `BeatEdit`/`applyBeatEdits`/`buildBeatsheetMessage`/`BEATSHEET_ASSISTANT_SYSTEM_PROMPT`/`AssistantResponse.beatEdits` consistent T2→T6/T7; `docKind`/`beatSheet` fields declared T3, used T7; coherence commits write both stores.
- **No placeholders:** T1–T6 have complete code. T7 is an integration task describing precise edits to two existing files with the exact new props/handlers/branches and the code for each; the "unchanged" markers point at existing blocks to preserve, not omitted code.
- **Flagged risks (final reviewer):** (a) three representations (`sourceElements`/`beatSheet`/`sourceText`) — verify every commit path writes the active store + sourceText together; (b) the chat's `initialMessage` auto-send-once must not loop (guard with a consumed flag); (c) T7 touches the subtle script-tab render/return — verify empty-state predicate and that screenplay path is byte-unchanged.
