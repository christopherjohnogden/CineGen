# Editor Layout + Timeline Core — Design Spec

**Sub-Project 1** of the CINEGEN NLE Editor Overhaul

## Goal

Replace the current Edit tab with an LTX-style NLE layout: dual viewers, V/A separated tracks, multi-timeline support, vertical toolbar with professional editing tools, and a collapsible left panel with two height modes.

## Architecture

The Edit tab is rebuilt as a panel-based layout with resizable boundaries. The existing workspace reducer pattern, undo/redo system, video pool playback strategy, and persistence layer are preserved. Asset management, workflow canvas, and elements tab are untouched.

**Tech stack:** React components, CSS Grid for layout, localStorage for panel sizes, existing `SET_SEQUENCE` action pattern (renamed to `SET_TIMELINE`).

---

## Data Model

### Track

```typescript
interface Track {
  id: string;
  name: string;              // "V1", "A2", etc.
  kind: 'video' | 'audio';
  color: string;             // hex color for indicator dot
  muted: boolean;
  solo: boolean;
  locked: boolean;
  visible: boolean;          // video tracks only; audio ignores this
}
```

### Clip

```typescript
interface Clip {
  id: string;
  assetId: string;
  trackId: string;
  name: string;
  startTime: number;         // position on timeline (seconds)
  duration: number;          // original source duration (seconds)
  trimStart: number;         // trim from beginning (seconds)
  trimEnd: number;           // trim from end (seconds)
}
```

Clips live in a flat array on the Timeline, not nested inside tracks. `trackId` references which track the clip belongs to.

**Effective duration** = `duration - trimStart - trimEnd`

### Timeline (replaces Sequence)

```typescript
interface Timeline {
  id: string;
  name: string;
  tracks: Track[];           // track definitions (no clips)
  clips: Clip[];             // flat clip array
  duration: number;          // total timeline duration
}
```

### Project Snapshot Changes

```typescript
interface ProjectSnapshot {
  project: ProjectMeta;
  workflow: WorkflowState;
  timelines: Timeline[];         // replaces `sequence`
  activeTimelineId: string;      // which timeline is active
  assets: Asset[];
  mediaFolders: MediaFolder[];
  exports: ExportJob[];
  elements: Element[];
}
```

### Migration

On project load, if `sequence` exists but `timelines` does not, auto-migrate:
- Create `timelines: [{ id: generateId(), name: 'Timeline 1', tracks: sequence.tracks, clips: extractClipsFlat(sequence), duration: sequence.duration }]`
- Set `activeTimelineId` to that timeline's id
- Remove `sequence` from the snapshot

---

## Component Structure

```
edit-tab.tsx (EditTab) — layout orchestrator
├── left-panel.tsx (LeftPanel) — collapsible, two height modes
│   ├── Tab: AssetBrowser — adapted from existing asset-drawer
│   └── Tab: TimelineList — list/create/delete/switch timelines
├── ResizeHandle (horizontal, between left panel and center)
├── center-area
│   ├── dual-viewers
│   │   ├── source-viewer.tsx (SourceViewer) — toggleable
│   │   ├── ResizeHandle (vertical, between viewers)
│   │   └── timeline-viewer.tsx (TimelineViewer)
│   ├── ResizeHandle (horizontal, between viewers and timeline)
│   └── timeline-area
│       ├── tool-sidebar.tsx (ToolSidebar) — vertical toolbar
│       └── timeline-editor.tsx (TimelineEditor) — refactored
│           ├── timeline-tabs.tsx (TimelineTabs) — tab bar
│           ├── time-ruler.tsx (TimeRuler) — ruler + playhead
│           ├── track-header.tsx (TrackHeader) — per-track controls
│           ├── track-row.tsx (TrackRow) — clip rendering area
│           ├── clip-card.tsx (ClipCard) — individual clip
│           └── timeline-bottom-bar.tsx — zoom, speed, export
```

**New files:** `source-viewer.tsx`, `timeline-viewer.tsx`, `left-panel.tsx`, `tool-sidebar.tsx`, `timeline-tabs.tsx`, `track-header.tsx`, `timeline-bottom-bar.tsx`, `time-ruler.tsx`

**Refactored:** `edit-tab.tsx`, `timeline-editor.tsx`, `track-row.tsx`, `clip-card.tsx`

**Deleted:** `asset-drawer.tsx` (functionality absorbed into `left-panel.tsx`)

---

## Layout & Resize System

### Layout State (persisted to localStorage)

```typescript
interface EditorLayout {
  leftPanelWidth: number;          // default 240, min 180, max 400
  leftPanelMode: 'full' | 'compact';
  viewerTimelineSplit: number;     // 0-1, default 0.55
  sourceTimelineSplit: number;     // 0-1, default 0.5
  sourceViewerVisible: boolean;    // default true
}
```

### Full-Height Mode (default)

Left panel spans the entire height. Viewers and timeline are to the right.

```
┌──────────┬───┬──────────────────────────────────────┐
│          │   │  Source Viewer  │  Timeline Viewer    │
│  Left    │ R │                │                      │
│  Panel   │ E │────────────────┴──────────────────────│
│  (full   │ S │  Tool │  Timeline Editor              │
│  height) │   │  Bar  │  (tracks, ruler, clips)       │
│          │   │       │                                │
└──────────┴───┴───────┴────────────────────────────────┘
```

### Compact Mode (Resolve-style)

Left panel only covers the viewer row. Timeline extends full width below.

```
┌──────────┬───┬──────────────────────────────────────┐
│  Left    │ R │  Source Viewer  │  Timeline Viewer    │
│  Panel   │ E │                │                      │
│ (compact)│ S │                │                      │
├──────────┴───┴────────────────┴──────────────────────│
│  Tool │  Timeline Editor (FULL WIDTH)                │
│  Bar  │  (tracks, ruler, clips)                      │
│       │                                              │
└───────┴──────────────────────────────────────────────┘
```

Toggle button at the bottom of the left panel switches between modes. Preference persisted.

### Resize Handles

Thin (3px) divs with appropriate cursors. Mouse drag updates the corresponding layout value. All resize operations use `requestAnimationFrame` for smooth visual feedback.

---

## Dual Viewers

### Source Viewer (toggleable)

- Shows the selected clip's source media independently
- Has its own transport controls: play/pause, frame step, timecode display
- Timecode shows source time (relative to clip start), not timeline time
- Close button (×) hides the viewer; keyboard shortcut to toggle
- When hidden, Timeline Viewer expands to full width
- Empty state: "Double-click a clip to view source"

### Timeline Viewer

- Shows the composite output at the current playhead position
- Always visible (cannot be hidden)
- Transport controls: play/pause, frame step, timecode, loop toggle
- Timecode shows timeline time
- Fit button for scaling the preview
- Reuses the existing video pool strategy from `preview-player.tsx`

### Transport Controls

Both viewers share the same transport bar pattern:
```
[timecode] [⏮] [◀] [▶/⏸] [▶▶] [⏭] [duration]
```

Accent color for active timecode: `#c83232` (matching CINEGEN brand).

---

## Timeline Editor

### Timeline Tabs

- Tab bar above the ruler
- Shows timeline names, active tab highlighted
- "+" button creates a new empty timeline (default: 2 video tracks, 2 audio tracks)
- Right-click tab: Rename, Duplicate, Delete (confirm if clips exist)
- "+ V" and "+ A" buttons to add tracks to the active timeline

### Time Ruler

- Horizontal ruler with tick marks at appropriate intervals based on zoom
- Playhead indicator (red triangle + vertical line, color `#c83232`)
- Click ruler to seek
- Drag playhead to scrub

### Track Headers (left column, 60px wide)

**Video track header:**
- Color dot (from track.color)
- Track name (V1, V2, V3...)
- Lock toggle (🔒)
- Visibility toggle (👁)

**Audio track header:**
- Color dot (from track.color)
- Track name (A1, A2...)
- Mute toggle (M)
- Solo toggle (S)

**V/A separator:** A 2px horizontal line between the last video track and first audio track.

### Track Rows

- Horizontal lanes showing clips as rectangles
- Video clips: colored based on track color, show clip name and thumbnail
- Audio clips: green-tinted background, show waveform visualization (existing)
- Clip edges are draggable for trimming (behavior depends on active tool)

### Bottom Bar

- Playback speed dropdown (0.25x, 0.5x, 1x, 2x, 4x)
- Export button
- Zoom slider with +/- buttons and percentage label
- Scroll wheel on timeline area for horizontal scroll; Ctrl+scroll for zoom

---

## Editing Tools

### Tool Sidebar (vertical, 30px wide, left of timeline)

```
[Select]           V
[Track Forward]    A
[Blade]            B
─── separator ───
[Ripple Trim]      (no default)
[Roll Trim]        (no default)
[Slip]             Y
[Slide]            U
─── spacer ───
[Subtitles]        T (future, disabled for now)
```

Active tool highlighted. Tooltip with name + shortcut on hover.

### Tool Behaviors

**Select (V):**
- Click clip to select. Shift+click for multi-select.
- Drag selected clip(s) to move horizontally or between tracks.
- Drag clip left/right edge for basic trim (no ripple).
- Locked tracks: clips cannot be selected or moved.

**Track Select Forward (A):**
- Click a clip to select it + all clips to its right on the same track.
- Drag to move all selected clips together.

**Blade (B):**
- Vertical cut line follows cursor position on timeline.
- Click to split the clip under the cursor at that position.
- Improvement over current: splits at cursor, not just at playhead.

**Ripple Trim:**
- Drag a clip's left or right edge.
- On release, all clips after the edit point shift to close/open the gap.
- Visual: yellow highlight on the clip edge being trimmed.

**Roll Trim:**
- Drag the boundary between two adjacent clips on the same track.
- One clip gets shorter, the other gets longer by the same amount.
- No gaps created — the cut point slides.
- Only works when two clips are adjacent (within snap tolerance).

**Slip (Y):**
- Drag on a clip body to adjust `trimStart` and `trimEnd` simultaneously.
- `startTime` and effective duration stay constant.
- The clip window slides over the source media.
- Visual: show source timecode overlay while slipping.
- Constrained: `trimStart >= 0` and `trimEnd >= 0`.

**Slide (U):**
- Drag a clip to move it between two neighbors.
- The clip's `startTime` changes.
- Left neighbor's `trimEnd` adjusts, right neighbor's `trimStart` adjusts.
- Total timeline duration stays constant.
- Only works when clip has neighbors on the same track.

### Implementation: useTimelineDrag Hook

Single hook that receives the active tool and dispatches to the correct handler:

```typescript
function useTimelineDrag(
  tool: ToolType,
  timeline: Timeline,
  pxPerSecond: number,
  onUpdate: (timeline: Timeline) => void,
  onTrimPreview?: (clipId: string, sourceTime: number) => void
)
```

Each tool handler is a pure function:
```typescript
type DragHandler = (
  timeline: Timeline,
  clipId: string,
  edge: 'left' | 'right' | 'body',
  deltaPx: number,
  pxPerSecond: number
) => Timeline;
```

---

## Track Controls

### Solo Behavior

If any audio track has `solo: true`, only solo'd tracks produce audio output. All non-solo'd audio tracks are silenced regardless of their `muted` state.

### Lock Behavior

Locked tracks reject all edit operations: move, trim, split, delete, blade. Clips on locked tracks cannot be selected. Visual: slight opacity reduction (0.6) on locked track rows.

### Visibility Behavior

Hidden video tracks (`visible: false`) don't contribute to the Timeline Viewer composite. The Source Viewer can still show clips from hidden tracks if explicitly selected. Audio tracks ignore the `visible` flag.

### Add/Remove Tracks

- "+ V" creates a new video track above the V/A separator
- "+ A" creates a new audio track below the V/A separator
- Auto-naming: V1, V2, V3... / A1, A2... (incremented from existing)
- Color from preset palette: `['#e74c3c', '#3498db', '#9b59b6', '#e67e22', '#1abc9c', '#f39c12', '#2ecc71', '#e91e63']`
- Right-click track header for rename/delete (delete confirms if track has clips)

---

## Multi-Timeline

- Each project can have multiple timelines
- Tab bar shows all timeline names
- Click tab to switch active timeline
- "+" creates new timeline with default tracks (V1, V2, A1, A2)
- Right-click tab: Rename, Duplicate, Delete
- Timeline list in left panel mirrors tab bar with additional detail
- `activeTimelineId` stored in workspace state
- Switching timelines resets playhead to 0

---

## State Management Changes

### New Reducer Actions

```typescript
| { type: 'SET_TIMELINE'; timelineId: string; timeline: Timeline }
| { type: 'ADD_TIMELINE'; timeline: Timeline }
| { type: 'REMOVE_TIMELINE'; timelineId: string }
| { type: 'SET_ACTIVE_TIMELINE'; timelineId: string }
```

`SET_TIMELINE` replaces `SET_SEQUENCE` as the primary edit action. It's undoable and persisted.

### Persistence

Same debounced auto-save pattern. The full `timelines` array is saved to the project file. `activeTimelineId` is saved to localStorage (session preference, not project data).

### Undo/Redo

`SET_TIMELINE`, `ADD_TIMELINE`, and `REMOVE_TIMELINE` are undoable. Same 50-state history, same drag debouncing (300ms).

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| V | Select tool |
| A | Track Select Forward tool |
| B | Blade tool |
| Y | Slip tool |
| U | Slide tool |
| Space | Play/pause |
| ← / → | Frame step (1/24 sec) |
| Delete / Backspace | Delete selected clips |
| Cmd+Z | Undo |
| Cmd+Shift+Z | Redo |
| Cmd+= / Cmd+- | Zoom in/out |
| S | Toggle snap |

---

## CSS Approach

- All new styles in a dedicated `edit-tab.css` file (or scoped CSS modules)
- Dark theme matching existing CINEGEN color scheme
- CSS variables for panel backgrounds, borders, accent colors
- No Tailwind — matches existing BEM-style class naming convention
- Existing `globals.css` styles for the edit tab are replaced, not patched

---

## What This Does NOT Include (Future Sub-Projects)

- Clip properties panel (speed, flip, opacity, color correction)
- Transitions (dissolve, fade in/out)
- Playback engine improvements (ref-based timing, pre-seeking, dissolves)
- Real FFmpeg export pipeline
- Subtitle track implementation (button present but disabled)
- Right-side properties panel
