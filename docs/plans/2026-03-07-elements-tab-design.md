# Elements Tab Design

## Overview

New "Elements" tab (first tab, before Create) for managing reusable character, location, prop, and vehicle references. Users upload reference images or generate them via nano-banana-pro from text descriptions.

## Data Model

```typescript
type ElementType = 'character' | 'location' | 'prop' | 'vehicle';

interface ElementImage {
  id: string;
  url: string;
  createdAt: string;
  source: 'upload' | 'generated';
}

interface Element {
  id: string;
  name: string;
  type: ElementType;
  description: string;
  images: ElementImage[];
  createdAt: string;
  updatedAt: string;
}
```

Added to `WorkspaceState.elements: Element[]` and `ProjectSnapshot.elements: Element[]`.

## State Actions

- `ADD_ELEMENT` — adds new element
- `UPDATE_ELEMENT` — updates name/type/description
- `REMOVE_ELEMENT` — deletes element and its images
- `ADD_ELEMENT_IMAGE` — adds image(s) to an element
- `REMOVE_ELEMENT_IMAGE` — removes single image from element

All trigger existing debounced persistence.

## UI Structure

### Grid View (default)

- Top bar: "Elements" heading left, "+ New Element" button right
- Filter chips: All | Characters | Locations | Props | Vehicles
- Responsive card grid (3-4 columns)
- Card: thumbnail (first image or type icon), name, type badge, image count
- Click card → opens detail/edit modal
- Empty state: type icon + "Add your first element" CTA

### Add/Edit Element Modal

- Name input
- Type selector: 4 radio-style buttons with icons (Character, Location, Prop, Vehicle)
- Description textarea
- Image section with two paths:
  - **Upload**: drag-drop zone + file picker, multiple images
  - **Generate**: text description → nano-banana-pro generates 6 images, user keeps/discards individually
- Image grid showing all current images with remove buttons
- Save / Cancel buttons

## Generation Flow

1. User types description in generate input
2. System builds prompt: `"Generate a detailed reference image of [type]: [description]. Consistent style, clear details, neutral background, suitable as a [type] reference sheet."`
3. Calls `/api/workflows` with `nano-banana-pro` model, 6 sequential calls (one per image)
4. Results shown in a pending grid — user clicks to keep or discard each
5. Kept images added to element via `ADD_ELEMENT_IMAGE`

## File Structure

```
types/elements.ts
components/elements/
  elements-tab.tsx
  element-card.tsx
  element-modal.tsx
  element-image-upload.tsx
  element-generate.tsx
```

## Styling

BEM classes in globals.css: `.elements-tab`, `.element-card`, `.element-modal`, etc. Dark theme, accent highlights, consistent with existing patterns.

## Integration Points

- `types/workspace.ts` — extend ProjectTab, WorkspaceState
- `components/workspace/workspace-shell.tsx` — add reducer actions, render ElementsTab
- `components/workspace/top-tabs.tsx` — add Elements to TABS array (first position)
- `lib/persistence/store.ts` — add elements to ProjectSnapshot
- `app/globals.css` — new styles
