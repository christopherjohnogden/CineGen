# Sets Library + Shape Shot — Implementation Plan (Build Steps 1–2)

**Goal:** Let the user frame AI shots inside a real 3D scan of a location. Import a Gaussian splat as a **Set**, place mannequin stand-ins, frame a virtual camera, and attach the resulting renders + camera description as **references** to a Studio generation.

**Architecture:** One shared `SetViewer` component owns a three.js scene with a Spark splat mesh plus GLB mannequins. It is mounted by two hosts: the **Sets** view mode inside Spaces (library/editing) and the **Shape Shot** modal launched from the Studio composer. Set metadata (marks, cameras) lives in `WorkspaceState.sets` stored **inside the `workflow` JSON blob**; splat binaries are never copied or uploaded — Sets hold absolute paths served by Electron's existing `local-media` protocol. Renders are produced by `SparkViewpoint` offscreen targets at the generation's output resolution, then pushed into the composer via the existing `transfer` prop.

**Tech Stack:** React 19 + TypeScript, Vite, Vitest (`@/` → `src/`), `three@^0.186.0` + `@sparkjsdev/spark@^2.2.0` (MIT, peer `three>=0.180.0`), existing BEM-ish CSS + theme tokens, Electron (`window.electronAPI`).

## Global Constraints

- Test runner: `npx vitest run <path>` — tests live under `tests/` mirroring `src/`, import via `@/…`.
- **Both verification gates are RED on a clean tree today.** `npx tsc --noEmit -p web/tsconfig.json` → 2 × TS2741; `node --test web/server/parity.test.mjs` → fails on `topview.recoverVideo`. Capture this baseline before Task 1 and compare against it, do not expect green.
- `three` + Spark must **never** enter the main chunk. Unpacked Spark is ~17 MB and the web bundle already trips Vite's 500 kB warning with no `manualChunks` in any of the three Vite configs. Every import of the viewer goes through `React.lazy(() => import(...))`.
- Splat binaries are **desktop-local linked paths**. Never copy them, never register them as `Asset`s, never put bytes in `WorkspaceState` (`performCloudSave` re-chunks the whole state at 180 kB per chunk on a 500 ms debounce).
- Store `sets` **inside `workflow`**, not at the top level, on both the SQLite and JSON paths. `saveFullProject` silently drops unrecognised top-level `dbState` keys, and `createLegacySnapshot` (`web/server/index.mjs:634`) passes `workflow` through whole — so this one choice needs **zero** web-server edits.
- Do **not** add live camera-drag actions to `WORKSPACE_PERSIST_ACTIONS`. Commit camera/mark changes on interaction end only.
- Match existing style conventions: BEM-ish `set-viewer__*` / `sets-tab__*` classes in new files under `src/styles/`, theme vars (`--bg-*`, `--text-*`, `--accent*`, `--radius-sm`).
- Commit after every task.

---

### Task 1: Fix the multi-reference submit guard (PREREQUISITE)

Shape Shot cannot work until this lands. Attaching 4 images to a Topview omni model currently aborts submit with *"Choose one more references."* — `extra_images` is `fieldType: 'element-list', max: 30` with **no** `multiple` flag. 12 of 13 element-list fields trip identically. `multiple` is an inverted signal: the one element-list that sets `multiple: true` (`topview/media-tools.ts:34`) is the one that must be limited to exactly one (`max: 1, maxItems: 1`).

**Files:**
- Modify: `src/components/create/space-studio.tsx` (line 1507)
- Test: `tests/components/create/space-studio.test.tsx`

**Interfaces:** field cardinality comes from `max`/`maxItems` (`src/types/workflow.ts:38,46`), falling back to `multiple` only when neither is set.

- [ ] **Step 1: Write the failing test.** Attach 4 image files via `space-studio-attach-input`, select a Topview omni-reference video model, submit. Assert no `formError` and that all 4 urls reach the config. Assert the inverse for a media-tool model (`max: 1`) — 2 refs still error.
- [ ] **Step 2: Add a `fieldCapacity(field)` helper** returning `field.maxItems ?? field.max ?? (field.multiple ? Infinity : 1)`.
- [ ] **Step 3: Replace the guard** at 1507 with a capacity check, and make the write `capacity > 1 ? refs.map(r => r.url) : refs[0].url`.
- [ ] **Step 4:** `npx vitest run tests/components/create/space-studio.test.tsx`. Commit.

---

### Task 2: GPU spike — prove a WebGL canvas renders in the dev build

`electron/main.ts:48-55` calls `app.disableHardwareAcceleration()` + `--disable-gpu-compositing` **unconditionally** on macOS dev builds. `npm run dev` always software-rasterizes, so the viewer cannot be iterated on normally. The comment ties this to macOS sleep/wake stability, so the default must not change.

**Files:** Modify `electron/main.ts`

- [ ] **Step 1:** Gate the existing call behind an opt-in env var, default unchanged:
  `if (process.platform === 'darwin' && !app.isPackaged && process.env.CINEGEN_GPU !== '1') { … }`
- [ ] **Step 2:** Verify `CINEGEN_GPU=1 npm run dev` reports a hardware renderer (`chrome://gpu` or a `WEBGL_debug_renderer_info` probe), and that plain `npm run dev` is byte-identical in behaviour to today.
- [ ] **Step 3:** Document the flag in `README.md`. Commit.

**Falsified if** enabling the GPU reintroduces a sleep/wake crash. Fallback: develop the viewer against `web/vite.config.ts` in a real browser and only smoke-test in a packaged build.

---

### Task 3: Depth spike — decide the depth pass before building on it

Spark documents **no** depth API. It does document per-splat colour editing and `SparkViewpoint` offscreen targets. Depth is Ref 3 and is the first thing dropped under slot pressure, so it must not block the build.

**Files:** Create `scratch/depth-spike/` (not shipped)

- [ ] **Step 1:** Load a sample `.ply`, render a normal pass via `SparkViewpoint({target:{width,height}})` + `renderReadTarget()`.
- [ ] **Step 2:** Attempt a depth pass by recolouring each splat from view-space Z and re-rendering; composite mannequin depth from a standard `MeshDepthMaterial` pass.
- [ ] **Step 3:** Record the verdict in the spec doc.

**Falsified if** per-splat recolour is not reachable. Fallback: ship v1 with **three** references (plate, composite, stand-in) and the slot table collapses to @image1–@image3 — the brief already designates depth as the first thing to drop.

---

### Task 4: Set data model + persistence

**Files:**
- Create: `src/types/sets.ts`, `src/lib/sets/normalize.ts`
- Modify: `src/types/workspace.ts`, `src/types/project.ts`, `src/lib/mcp/workspace-state.ts`, `src/components/workspace/workspace-persistence.ts`, `src/components/workspace/workspace-shell.tsx`, `src/lib/cloud/merge-project-update.ts`, `src/lib/cloud/projects.ts`, `electron/db/project-db.ts`
- Test: `tests/lib/sets/normalize.test.ts`, `tests/lib/cloud/merge-project-update.test.ts`

**Interfaces:**
```ts
export interface SetMark { id: string; name: string; x: number; z: number; facing: number }
export interface SetCamera {
  id: string; name: string; createdAt: string;
  position: [number, number, number]; target: [number, number, number];
  focalMm: number; sensorWidthMm: number; sensorHeightMm: number;
  aspect: string; fovDiagonal: number;
}
export interface ProjectSet {
  id: string; name: string; createdAt: string; updatedAt: string;
  splatPath?: string;          // absolute, desktop-local. Never bytes.
  splatFormat?: 'ply' | 'spz' | 'sog';
  thumbnailUrl?: string;
  upAxis: 'y' | 'z'; scaleToMeters: number;
  marks: SetMark[]; cameras: SetCamera[];
}
export function normalizeProjectSets(value: unknown): ProjectSet[];
```

- [ ] **Step 1: Write the failing test** for `normalizeProjectSets` — drops non-objects, mints ids, coerces every field, never throws on garbage.
- [ ] **Step 2:** Implement the types and `normalizeProjectSets`.
- [ ] **Step 3:** Add `sets: ProjectSet[]` as the **last** member of `WorkspaceState`, and `sets?: ProjectSet[]` to `ProjectSnapshot`.
- [ ] **Step 4:** Add `ADD_SET` / `UPDATE_SET` / `REMOVE_SET` to `WorkspaceAction`, `sets: []` to `createInitialWorkspaceState`, the three reducer cases, and `sets: ProjectSet[]` as a **non-optional** member of `HydratePayload` (this is what makes the compiler catch the three silent-corruption sites below).
- [ ] **Step 5:** Add `sets` to the `HYDRATE` case return object (`workspace-state.ts:577-594`). *Missing this wipes sets on every load and every cloud tick.*
- [ ] **Step 6:** Add the three actions to `WORKSPACE_PERSIST_ACTIONS` and to `UNDOABLE_ACTIONS` (two independent allowlists).
- [ ] **Step 7:** In `persistWorkspace`, add `sets: state.sets` **inside** `dbState.workflow` and inside the JSON branch's workflow object.
- [ ] **Step 8:** Add `state.sets` to the save-effect dependency array (`~1395-1410`). *Missing this makes saves fire only on unrelated changes.*
- [ ] **Step 9:** Add `sets: normalizeProjectSets(...)` to **both** hydration branches **and** to `fromSnapshot` in the `watchCloudProject` effect (`~1242-1264`). *Missing the third loads sets then wipes them ~2 s later.*
- [ ] **Step 10:** Add `'sets'` to the merge key list in `merge-project-update.ts:33`; add `sets: []` to `createDefaultCloudProject`'s workflow literal.
- [ ] **Step 11:** In `project-db.ts`, add `sets?: unknown[]` to `FullProjectState['workflow']`, read it in `getWorkflowState`, and write it in `saveWorkflowState`'s `JSON.stringify`.
- [ ] **Step 12:** Round-trip test: create → add a set → save → reload → assert survival. Commit.

---

### Task 5: The shared `SetViewer` component

**Files:**
- Create: `src/components/sets/set-viewer.tsx`, `src/lib/sets/scene.ts`, `src/lib/sets/optics.ts`, `src/styles/set-viewer.css`
- Test: `tests/lib/sets/optics.test.ts`
- Modify: `package.json` (add `three`, `@sparkjsdev/spark`)

**Interfaces:**
```ts
export interface SetViewerProps {
  set: ProjectSet;
  standIns: StandIn[];
  camera: SetCamera;
  aspect: string;
  overlays?: { thirds?: boolean; safe?: boolean };
  onCameraChange?: (c: SetCamera) => void;
  onStandInsChange?: (s: StandIn[]) => void;
}
// pure, unit-tested:
export function diagonalFov(focalMm: number, sensorW: number, sensorH: number): number;
export function shotSize(subjectHeightM: number, distanceM: number, vFov: number): string;
```

- [ ] **Step 1: Write the failing test** for `diagonalFov` — full-frame (36×24) gives ≈84.1° at 24 mm, ≈46.8° at 50 mm, ≈28.6° at 85 mm.
- [ ] **Step 2:** Implement `src/lib/sets/optics.ts` (pure math only — no three.js import).
- [ ] **Step 3:** Implement `scene.ts`: build a `THREE.Scene`, load the splat via Spark's `SplatMesh` from a `local-media://` URL, add a ground grid, add GLB mannequins on `THREE.Layers` 1 (splat on layer 0).
- [ ] **Step 4:** Implement `SetViewer` — orbit/fly controls, aspect-letterboxed viewport, rule-of-thirds overlay, readouts of camera height / tilt / subject distance. Dispose the renderer and all geometries on unmount.
- [ ] **Step 5:** Manual verification with `CINEGEN_GPU=1 npm run dev`. Commit.

---

### Task 6: Sets view mode inside Spaces

**Files:**
- Create: `src/components/sets/sets-view.tsx`, `src/components/sets/set-card.tsx`, `src/components/sets/floor-plan.tsx`, `src/styles/sets-view.css`
- Modify: `src/components/create/create-tab.tsx`
- Test: `tests/components/sets/sets-view.test.tsx`

- [ ] **Step 1:** Widen `SpaceViewMode` to `'canvas' | 'studio' | 'sets'` (line 25), update `getInitialSpaceViewMode` (30), `handleViewModeChange` (190), the MCP `view` command's union check (**line 225** — currently throws on anything but canvas/studio), and add a third button to the switch (596-612).
- [ ] **Step 2:** Import the splat via an Electron open dialog; store the absolute path only. Render the list with `set-card`.
- [ ] **Step 3:** Implement `floor-plan.tsx` — a pure 2D SVG top-down of marks + camera frustums. Unit-test the projection math separately from rendering.
- [ ] **Step 4:** Mount `SetViewer` through `React.lazy` with a `Suspense` fallback. Commit.

---

### Task 7: Render the four passes

**Files:** Create `src/lib/sets/render-passes.ts`; Test `tests/lib/sets/render-passes.test.ts`

**Interfaces:**
```ts
export type PassKind = 'plate' | 'composite' | 'depth' | 'standin';
export function renderPasses(ctx: SceneContext, kinds: PassKind[], w: number, h: number): Promise<Record<PassKind, Blob>>;
```

- [ ] **Step 1:** Implement passes by toggling layer visibility — plate = layer 0 only; stand-in = layer 1 only; composite = both; depth = per Task 3's verdict.
- [ ] **Step 2:** Render each via `SparkViewpoint({ target: { width, height, superXY: 2 } })` + `renderReadTarget()`, then pack RGBA into a PNG `Blob`.
- [ ] **Step 3:** Persist via a **capability-probed** route: `media.writeTempImage` on desktop/local-web, `elements.upload` → `/api/uploads` on hosted web (hosted **refuses** `writeTempImage` with 422). Commit.

---

### Task 8: The camera prompt block

**Files:** Create `src/lib/sets/camera-prompt.ts`; Test `tests/lib/sets/camera-prompt.test.ts`

Follows the repo's `OPTICS_DOCTRINE` — observable outcomes, never millimetres. Reuses `nearestFovAnchor`, `fovBlock`, `opticsAntiDriftLock` from `src/lib/director/craft/optics.ts`.

**Resolving the distance conflict:** each `FOV_BLOCKS` string asserts a canned camera-to-subject range ("camera 3 to 5 meters"). The viewer knows the **real** distance. Emit the anchor's lens-character sentence, then override with the measured distance explicitly — measured always wins.

- [ ] **Step 1: Write the failing test.** A 50 mm full-frame camera 4.2 m from a standing mannequin produces a block containing the 47° lens character, "about 4.2 metres from camera", and the mannequin-exclusion line.
- [ ] **Step 2:** Implement `buildCameraPrompt(camera, standIns, set)` → `{ block: string, fovAnchor: FovAnchor }`.
- [ ] **Step 3:** Always append verbatim: *"The gray mannequin in @image2 and @image4 is a placement guide only and must not appear in the shot."* Commit.

---

### Task 9: Shape Shot button + attach

**Files:**
- Create: `src/components/sets/shape-shot-modal.tsx`
- Modify: `src/components/create/space-studio.tsx`, `src/components/create/create-tab.tsx`, `src/lib/studio/recipe.ts`
- Test: `tests/components/create/space-studio.test.tsx`

- [ ] **Step 1:** Add the button to the **`promptChips` fragment** (`space-studio.tsx:2172`, immediately after the Elements chip block ending at 2193) — this is the one construct shared by the dock and the panel, so it needs a single insertion. `data-testid="space-studio-shape-shot"`, `disabled={!referencesActive}`, and hidden entirely when `!supportsReferences` (models without an omni reference field render no reference strip at all).
- [ ] **Step 2:** Add `'both'` to `create-tab.tsx`'s transfer `content` union (currently sets media XOR prompt at 210-221) so one transfer can carry attachments *and* prompt.
- [ ] **Step 3:** Give `StudioTransfer` an optional `promptMode: 'replace' | 'append'` and honour it at `space-studio.tsx:942` (currently an unconditional `setPrompt(transfer.prompt)`). Shape Shot uses `'append'`.
- [ ] **Step 4:** On Attach — render passes at the generation's output resolution/aspect, build the transfer with `spaceId: state.activeSpaceId` (**it silently no-ops if this does not match**) and a fresh `id`, in order plate → composite → depth → stand-in. Save the camera to the Set.
- [ ] **Step 5:** Mirror the camera block to a new `__studioShapeShot` config key and re-apply it in `recipe.ts` beside `presetId` (~line 227). *Without this the camera block is destroyed on Reuse, because `__studioPromptBody` is an unconditional override set to the undecorated body.*
- [ ] **Step 6:** Integration test — open Shape Shot, attach, assert 4 references in order, the camera block present, `videoMode === 'references'`, and **no** start-frame write. Commit.

---

## Out of scope (seams left in place)

Build steps 3–7. `SetViewer` takes its camera as a prop and reports changes via callback, so Director "Frame in 3D" mounts it unchanged; `SetCamera` is a self-contained record replayable by a Canvas node or a regenerate action; `floor-plan.tsx` is pure and takes marks + cameras, so Scene Blocking reuses it directly.

## Known risks

1. **Depth is unproven** (Task 3). Fallback is a 3-reference v1.
2. **Bundle size** — Spark unpacked is ~17 MB; mitigation is lazy-loading only, since no Vite config has a chunking strategy and any build-level fix must be written three times.
3. **Reference order is emergent, not contracted.** Attached urls precede Elements by virtue of `execute.ts` iteration order, not a declared guarantee. The @imageN mapping depends on it; a test pins it, but a refactor upstream could silently renumber the slots.
4. **Splats are desktop-only.** A project opened on web shows marks, cameras and the floor plan but cannot render the splat or run Shape Shot.
