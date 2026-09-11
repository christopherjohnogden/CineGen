import { useCallback, useRef, useState, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowNodeData } from '@/types/workflow';
import { PromptNode } from '@/components/create/nodes/prompt-node';
import { MultiPromptNode } from '@/components/create/nodes/multi-prompt-node';

type Patch = Partial<WorkflowNodeData> | ((node: { data: WorkflowNodeData }) => Partial<WorkflowNodeData>);
const env = vi.hoisted(() => ({
  update: vi.fn(), dispatch: vi.fn(), flush: () => {},
  external: (_config: Record<string, unknown>) => {},
  data: null as WorkflowNodeData | null,
}));
vi.mock('@xyflow/react', () => ({ useReactFlow: () => ({ updateNodeData: env.update }) }));
vi.mock('@/components/create/nodes/base-node', () => ({
  BaseNode: ({ children, footer, meta }: { children: ReactNode; footer: ReactNode; meta: string }) => <div>{meta}{children}{footer}</div>,
}));
vi.mock('@/components/workspace/workspace-shell', () => ({ useWorkspace: () => ({
  state: { elements: [{ id: 'peter', name: 'Peter', type: 'character', images: [] }] }, dispatch: env.dispatch,
}) }));

function Harness({ sequence = false }: { sequence?: boolean }) {
  const [data, setData] = useState<WorkflowNodeData>({
    type: sequence ? 'multiPrompt' : 'prompt', label: 'Prompt',
    config: sequence ? { shots: [{ prompt: 'Warm voice', duration: 5 }, { prompt: 'Second shot', duration: 7 }] } : { prompt: 'Warm voice', keep: 'original' },
  });
  const current = useRef(data); current.current = data; env.data = data;
  const queue = useRef<Patch[]>([]);
  const apply = useCallback((patch: Patch) => {
    const next = typeof patch === 'function' ? patch({ data: current.current }) : patch;
    current.current = { ...current.current, ...next };
    setData(current.current);
  }, []);
  env.update.mockImplementation((_id: string, patch: Patch) => queue.current.push(patch));
  env.dispatch.mockImplementation((action: { config: Record<string, unknown> }) => queue.current.push(node => ({ config: { ...node.data.config, ...action.config } })));
  env.flush = () => { const patch = queue.current.shift(); if (patch) apply(patch); };
  env.external = (config) => apply(node => ({ config: { ...node.data.config, ...config } }));
  const Component = sequence ? MultiPromptNode : PromptNode;
  return <Component {...{ id: 'prompt', data, selected: true } as any} />;
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Canvas prompt editing', () => {
  it.each([false, true])('keeps middle edits and selection while graph updates are delayed (sequence=%s)', (sequence) => {
    render(<Harness sequence={sequence} />);
    const input = screen.getAllByRole('textbox')[0] as HTMLTextAreaElement;
    input.focus();
    fireEvent.change(input, { target: { value: 'Warm low voice', selectionStart: 9, selectionEnd: 9 } });
    expect(input).toHaveValue('Warm low voice');
    expect(input.selectionStart).toBe(9);
    fireEvent.change(input, { target: { value: 'Warm lower voice', selectionStart: 11, selectionEnd: 11 } });
    act(env.flush); // The older keystroke arrives after the next edit.
    expect(input).toHaveValue('Warm lower voice');
    expect(input.selectionStart).toBe(11);
    act(env.flush);
    expect(input).toHaveValue('Warm lower voice');
    expect(input.selectionStart).toBe(11);
    expect(input).toHaveFocus();
    if (sequence) expect(screen.getAllByRole('textbox')[1]).toHaveValue('Second shot');
  });

  it('accepts an external AI rewrite and preserves other config changes when edits save', () => {
    render(<Harness />);
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Warm low voice', selectionStart: 9, selectionEnd: 9 } });
    act(() => env.external({ keep: 'updated elsewhere' }));
    act(env.flush);
    expect(env.data?.config.keep).toBe('updated elsewhere');
    expect(input).toHaveValue('Warm low voice');
    act(() => env.external({ prompt: 'New AI rewrite' }));
    expect(input).toHaveValue('New AI rewrite');
  });

  it.each([false, true])('inserts a mention mid-prompt without dropping the rest (sequence=%s)', (sequence) => {
    render(<Harness sequence={sequence} />);
    const input = screen.getAllByRole('textbox')[0] as HTMLTextAreaElement;
    input.focus();
    fireEvent.change(input, { target: { value: 'With @Pe by the door', selectionStart: 8, selectionEnd: 8 } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue('With @Peter by the door');
    expect(env.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'APPLY_ELEMENT_MENTION', elementId: 'peter' }));
    act(env.flush);
    expect(input).toHaveValue('With @Peter by the door');
    act(env.flush);
    expect(input).toHaveValue('With @Peter by the door');
  });
});
