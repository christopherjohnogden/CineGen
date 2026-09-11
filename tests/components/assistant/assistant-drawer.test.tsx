import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantDrawer } from '@/components/assistant/assistant-drawer';
import { assistantStorageKey } from '@/lib/assistant/assistant';
import { createInitialWorkspaceState } from '@/lib/mcp/workspace-state';

const mocks = vi.hoisted(() => ({ detect: vi.fn(), run: vi.fn() }));
vi.mock('@/lib/director/run-llm', () => ({ runDirectorTextJob: mocks.run }));
vi.mock('@/lib/utils/api-key', () => ({ getApiKey: () => undefined, getOpenAiApiKey: () => undefined }));
vi.mock('@/components/assistant/assistant-message', () => ({
  AssistantMessageView: ({ message }: { message: { content: string } }) => <div>{message.content}</div>,
}));

describe('Assistant drawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.electronAPI = { llm: { cliDetect: mocks.detect } } as unknown as typeof window.electronAPI;
    Element.prototype.scrollIntoView = vi.fn();
    mocks.detect.mockResolvedValue({ providers: [
      { id: 'claude-code', installed: true, authenticated: false },
      { id: 'codex', installed: true, authenticated: true },
    ] });
    mocks.run.mockResolvedValue('Four image nodes.');
  });
  afterEach(cleanup);

  it('routes to signed-in Codex and supplies live nodes without replaying old errors', async () => {
    const state = createInitialWorkspaceState();
    state.nodes = Array.from({ length: 4 }, (_, i) => ({
      id: `live-image-${i}`, type: 'filePicker', position: { x: i, y: 0 },
      data: { type: 'filePicker', label: `Image ${i}`, config: { fileType: 'image' } },
    }));
    // Saved Space still has no nodes; the live canvas is authoritative.
    localStorage.setItem(assistantStorageKey('project'), JSON.stringify({ provider: 'claude-code', messages: [
      { role: 'user', content: 'Earlier question' },
      { role: 'assistant', content: "Error invoking remote method 'llm:claude-code-chat': Error: Sign in" },
    ] }));
    render(<AssistantDrawer open onClose={vi.fn()} projectId="project" state={state} dispatch={vi.fn()} />);
    await screen.findByRole('button', { name: 'Codex' });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Can you see the four image nodes?' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', metaKey: true });
    await screen.findByText('Four image nodes.');
    const [system, , provider, history] = mocks.run.mock.calls[0];
    expect(provider).toBe('codex');
    expect(system).toContain('Nodes: 4');
    expect(system).toContain('live-image-3');
    expect(system).not.toContain('— 0 nodes');
    expect(history).not.toEqual(expect.arrayContaining([expect.objectContaining({ error: true })]));
    expect(JSON.stringify(history)).not.toContain('remote method');
  });

  it('refreshes sign-in on focus and keeps a pending reply out of another project', async () => {
    mocks.detect.mockResolvedValueOnce({ providers: [{ id: 'codex', installed: true, authenticated: false }] });
    let finish!: (value: string) => void;
    mocks.run.mockReturnValue(new Promise<string>((resolve) => { finish = resolve; }));
    const state = createInitialWorkspaceState();
    const props = { open: true, onClose: vi.fn(), state, dispatch: vi.fn() };
    const { rerender } = render(<AssistantDrawer {...props} projectId="old" />);
    await waitFor(() => expect(mocks.detect).toHaveBeenCalledTimes(1));
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await screen.findByRole('button', { name: 'Codex' });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hello' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', ctrlKey: true });
    expect(mocks.run).toHaveBeenCalledTimes(1);
    rerender(<AssistantDrawer {...props} projectId="new" />);
    await act(async () => finish('Reply from old project'));
    expect(screen.queryByText('Reply from old project')).not.toBeInTheDocument();
  });
});
