# Elements Tab Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an "Elements" tab (before Create) where users manage reusable character, location, prop, and vehicle references with uploaded or AI-generated images.

**Architecture:** New `Element` type stored in workspace state alongside assets/exports. Elements tab renders a filterable card grid with an add/edit modal. Image generation uses existing fal.ai nano-banana-pro integration via `/api/workflows`.

**Tech Stack:** Next.js, React Context + Reducer, fal.ai (nano-banana-pro), BEM CSS in globals.css

---

### Task 1: Element Type Definitions

**Files:**
- Create: `types/elements.ts`
- Modify: `types/workspace.ts:1-18`

**Step 1: Create `types/elements.ts`**

```typescript
export type ElementType = 'character' | 'location' | 'prop' | 'vehicle';

export interface ElementImage {
  id: string;
  url: string;
  createdAt: string;
  source: 'upload' | 'generated';
}

export interface Element {
  id: string;
  name: string;
  type: ElementType;
  description: string;
  images: ElementImage[];
  createdAt: string;
  updatedAt: string;
}
```

**Step 2: Update `types/workspace.ts`**

Add `'elements'` to `ProjectTab` and `elements: Element[]` to `WorkspaceState`:

```typescript
import type { Node, Edge } from '@xyflow/react';
import type { Asset } from './project';
import type { Sequence } from './editor';
import type { ExportJob } from './export';
import type { WorkflowNodeData, WorkflowRun } from './workflow';
import type { Element } from './elements';

export type ProjectTab = 'elements' | 'create' | 'edit' | 'export';

export interface WorkspaceState {
  activeTab: ProjectTab;
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
  assets: Asset[];
  sequence: Sequence;
  currentRun: WorkflowRun | null;
  runningNodeIds: Set<string>;
  exports: ExportJob[];
  elements: Element[];
}
```

**Step 3: Commit**

```bash
git add types/elements.ts types/workspace.ts
git commit -m "feat: add Element type definitions and extend WorkspaceState"
```

---

### Task 2: Persistence & State Management

**Files:**
- Modify: `lib/persistence/store.ts:6-51`
- Modify: `components/workspace/workspace-shell.tsx:1-246`

**Step 1: Add `elements` to `ProjectSnapshot` in `lib/persistence/store.ts`**

Add `elements: unknown[];` after line 23 (`exports: unknown[];`):

```typescript
export interface ProjectSnapshot {
  project: {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
  };
  workflow: {
    nodes: unknown[];
    edges: unknown[];
  };
  sequence: {
    id: string;
    tracks: unknown[];
    duration: number;
  };
  assets: unknown[];
  exports: unknown[];
  elements: unknown[];
}
```

Add `elements: [],` to `defaultSnapshot()` after the `exports: [],` line.

**Step 2: Add element actions and reducer cases to `workspace-shell.tsx`**

Add import at top:
```typescript
import type { Element } from '@/types/elements';
```

Add to `WorkspaceAction` union (after the `UPDATE_EXPORT` line):
```typescript
  | { type: 'ADD_ELEMENT'; element: Element }
  | { type: 'UPDATE_ELEMENT'; elementId: string; updates: Partial<Element> }
  | { type: 'REMOVE_ELEMENT'; elementId: string }
```

Add `elements` to `HydratePayload`:
```typescript
interface HydratePayload {
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
  assets: Asset[];
  sequence: Sequence;
  exports: ExportJob[];
  elements: Element[];
}
```

Add `elements: [],` to `initialState`.

Add reducer cases before `case 'HYDRATE':`:
```typescript
    case 'ADD_ELEMENT':
      return { ...state, elements: [...state.elements, action.element] };

    case 'UPDATE_ELEMENT':
      return {
        ...state,
        elements: state.elements.map((el) =>
          el.id === action.elementId ? { ...el, ...action.updates, updatedAt: new Date().toISOString() } : el,
        ),
      };

    case 'REMOVE_ELEMENT':
      return { ...state, elements: state.elements.filter((el) => el.id !== action.elementId) };
```

Add `elements` to the `HYDRATE` case:
```typescript
    case 'HYDRATE':
      return {
        ...state,
        nodes: action.payload.nodes,
        edges: action.payload.edges,
        assets: action.payload.assets,
        sequence: action.payload.sequence,
        exports: action.payload.exports,
        elements: action.payload.elements,
      };
```

Add `'ADD_ELEMENT', 'UPDATE_ELEMENT', 'REMOVE_ELEMENT'` to `PERSIST_ACTIONS`.

In the hydration `fetch` callback, add:
```typescript
const elements = (snapshot.elements ?? []) as Element[];
```
And pass `elements` in the HYDRATE dispatch payload.

In the persistence `useEffect`, add `state.elements` to the PATCH body:
```typescript
body: JSON.stringify({
  workflow: { nodes: serializableNodes, edges: state.edges },
  assets: state.assets,
  sequence: state.sequence,
  exports: state.exports,
  elements: state.elements,
}),
```
And add `state.elements` to the dependency array.

**Step 3: Commit**

```bash
git add lib/persistence/store.ts components/workspace/workspace-shell.tsx
git commit -m "feat: add elements to state management and persistence"
```

---

### Task 3: Tab Navigation & Shell Wiring

**Files:**
- Modify: `components/workspace/top-tabs.tsx:6-10`
- Modify: `components/workspace/workspace-shell.tsx:12-14,238-242`
- Create: `components/elements/elements-tab.tsx` (placeholder)

**Step 1: Add Elements tab to `top-tabs.tsx`**

Update the TABS array to put Elements first:
```typescript
const TABS: { id: ProjectTab; label: string }[] = [
  { id: 'elements', label: 'Elements' },
  { id: 'create', label: 'Create' },
  { id: 'edit', label: 'Edit' },
  { id: 'export', label: 'Export' },
];
```

**Step 2: Create placeholder `components/elements/elements-tab.tsx`**

```typescript
'use client';

export function ElementsTab() {
  return (
    <div className="elements-tab">
      <div className="elements-tab__header">
        <h2 className="elements-tab__title">Elements</h2>
      </div>
    </div>
  );
}
```

**Step 3: Wire into `workspace-shell.tsx`**

Add import:
```typescript
import { ElementsTab } from '@/components/elements/elements-tab';
```

Add render before CreateTab:
```typescript
<main className="workspace-content">
  {state.activeTab === 'elements' && <ElementsTab />}
  {state.activeTab === 'create' && <CreateTab />}
  {state.activeTab === 'edit' && <EditTab />}
  {state.activeTab === 'export' && <ExportTab />}
</main>
```

**Step 4: Commit**

```bash
git add components/workspace/top-tabs.tsx components/elements/elements-tab.tsx components/workspace/workspace-shell.tsx
git commit -m "feat: wire Elements tab into navigation and shell"
```

---

### Task 4: Element Card Component

**Files:**
- Create: `components/elements/element-card.tsx`
- Modify: `app/globals.css` (append styles)

**Step 1: Create `components/elements/element-card.tsx`**

```typescript
'use client';

import type { Element } from '@/types/elements';

const TYPE_ICONS: Record<string, string> = {
  character: '👤',
  location: '🏔',
  prop: '🎬',
  vehicle: '🚗',
};

interface ElementCardProps {
  element: Element;
  onClick: () => void;
}

export function ElementCard({ element, onClick }: ElementCardProps) {
  const thumbnail = element.images[0]?.url;

  return (
    <button className="element-card" onClick={onClick} type="button">
      <div className="element-card__thumbnail">
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnail} alt={element.name} className="element-card__image" />
        ) : (
          <span className="element-card__icon">{TYPE_ICONS[element.type] ?? '📦'}</span>
        )}
      </div>
      <div className="element-card__info">
        <span className="element-card__name">{element.name}</span>
        <span className="element-card__meta">
          <span className="element-card__type-badge">{element.type}</span>
          <span className="element-card__count">{element.images.length} img{element.images.length !== 1 ? 's' : ''}</span>
        </span>
      </div>
    </button>
  );
}
```

**Step 2: Add CSS to `app/globals.css`**

Append before the `/* Edit Tab */` section:

```css
/* ============================================
   Elements Tab
   ============================================ */

.elements-tab {
  height: calc(100vh - 52px);
  display: flex;
  flex-direction: column;
  padding: 32px 40px;
  overflow-y: auto;
}

.elements-tab__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
  flex-shrink: 0;
}

.elements-tab__title {
  font-size: 24px;
  font-weight: 600;
  color: var(--text-primary);
}

.elements-tab__add-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: var(--accent);
  color: var(--bg-base);
  border: none;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--transition-fast);
}
.elements-tab__add-btn:hover {
  background: var(--accent-hover);
}

.elements-tab__filters {
  display: flex;
  gap: 8px;
  margin-bottom: 24px;
  flex-shrink: 0;
}

.elements-tab__filter {
  padding: 6px 14px;
  border-radius: 20px;
  border: 1px solid var(--border-medium);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.elements-tab__filter:hover {
  color: var(--text-primary);
  border-color: var(--accent);
}
.elements-tab__filter--active {
  background: var(--accent-dim);
  color: var(--accent);
  border-color: var(--accent);
}

.elements-tab__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}

.elements-tab__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 80px 0;
  color: var(--text-tertiary);
}
.elements-tab__empty-icon {
  font-size: 48px;
  opacity: 0.4;
}
.elements-tab__empty-text {
  font-size: 14px;
}

/* Element Card */

.element-card {
  display: flex;
  flex-direction: column;
  background: var(--bg-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  overflow: hidden;
  cursor: pointer;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
  text-align: left;
}
.element-card:hover {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}

.element-card__thumbnail {
  width: 100%;
  aspect-ratio: 4 / 3;
  background: var(--bg-elevated);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.element-card__image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.element-card__icon {
  font-size: 36px;
  opacity: 0.5;
}

.element-card__info {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.element-card__name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.element-card__meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.element-card__type-badge {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--accent);
  background: var(--accent-dim);
  padding: 2px 8px;
  border-radius: 10px;
}

.element-card__count {
  font-size: 11px;
  color: var(--text-tertiary);
}
```

**Step 3: Commit**

```bash
git add components/elements/element-card.tsx app/globals.css
git commit -m "feat: add ElementCard component and grid styles"
```

---

### Task 5: Element Modal — Layout & Form Fields

**Files:**
- Create: `components/elements/element-modal.tsx`
- Modify: `app/globals.css` (append modal styles)

**Step 1: Create `components/elements/element-modal.tsx`**

```typescript
'use client';

import { useState, useCallback } from 'react';
import type { Element, ElementType, ElementImage } from '@/types/elements';
import { ElementImageUpload } from './element-image-upload';
import { ElementGenerate } from './element-generate';

const ELEMENT_TYPES: { id: ElementType; label: string; icon: string }[] = [
  { id: 'character', label: 'Character', icon: '👤' },
  { id: 'location', label: 'Location', icon: '🏔' },
  { id: 'prop', label: 'Prop', icon: '🎬' },
  { id: 'vehicle', label: 'Vehicle', icon: '🚗' },
];

interface ElementModalProps {
  element?: Element;
  onSave: (data: { name: string; type: ElementType; description: string; images: ElementImage[] }) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export function ElementModal({ element, onSave, onDelete, onClose }: ElementModalProps) {
  const [name, setName] = useState(element?.name ?? '');
  const [type, setType] = useState<ElementType>(element?.type ?? 'character');
  const [description, setDescription] = useState(element?.description ?? '');
  const [images, setImages] = useState<ElementImage[]>(element?.images ?? []);
  const [activeImageTab, setActiveImageTab] = useState<'upload' | 'generate'>('upload');

  const handleAddImages = useCallback((newImages: ElementImage[]) => {
    setImages((prev) => [...prev, ...newImages]);
  }, []);

  const handleRemoveImage = useCallback((imageId: string) => {
    setImages((prev) => prev.filter((img) => img.id !== imageId));
  }, []);

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({ name: name.trim(), type, description: description.trim(), images });
  };

  return (
    <div className="element-modal__backdrop" onClick={onClose}>
      <div className="element-modal" onClick={(e) => e.stopPropagation()}>
        <div className="element-modal__header">
          <h3 className="element-modal__title">{element ? 'Edit Element' : 'New Element'}</h3>
          <button className="element-modal__close" onClick={onClose} type="button">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="element-modal__body">
          <div className="element-modal__field">
            <label className="element-modal__label">Name</label>
            <input
              className="element-modal__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Detective Sarah"
            />
          </div>

          <div className="element-modal__field">
            <label className="element-modal__label">Type</label>
            <div className="element-modal__type-grid">
              {ELEMENT_TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`element-modal__type-btn ${type === t.id ? 'element-modal__type-btn--active' : ''}`}
                  onClick={() => setType(t.id)}
                >
                  <span>{t.icon}</span>
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="element-modal__field">
            <label className="element-modal__label">Description</label>
            <textarea
              className="element-modal__textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe this element in detail..."
              rows={3}
            />
          </div>

          <div className="element-modal__field">
            <label className="element-modal__label">Reference Images</label>

            <div className="element-modal__image-tabs">
              <button
                type="button"
                className={`element-modal__image-tab ${activeImageTab === 'upload' ? 'element-modal__image-tab--active' : ''}`}
                onClick={() => setActiveImageTab('upload')}
              >
                Upload
              </button>
              <button
                type="button"
                className={`element-modal__image-tab ${activeImageTab === 'generate' ? 'element-modal__image-tab--active' : ''}`}
                onClick={() => setActiveImageTab('generate')}
              >
                Generate
              </button>
            </div>

            {activeImageTab === 'upload' && (
              <ElementImageUpload onUpload={handleAddImages} />
            )}
            {activeImageTab === 'generate' && (
              <ElementGenerate
                elementType={type}
                description={description}
                onGenerated={handleAddImages}
              />
            )}

            {images.length > 0 && (
              <div className="element-modal__image-grid">
                {images.map((img) => (
                  <div key={img.id} className="element-modal__image-item">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt="" className="element-modal__image-thumb" />
                    <button
                      type="button"
                      className="element-modal__image-remove"
                      onClick={() => handleRemoveImage(img.id)}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="element-modal__footer">
          {element && onDelete && (
            <button type="button" className="element-modal__delete-btn" onClick={onDelete}>Delete</button>
          )}
          <div className="element-modal__footer-right">
            <button type="button" className="element-modal__cancel-btn" onClick={onClose}>Cancel</button>
            <button type="button" className="element-modal__save-btn" onClick={handleSave} disabled={!name.trim()}>
              {element ? 'Save' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Add modal CSS to `app/globals.css`**

Append after the element card styles:

```css
/* Element Modal */

.element-modal__backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.element-modal {
  width: 90vw;
  max-width: 640px;
  max-height: 85vh;
  background: var(--bg-raised);
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.element-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-subtle);
}

.element-modal__title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.element-modal__close {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: color var(--transition-fast);
}
.element-modal__close:hover {
  color: var(--text-primary);
}

.element-modal__body {
  padding: 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.element-modal__field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.element-modal__label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-secondary);
}

.element-modal__input,
.element-modal__textarea {
  padding: 10px 12px;
  background: var(--bg-input);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 14px;
  font-family: inherit;
  resize: vertical;
  transition: border-color var(--transition-fast);
}
.element-modal__input:focus,
.element-modal__textarea:focus {
  outline: none;
  border-color: var(--accent);
}

.element-modal__type-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.element-modal__type-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 8px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.element-modal__type-btn:hover {
  border-color: var(--accent);
  color: var(--text-primary);
}
.element-modal__type-btn--active {
  border-color: var(--accent);
  background: var(--accent-dim);
  color: var(--accent);
}

.element-modal__image-tabs {
  display: flex;
  gap: 4px;
  background: var(--bg-elevated);
  border-radius: var(--radius-md);
  padding: 3px;
}

.element-modal__image-tab {
  flex: 1;
  padding: 6px 12px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.element-modal__image-tab--active {
  background: var(--bg-raised);
  color: var(--text-primary);
}

.element-modal__image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 8px;
  margin-top: 12px;
}

.element-modal__image-item {
  position: relative;
  aspect-ratio: 1;
  border-radius: var(--radius-md);
  overflow: hidden;
  border: 1px solid var(--border-subtle);
}

.element-modal__image-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.element-modal__image-remove {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.7);
  color: var(--text-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--transition-fast);
}
.element-modal__image-item:hover .element-modal__image-remove {
  opacity: 1;
}

.element-modal__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-top: 1px solid var(--border-subtle);
}

.element-modal__footer-right {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.element-modal__cancel-btn {
  padding: 8px 16px;
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: color var(--transition-fast);
}
.element-modal__cancel-btn:hover {
  color: var(--text-primary);
}

.element-modal__save-btn {
  padding: 8px 20px;
  border: none;
  border-radius: var(--radius-md);
  background: var(--accent);
  color: var(--bg-base);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--transition-fast);
}
.element-modal__save-btn:hover {
  background: var(--accent-hover);
}
.element-modal__save-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.element-modal__delete-btn {
  padding: 8px 16px;
  border: 1px solid var(--error);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--error);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background var(--transition-fast);
}
.element-modal__delete-btn:hover {
  background: rgba(199, 84, 80, 0.1);
}
```

**Step 3: Commit**

```bash
git add components/elements/element-modal.tsx app/globals.css
git commit -m "feat: add ElementModal component with form fields and styles"
```

---

### Task 6: Image Upload Component

**Files:**
- Create: `components/elements/element-image-upload.tsx`
- Modify: `app/globals.css` (append upload zone styles)

**Step 1: Create `components/elements/element-image-upload.tsx`**

```typescript
'use client';

import { useRef, useState, useCallback } from 'react';
import type { ElementImage } from '@/types/elements';

interface ElementImageUploadProps {
  onUpload: (images: ElementImage[]) => void;
}

export function ElementImageUpload({ onUpload }: ElementImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const processFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    const newImages: ElementImage[] = imageFiles.map((file) => ({
      id: crypto.randomUUID(),
      url: URL.createObjectURL(file),
      createdAt: new Date().toISOString(),
      source: 'upload' as const,
    }));

    onUpload(newImages);
  }, [onUpload]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    processFiles(e.dataTransfer.files);
  }, [processFiles]);

  return (
    <div
      className={`element-upload ${isDragging ? 'element-upload--dragging' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="element-upload__input"
        onChange={(e) => processFiles(e.target.files)}
      />
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="element-upload__icon">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
      <span className="element-upload__text">Drop images here or click to browse</span>
    </div>
  );
}
```

**Step 2: Add upload zone CSS to `app/globals.css`**

```css
/* Element Upload */

.element-upload {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  border: 2px dashed var(--border-medium);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: border-color var(--transition-fast), background var(--transition-fast);
}
.element-upload:hover,
.element-upload--dragging {
  border-color: var(--accent);
  background: var(--accent-dim);
}

.element-upload__input {
  display: none;
}

.element-upload__icon {
  color: var(--text-tertiary);
}

.element-upload__text {
  font-size: 12px;
  color: var(--text-tertiary);
}
```

**Step 3: Commit**

```bash
git add components/elements/element-image-upload.tsx app/globals.css
git commit -m "feat: add drag-drop image upload for elements"
```

---

### Task 7: Image Generation Component

**Files:**
- Create: `components/elements/element-generate.tsx`
- Modify: `app/globals.css` (append generate styles)

**Step 1: Create `components/elements/element-generate.tsx`**

This calls the existing `/api/workflows` endpoint with nano-banana-pro, 6 times sequentially.

```typescript
'use client';

import { useState, useCallback } from 'react';
import type { ElementType, ElementImage } from '@/types/elements';

interface ElementGenerateProps {
  elementType: ElementType;
  description: string;
  onGenerated: (images: ElementImage[]) => void;
}

function buildPrompt(type: ElementType, description: string): string {
  const typeLabels: Record<ElementType, string> = {
    character: 'character',
    location: 'location/environment',
    prop: 'prop/object',
    vehicle: 'vehicle',
  };
  return `Generate a detailed reference image of a ${typeLabels[type]}: ${description}. Consistent style, clear details, neutral background, suitable as a ${typeLabels[type]} reference sheet for film production.`;
}

export function ElementGenerate({ elementType, description, onGenerated }: ElementGenerateProps) {
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [pendingImages, setPendingImages] = useState<ElementImage[]>([]);

  const handleGenerate = useCallback(async () => {
    const desc = prompt.trim() || description.trim();
    if (!desc) return;

    setGenerating(true);
    setProgress(0);
    setPendingImages([]);

    const fullPrompt = buildPrompt(elementType, desc);
    const generated: ElementImage[] = [];

    for (let i = 0; i < 6; i++) {
      try {
        const res = await fetch('/api/workflows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nodeId: 'element-gen',
            nodeType: 'nano-banana-pro',
            modelId: 'fal-ai/nano-banana-pro',
            inputs: {
              prompt: fullPrompt,
              resolution: '1K',
              aspect_ratio: '1:1',
              seed: Math.floor(Math.random() * 999999),
            },
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const url = data?.images?.[0]?.url;
          if (url) {
            const img: ElementImage = {
              id: crypto.randomUUID(),
              url,
              createdAt: new Date().toISOString(),
              source: 'generated',
            };
            generated.push(img);
            setPendingImages([...generated]);
          }
        }
      } catch {
        /* continue generating remaining images */
      }
      setProgress(i + 1);
    }

    setGenerating(false);
  }, [prompt, description, elementType]);

  const handleKeepAll = () => {
    onGenerated(pendingImages);
    setPendingImages([]);
    setProgress(0);
  };

  const handleKeepImage = (img: ElementImage) => {
    onGenerated([img]);
    setPendingImages((prev) => prev.filter((p) => p.id !== img.id));
  };

  const handleDiscardImage = (imageId: string) => {
    setPendingImages((prev) => prev.filter((p) => p.id !== imageId));
  };

  return (
    <div className="element-generate">
      <div className="element-generate__input-row">
        <input
          className="element-modal__input element-generate__prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={description || 'Describe what to generate...'}
          disabled={generating}
        />
        <button
          type="button"
          className="element-generate__btn"
          onClick={handleGenerate}
          disabled={generating || (!prompt.trim() && !description.trim())}
        >
          {generating ? `${progress}/6` : 'Generate'}
        </button>
      </div>

      {generating && (
        <div className="element-generate__progress">
          <div className="element-generate__progress-bar" style={{ width: `${(progress / 6) * 100}%` }} />
        </div>
      )}

      {pendingImages.length > 0 && (
        <div className="element-generate__results">
          <div className="element-generate__results-header">
            <span className="element-generate__results-label">Generated — click to keep</span>
            {pendingImages.length > 1 && (
              <button type="button" className="element-generate__keep-all" onClick={handleKeepAll}>Keep all</button>
            )}
          </div>
          <div className="element-generate__results-grid">
            {pendingImages.map((img) => (
              <div key={img.id} className="element-generate__result-item">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt="" className="element-generate__result-img" />
                <div className="element-generate__result-actions">
                  <button type="button" className="element-generate__result-keep" onClick={() => handleKeepImage(img)} title="Keep">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </button>
                  <button type="button" className="element-generate__result-discard" onClick={() => handleDiscardImage(img.id)} title="Discard">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Add generate styles to `app/globals.css`**

```css
/* Element Generate */

.element-generate {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.element-generate__input-row {
  display: flex;
  gap: 8px;
}

.element-generate__prompt {
  flex: 1;
}

.element-generate__btn {
  padding: 8px 16px;
  border: none;
  border-radius: var(--radius-md);
  background: var(--accent);
  color: var(--bg-base);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--transition-fast);
}
.element-generate__btn:hover {
  background: var(--accent-hover);
}
.element-generate__btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.element-generate__progress {
  height: 3px;
  background: var(--bg-elevated);
  border-radius: 2px;
  overflow: hidden;
}

.element-generate__progress-bar {
  height: 100%;
  background: var(--accent);
  transition: width 0.3s ease;
}

.element-generate__results {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.element-generate__results-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.element-generate__results-label {
  font-size: 11px;
  color: var(--text-tertiary);
}

.element-generate__keep-all {
  font-size: 11px;
  font-weight: 600;
  color: var(--accent);
  background: none;
  border: none;
  cursor: pointer;
}

.element-generate__results-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.element-generate__result-item {
  position: relative;
  aspect-ratio: 1;
  border-radius: var(--radius-md);
  overflow: hidden;
  border: 1px solid var(--border-subtle);
}

.element-generate__result-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.element-generate__result-actions {
  position: absolute;
  bottom: 4px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity var(--transition-fast);
}
.element-generate__result-item:hover .element-generate__result-actions {
  opacity: 1;
}

.element-generate__result-keep,
.element-generate__result-discard {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.element-generate__result-keep {
  background: var(--success);
  color: white;
}

.element-generate__result-discard {
  background: var(--error);
  color: white;
}
```

**Step 3: Commit**

```bash
git add components/elements/element-generate.tsx app/globals.css
git commit -m "feat: add AI image generation for elements via nano-banana-pro"
```

---

### Task 8: Wire Up Elements Tab with Full Functionality

**Files:**
- Modify: `components/elements/elements-tab.tsx`

**Step 1: Replace placeholder with full implementation**

```typescript
'use client';

import { useState, useCallback } from 'react';
import { useWorkspace } from '@/components/workspace/workspace-shell';
import { ElementCard } from './element-card';
import { ElementModal } from './element-modal';
import type { Element, ElementType, ElementImage } from '@/types/elements';

const FILTERS: { id: ElementType | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'character', label: 'Characters' },
  { id: 'location', label: 'Locations' },
  { id: 'prop', label: 'Props' },
  { id: 'vehicle', label: 'Vehicles' },
];

export function ElementsTab() {
  const { state, dispatch } = useWorkspace();
  const [filter, setFilter] = useState<ElementType | 'all'>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingElement, setEditingElement] = useState<Element | undefined>();

  const filtered = filter === 'all'
    ? state.elements
    : state.elements.filter((el) => el.type === filter);

  const handleAdd = useCallback(() => {
    setEditingElement(undefined);
    setModalOpen(true);
  }, []);

  const handleEdit = useCallback((element: Element) => {
    setEditingElement(element);
    setModalOpen(true);
  }, []);

  const handleSave = useCallback((data: { name: string; type: ElementType; description: string; images: ElementImage[] }) => {
    if (editingElement) {
      dispatch({
        type: 'UPDATE_ELEMENT',
        elementId: editingElement.id,
        updates: { ...data },
      });
    } else {
      const now = new Date().toISOString();
      dispatch({
        type: 'ADD_ELEMENT',
        element: {
          id: crypto.randomUUID(),
          ...data,
          createdAt: now,
          updatedAt: now,
        },
      });
    }
    setModalOpen(false);
    setEditingElement(undefined);
  }, [editingElement, dispatch]);

  const handleDelete = useCallback(() => {
    if (!editingElement) return;
    dispatch({ type: 'REMOVE_ELEMENT', elementId: editingElement.id });
    setModalOpen(false);
    setEditingElement(undefined);
  }, [editingElement, dispatch]);

  const handleClose = useCallback(() => {
    setModalOpen(false);
    setEditingElement(undefined);
  }, []);

  return (
    <div className="elements-tab">
      <div className="elements-tab__header">
        <h2 className="elements-tab__title">Elements</h2>
        <button className="elements-tab__add-btn" onClick={handleAdd} type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Element
        </button>
      </div>

      <div className="elements-tab__filters">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`elements-tab__filter ${filter === f.id ? 'elements-tab__filter--active' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="elements-tab__empty">
          <span className="elements-tab__empty-icon">📦</span>
          <span className="elements-tab__empty-text">
            {state.elements.length === 0
              ? 'Add your first element to get started'
              : 'No elements match this filter'}
          </span>
          {state.elements.length === 0 && (
            <button className="elements-tab__add-btn" onClick={handleAdd} type="button">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New Element
            </button>
          )}
        </div>
      ) : (
        <div className="elements-tab__grid">
          {filtered.map((el) => (
            <ElementCard key={el.id} element={el} onClick={() => handleEdit(el)} />
          ))}
        </div>
      )}

      {modalOpen && (
        <ElementModal
          element={editingElement}
          onSave={handleSave}
          onDelete={editingElement ? handleDelete : undefined}
          onClose={handleClose}
        />
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add components/elements/elements-tab.tsx
git commit -m "feat: complete ElementsTab with grid, filters, and modal integration"
```

---

### Task 9: Verify & Fix Build

**Step 1: Run the dev server and verify no TypeScript errors**

Run: `npx next build` or `npx tsc --noEmit`

Expected: Clean build with no errors.

**Step 2: Fix any issues found**

Common things to check:
- `WorkspaceAction` type union includes all new actions
- `PERSIST_ACTIONS` array includes the new action types
- `HydratePayload` includes `elements`
- Dependency arrays in `useEffect` include `state.elements`

**Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve build errors for elements feature"
```
