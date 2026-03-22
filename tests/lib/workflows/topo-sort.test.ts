import { describe, it, expect } from 'vitest';
import { topologicalSort } from '@/lib/workflows/topo-sort';

describe('topologicalSort', () => {
  it('sorts a linear chain correctly', () => {
    const nodes = [
      { id: 'a', position: { x: 0, y: 0 }, data: {} },
      { id: 'b', position: { x: 0, y: 0 }, data: {} },
      { id: 'c', position: { x: 0, y: 0 }, data: {} },
    ];
    const edges = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
    ];
    const result = topologicalSort(nodes as any, edges as any);
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('handles diamond dependency', () => {
    const nodes = [
      { id: 'a', position: { x: 0, y: 0 }, data: {} },
      { id: 'b', position: { x: 0, y: 0 }, data: {} },
      { id: 'c', position: { x: 0, y: 0 }, data: {} },
      { id: 'd', position: { x: 0, y: 0 }, data: {} },
    ];
    const edges = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'a', target: 'c' },
      { id: 'e3', source: 'b', target: 'd' },
      { id: 'e4', source: 'c', target: 'd' },
    ];
    const result = topologicalSort(nodes as any, edges as any);
    expect(result[0]).toBe('a');
    expect(result[result.length - 1]).toBe('d');
    expect(result.indexOf('b')).toBeLessThan(result.indexOf('d'));
    expect(result.indexOf('c')).toBeLessThan(result.indexOf('d'));
  });

  it('throws on cycle', () => {
    const nodes = [
      { id: 'a', position: { x: 0, y: 0 }, data: {} },
      { id: 'b', position: { x: 0, y: 0 }, data: {} },
    ];
    const edges = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'a' },
    ];
    expect(() => topologicalSort(nodes as any, edges as any)).toThrow('cycle');
  });

  it('handles single node with no edges', () => {
    const nodes = [{ id: 'a', position: { x: 0, y: 0 }, data: {} }];
    const result = topologicalSort(nodes as any, []);
    expect(result).toEqual(['a']);
  });
});
