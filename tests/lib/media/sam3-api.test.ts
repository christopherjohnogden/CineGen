import { describe, expect, it } from 'vitest';
import {
  resolveSam3ApiUrl,
  sam3ImageSource,
  toSam3MediaReference,
} from '@/lib/media/sam3-api';

describe('sam3 browser endpoint helpers', () => {
  it('uses the web proxy base URL when the platform provides one', () => {
    expect(resolveSam3ApiUrl({ port: 0, baseUrl: '/api/sam3' }))
      .toBe(`${window.location.origin}/api/sam3`);
  });

  it('keeps the desktop localhost endpoint compatible', () => {
    expect(resolveSam3ApiUrl({ port: 49152 })).toBe('http://localhost:49152');
  });

  it('converts same-origin browser media to a server media path', () => {
    const source = `${window.location.origin}/media/projects/p1/imported/a/still.png`;
    expect(toSam3MediaReference(source)).toBe('/media/projects/p1/imported/a/still.png');
    expect(sam3ImageSource(source)).toEqual({
      image_path: '/media/projects/p1/imported/a/still.png',
    });
  });

  it('keeps public images as URL inputs', () => {
    expect(sam3ImageSource('https://cdn.example.com/still.png')).toEqual({
      image_url: 'https://cdn.example.com/still.png',
    });
  });
});
