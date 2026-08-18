# Final Draft (.fdx) Structured Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse `.fdx` (Final Draft) uploads into correctly-typed screenplay elements using the file's `Paragraph Type` attributes, so FDX scripts import with exact formatting instead of heuristic guessing.

**Architecture:** A pure tolerant `parseFdx()` maps FDX `<Paragraph Type="…">` blocks to our six screenplay element types. An optional `DirectorShow.sourceElements` field holds the typed result; the editor prefers it when present (no re-parse). `sourceText` stays the derived plain-text mirror all other consumers read, written together with `sourceElements` so they never drift. Malformed FDX falls back to the current `stripXml` text path — upload never fails.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest (`@/` → `src/`).

## Global Constraints

- Test runner: `npx vitest run <path>`; full-project typecheck gate `npx tsc --noEmit -p tsconfig.json` must stay clean.
- `parseFdx` is PURE and tolerant: never throws (try/catch → `null`); returns `null` when no `<Paragraph>` is found, parsing throws, or zero elements result. Unit-tested TDD (failing test first).
- FDX `Type` → six element types (verbatim): `Scene Heading`→`scene`; `Action`/`General`/`Shot`→`action`; `Character`→`character`; `Dialogue`→`dialogue`; `Parenthetical`→`parenthetical`; `Transition`→`transition`; any other → `action`.
- Element type union (unchanged): `'scene' | 'action' | 'character' | 'parenthetical' | 'dialogue' | 'transition'`.
- Coherence rule: `sourceElements` (when present) is authoritative; `sourceText` is always written together with it from the same element array. Every write sets both.
- NO id regeneration when adopting `sourceElements` into the editor doc — wrap as `{ elements: show.sourceElements }` directly (regenerating churns ids and breaks selection/pending-edit targeting).
- `sourceText` stays the string source of truth for breakdown/shotlist/look-bible/serialize — do NOT change those consumers.
- Reuse: `Screenplay`/`ScreenplayElement`/`serializeScreenplay`/`parseToScreenplay` from `@/lib/director/screenplay`; `generateId` from `@/lib/utils/ids`; `extractScriptText`/`SCRIPT_ACCEPT` from `@/lib/director/look-bible`.
- `git add` only the files each task owns; never `git add .` (`.playwright-mcp/` is gitignored scratch).
- Commit after every task.

---

### Task 1: Pure FDX parser (`fdx-parser.ts`)

**Files:**
- Create: `src/lib/director/fdx-parser.ts`
- Test: `tests/lib/director/fdx-parser.test.ts`

**Interfaces:**
- Consumes: `Screenplay`/`ScreenplayElementType` from `@/lib/director/screenplay`; `generateId` from `@/lib/utils/ids`.
- Produces:
  ```ts
  export function parseFdx(raw: string): Screenplay | null;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/lib/director/fdx-parser.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseFdx } from '@/lib/director/fdx-parser';
import { serializeScreenplay } from '@/lib/director/screenplay';

const FDX = `<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script">
  <Content>
    <Paragraph Type="Scene Heading"><Text>INT. OFFICE - DAY</Text></Paragraph>
    <Paragraph Type="Action"><Text>A desk. </Text><Text>Maya sits.</Text></Paragraph>
    <Paragraph Type="Character"><Text>MAYA</Text></Paragraph>
    <Paragraph Type="Parenthetical"><Text>(quietly)</Text></Paragraph>
    <Paragraph Type="Dialogue"><Text>It&#39;s me &amp; you.</Text></Paragraph>
    <Paragraph Type="Transition"><Text>CUT TO:</Text></Paragraph>
    <Paragraph Type="General"><Text>Some general note.</Text></Paragraph>
    <Paragraph Type="Action"><Text></Text></Paragraph>
  </Content>
</FinalDraft>`;

describe('parseFdx', () => {
  it('maps Paragraph Type attributes to element types', () => {
    const doc = parseFdx(FDX)!;
    expect(doc.elements.map((e) => e.type)).toEqual([
      'scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 'action',
    ]);
  });

  it('concatenates multiple <Text> runs in one paragraph', () => {
    const doc = parseFdx(FDX)!;
    expect(doc.elements[1].text).toBe('A desk. Maya sits.');
  });

  it('decodes XML entities', () => {
    const doc = parseFdx(FDX)!;
    expect(doc.elements[4].text).toBe("It's me & you.");
  });

  it('maps unknown/General type to action', () => {
    const doc = parseFdx(FDX)!;
    expect(doc.elements[6]).toMatchObject({ type: 'action', text: 'Some general note.' });
  });

  it('skips empty paragraphs and assigns ids', () => {
    const doc = parseFdx(FDX)!;
    // the trailing empty Action paragraph is skipped → 7 elements, not 8
    expect(doc.elements).toHaveLength(7);
    expect(doc.elements.every((e) => typeof e.id === 'string' && e.id.length > 0)).toBe(true);
  });

  it('returns null for malformed / non-FDX input', () => {
    expect(parseFdx('not xml at all')).toBeNull();
    expect(parseFdx('<FinalDraft></FinalDraft>')).toBeNull(); // no Paragraphs
    expect(parseFdx('')).toBeNull();
  });

  it('serializes to readable multi-line text', () => {
    const text = serializeScreenplay(parseFdx(FDX)!);
    expect(text).toMatch(/INT\. OFFICE - DAY/);
    expect(text).toMatch(/MAYA/);
    expect(text.split('\n').length).toBeGreaterThan(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/director/fdx-parser.test.ts`
Expected: FAIL — cannot resolve `@/lib/director/fdx-parser`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/director/fdx-parser.ts`:

```ts
import type { Screenplay, ScreenplayElement, ScreenplayElementType } from '@/lib/director/screenplay';
import { generateId } from '@/lib/utils/ids';

const TYPE_MAP: Record<string, ScreenplayElementType> = {
  'scene heading': 'scene',
  action: 'action',
  general: 'action',
  shot: 'action',
  character: 'character',
  dialogue: 'dialogue',
  parenthetical: 'parenthetical',
  transition: 'transition',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

// Concatenate the text of all <Text> runs inside one paragraph's inner XML.
function paragraphText(inner: string): string {
  const runs = inner.match(/<Text[^>]*>([\s\S]*?)<\/Text>/gi);
  if (!runs) return '';
  return decodeEntities(
    runs.map((r) => r.replace(/<Text[^>]*>/i, '').replace(/<\/Text>/i, '')).join(''),
  ).trim();
}

export function parseFdx(raw: string): Screenplay | null {
  try {
    const paras = raw.match(/<Paragraph\b[^>]*>[\s\S]*?<\/Paragraph>/gi);
    if (!paras || paras.length === 0) return null;
    const elements: ScreenplayElement[] = [];
    for (const p of paras) {
      const typeMatch = p.match(/<Paragraph\b[^>]*\bType\s*=\s*"([^"]*)"/i);
      const rawType = (typeMatch?.[1] ?? '').trim().toLowerCase();
      const type = TYPE_MAP[rawType] ?? 'action';
      const inner = p.replace(/^<Paragraph\b[^>]*>/i, '').replace(/<\/Paragraph>$/i, '');
      const text = paragraphText(inner);
      if (!text) continue; // skip empty paragraphs
      elements.push({ id: generateId(), type, text });
    }
    return elements.length > 0 ? { elements } : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/director/fdx-parser.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/director/fdx-parser.ts tests/lib/director/fdx-parser.test.ts
git commit -m "feat(director): tolerant FDX parser (Paragraph Type → element types)"
```

---

### Task 2: `sourceElements` field + editor integration

**Files:**
- Modify: `src/types/director.ts` (add optional `sourceElements`)
- Modify: `src/components/director/director-script-tab.tsx` (`docFromShow`, init, external-sync effect, `setDoc` flush, `loadScript` FDX branch)

**Interfaces:**
- Consumes: `parseFdx` from `@/lib/director/fdx-parser`; existing `serializeScreenplay`/`parseToScreenplay`/`Screenplay`/`ScreenplayElement` from `@/lib/director/screenplay`; `extractScriptText` from `@/lib/director/look-bible`.
- Produces: `DirectorShow.sourceElements?: ScreenplayElement[]`.

- [ ] **Step 1: Add the optional field to `src/types/director.ts`**

First ensure `ScreenplayElement` is importable in the types file. At the top of `src/types/director.ts`, add:
```ts
import type { ScreenplayElement } from '@/lib/director/screenplay';
```
(If `@/lib/director/screenplay` importing back into `@/types/director` would create a cycle, instead re-declare the minimal shape inline — but `screenplay.ts` imports only `generateId`, not director types, so the import is safe.)

In the `DirectorShow` interface, after `sourceFileName?: string;` add:
```ts
  /** Typed screenplay elements from a structured import (e.g. .fdx). When present, the editor
   *  uses these directly instead of re-parsing sourceText; kept in sync with sourceText. */
  sourceElements?: ScreenplayElement[];
```

- [ ] **Step 2: Add `docFromShow` + prefer it in init and external-sync**

In `src/components/director/director-script-tab.tsx`:

Add the import:
```tsx
import { parseFdx } from '@/lib/director/fdx-parser';
```

Add a helper above the component (after the imports):
```tsx
function docFromShow(show: DirectorShow): Screenplay {
  // Prefer structured elements (exact types, stable ids) when present; else parse the text.
  return show.sourceElements ? { elements: show.sourceElements } : parseToScreenplay(show.sourceText);
}
```

Change the `doc` initializer from:
```tsx
const [doc, setDocState] = useState<Screenplay>(() => parseToScreenplay(show.sourceText));
```
to:
```tsx
const [doc, setDocState] = useState<Screenplay>(() => docFromShow(show));
```

Change the external-sync effect. Replace:
```tsx
const lastSerialized = useRef(serializeScreenplay(doc));
useEffect(() => {
  if (show.sourceText !== lastSerialized.current) {
    const next = parseToScreenplay(show.sourceText);
    lastSerialized.current = show.sourceText;
    setDocState(next);
  }
}, [show.sourceText]);
```
with:
```tsx
const lastSerialized = useRef(serializeScreenplay(doc));
useEffect(() => {
  // Re-sync when an external change (upload, another tab) makes sourceText differ from what
  // we last serialized. Adopt sourceElements directly when present (no reparse, stable ids).
  if (show.sourceText !== lastSerialized.current) {
    const next = docFromShow(show);
    lastSerialized.current = serializeScreenplay(next);
    setDocState(next);
  }
}, [show.sourceText, show.sourceElements]);
```

- [ ] **Step 3: Write both fields on edit-commit**

Change `setDoc`'s flush. Replace:
```tsx
flushTimer.current = setTimeout(() => {
  const text = serializeScreenplay(next);
  lastSerialized.current = text;
  onChange({ ...show, sourceText: text });
}, 400);
```
with:
```tsx
flushTimer.current = setTimeout(() => {
  const text = serializeScreenplay(next);
  lastSerialized.current = text;
  // Keep sourceElements and sourceText coherent — both written from the same array.
  onChange({ ...show, sourceElements: next.elements, sourceText: text });
}, 400);
```

- [ ] **Step 4: FDX branch in `loadScript`**

Replace the body of `loadScript`'s try block. Current:
```tsx
const raw = await file.text();
const text = extractScriptText(file.name, raw);
if (!text.trim()) throw new Error('That file did not contain readable script text.');
onChange({ ...show, sourceText: text, sourceFileName: file.name });
```
with:
```tsx
const raw = await file.text();
const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
if (ext === 'fdx') {
  const parsed = parseFdx(raw);
  if (parsed) {
    onChange({
      ...show,
      sourceElements: parsed.elements,
      sourceText: serializeScreenplay(parsed),
      sourceFileName: file.name,
    });
    if (fileRef.current) fileRef.current.value = '';
    return;
  }
  // fall through to the plain-text path below on unparseable FDX
}
const text = extractScriptText(file.name, raw);
if (!text.trim()) throw new Error('That file did not contain readable script text.');
onChange({ ...show, sourceText: text, sourceFileName: file.name, sourceElements: undefined });
```

- [ ] **Step 5: Verify full typecheck + director tests**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors (watch for an import cycle from Step 1 — if tsc reports one, use the inline-shape fallback noted there).
Run: `npx vitest run tests/lib/director/`
Expected: PASS (existing + the 7 fdx-parser tests).

- [ ] **Step 6: Commit**

```bash
git add src/types/director.ts src/components/director/director-script-tab.tsx
git commit -m "feat(director): prefer structured sourceElements; FDX upload sets typed elements"
```

---

### Task 3: Browser-driven verification

No new code unless a fix is needed.

- [ ] **Step 1: Build/launch and open the Script tab**

Launch the app (dev server). Open Director → Script.

- [ ] **Step 2: Upload a real `.fdx`**

Upload a Final Draft `.fdx` file. Confirm the editor renders it with **correct formatting**: scene headings styled as headings, character cues centered/uppercased, dialogue indented under cues, parentheticals and transitions correct — matching the file's actual structure (not heuristic guesses). Paginated page cards apply as normal.

- [ ] **Step 3: Verify edits stay coherent + non-FDX unchanged**

Type/Tab/Enter in the uploaded FDX script — edits persist and pagination updates. Then paste plain text (or upload a `.txt`) into a fresh script — it still parses via the heuristic path as before (no regression). Run breakdown on an FDX-imported script → it works (reads `sourceText`, which is kept in sync).

- [ ] **Step 4: Commit any fixes**

If manual driving surfaces a fix, make the smallest change and commit it. Otherwise no commit.

---

## Self-Review Notes

- **Spec coverage:** tolerant `parseFdx` + type mapping + entity decode + multi-`<Text>` concat + skip-empty + null-fallback + serialize sanity (T1); optional `sourceElements` field, `docFromShow` preference with no id regeneration, external-sync adopting elements, both-fields-on-commit coherence, FDX `loadScript` branch with fallback + clearing on plain upload (T2); driven verification of correct FDX formatting + edit coherence + non-FDX regression (T3). Covered.
- **Type consistency:** `parseFdx(raw): Screenplay | null` identical across T1/T2; `sourceElements?: ScreenplayElement[]` declared in T2 Step 1 and consumed in `docFromShow`/effect/`setDoc`; `ScreenplayElementType` mapping matches the union; `serializeScreenplay`/`parseToScreenplay`/`extractScriptText` used with their real signatures.
- **No placeholders:** every step has complete code.
- **Flagged risk (to final reviewer):** the external-sync effect + `lastSerialized` guard is subtle; T2 preserves the guard and adds `show.sourceElements` to the effect deps. The import in T2 Step 1 (`@/lib/director/screenplay` into `@/types/director`) is called out with a cycle-check and fallback — verify tsc stays clean.
