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
