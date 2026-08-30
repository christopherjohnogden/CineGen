export type ElementType = 'character' | 'location' | 'prop' | 'vehicle';

export interface ElementImage {
  id: string;
  url: string;
  createdAt: string;
  source: 'upload' | 'generated';
}

export type ElementVariationKind = 'baseline' | 'wardrobe' | 'condition' | 'time' | 'custom';

/**
 * A production-continuity state of one canonical element. Variations keep the
 * same identity/design while changing only what the story requires (wardrobe,
 * damage, age, weather, dressing, and similar state changes).
 */
export interface ElementVariation {
  id: string;
  name: string;
  kind: ElementVariationKind;
  description: string;
  images: ElementImage[];
  sourceVariationId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ElementFolder {
  id: string;
  name: string;
  createdAt: string;
  /** Set when this folder was created for a CineGen project. */
  sourceProjectId?: string;
}

export interface Element {
  id: string;
  name: string;
  type: ElementType;
  description: string;
  images: ElementImage[];
  /** Optional continuity looks. Legacy elements continue to use `images`. */
  variations?: ElementVariation[];
  /** Default look used by Director and anywhere a look is not chosen explicitly. */
  activeVariationId?: string;
  createdAt: string;
  updatedAt: string;
  folderId?: string;
}

export interface ElementsLibrary {
  version: 1;
  folders: ElementFolder[];
  elements: Element[];
}

export type ElementFolderFilter = 'all' | 'unfiled' | string;
