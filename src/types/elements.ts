export type ElementType = 'character' | 'location' | 'prop' | 'vehicle';

export interface ElementImage {
  id: string;
  url: string;
  createdAt: string;
  source: 'upload' | 'generated';
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
