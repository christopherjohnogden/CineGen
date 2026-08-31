import { describe, expect, it } from 'vitest';
import { markWorkspaceSavePending } from '@/components/workspace/workspace-persistence';

describe('workspace persistence scheduling', () => {
  it('keeps a completed node save pending through a trailing UI-only running update', () => {
    let pending = false;

    pending = markWorkspaceSavePending(pending, 'SET_NODE_RESULT');
    pending = markWorkspaceSavePending(pending, 'ADD_GENERATION');
    pending = markWorkspaceSavePending(pending, 'SET_NODE_RUNNING');

    expect(pending).toBe(true);
  });

  it('does not schedule a project save for UI-only actions by themselves', () => {
    expect(markWorkspaceSavePending(false, 'SET_NODE_RUNNING')).toBe(false);
    expect(markWorkspaceSavePending(false, 'SET_TAB')).toBe(false);
  });
});
