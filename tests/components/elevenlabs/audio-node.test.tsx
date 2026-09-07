import { useCallback, useRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ElevenLabsAudioNode } from '@/components/create/nodes/elevenlabs-audio-node';
const env = vi.hoisted(() => ({ flow: {} as any, dispatch: vi.fn(), run: vi.fn(), design: vi.fn(), saveVoice: vi.fn(), enhance: vi.fn(), node: null as any, flush: () => {} }));
vi.mock('@xyflow/react', () => ({ useReactFlow: () => env.flow }));
vi.mock('@/components/create/nodes/base-node', () => ({ BaseNode: ({ children }: any) => <div>{children}</div> }));
vi.mock('@/components/create/workflow-canvas', () => ({ useRunNode: () => env.run }));
vi.mock('@/components/workspace/workspace-shell', () => ({ useWorkspace: () => ({ projectId: 'project', dispatch: env.dispatch, state: { director: { llmProvider: 'openai' }, elements: [{ id: 'cody', name: 'Cody', type: 'character' }] } }) }));
vi.mock('@/components/elevenlabs/connection', () => ({ ElevenLabsConnection: () => <div>Connected voice library</div> }));
vi.mock('@/lib/elevenlabs/client', () => ({ elevenLabs: { design: (...a: any[]) => env.design(...a), saveVoice: (...a: any[]) => env.saveVoice(...a) } }));
vi.mock('@/lib/elevenlabs/enhance', () => ({ enhanceAudioText: (...a: any[]) => env.enhance(...a) }));
function Harness({ initial, deferred = false }: { initial: Record<string, unknown>; deferred?: boolean }) {
  const [data, setData] = useState<any>({ type: 'elevenLabsAudio', config: initial });
  const current = useRef(data); current.current = data;
  const queue = useRef<any[]>([]);
  env.node = current;
  const getNode = useCallback(() => ({ data: current.current }), []);
  const apply = useCallback((patch: any) => { current.current = { ...current.current, ...(typeof patch === 'function' ? patch({ data: current.current }) : patch) }; setData(current.current); }, []);
  const updateNodeData = useCallback((_id: string, patch: any) => { if (deferred) queue.current.push(patch); else apply(patch); }, [apply, deferred]);
  env.flush = () => { const patch = queue.current.shift(); if (patch) apply(patch); };
  env.flow = { getNode, updateNodeData };
  return <ElevenLabsAudioNode {...{ id: 'audio', data, selected: false } as any} />;
}
beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);
it('designs once, lets the user audition, then saves the selected voice and makes it usable', async () => {
  let finish: any;
  env.design.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  env.saveVoice.mockResolvedValue({ id: 'new-cody', name: 'Cody' });
  render(<Harness initial={{ voiceMode: 'design', elementId: 'cody', voiceDescription: 'Warm, low, a little gravel and a soft Southern accent.', text: 'Keep these spoken words.' }} />);
  const design = screen.getByRole('button', { name: 'Create voice previews' });
  fireEvent.click(design); fireEvent.click(design);
  expect(env.design).toHaveBeenCalledOnce(); expect(env.run).not.toHaveBeenCalled();
  const [description, sample, language] = env.design.mock.calls[0];
  expect(description).toContain('Southern'); expect(sample.length).toBeGreaterThanOrEqual(100); expect(language).toBe('en');
  await act(async () => finish({ previews: [{ id: 'preview-a', url: 'https://audio.example/a.mp3', viewStateId: 'voice-view' }] }));
  expect(screen.getByLabelText('Voice preview 1')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Use voice' }));
  await waitFor(() => expect(env.node.current.config.voiceId).toBe('new-cody'));
  expect(env.saveVoice).toHaveBeenCalledWith('preview-a', 'Cody', description, 'voice-view');
  expect(env.node.current.config.text).toBe('Keep these spoken words.');
  expect(env.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'UPDATE_ELEMENT', elementId: 'cody' }));
  expect(screen.getByRole('button', { name: 'Generate audio', exact: true })).not.toBeDisabled();
});
it('enhances direction on toggle and Undo restores it without changing dialogue or submitting speech', async () => {
  env.enhance.mockResolvedValue('Measured pace, quiet warmth, a restrained smile.');
  render(<Harness initial={{ voiceId: 'voice-cody', text: 'Do not rewrite this line.', direction: 'warm and slow' }} />);
  fireEvent.click(screen.getByRole('switch', { name: 'AI prompt enhancer' }));
  await waitFor(() => expect(env.node.current.config.direction).toBe('Measured pace, quiet warmth, a restrained smile.'));
  expect(env.enhance).toHaveBeenCalledWith('direction', 'warm and slow', expect.any(AbortSignal), expect.any(String));
  expect(env.node.current.config.enhanceEnabled).toBe(true);
  expect(env.node.current.config.text).toBe('Do not rewrite this line.'); expect(env.run).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Undo enhancement' }));
  expect(env.node.current.config.direction).toBe('warm and slow');
});
it('does not overwrite newer edits with a late enhancer response', async () => {
  let finish: any; env.enhance.mockImplementation(() => new Promise(r => { finish = r; }));
  render(<Harness initial={{ direction: 'warm', text: 'My dialogue' }} />);
  fireEvent.click(screen.getByRole('switch', { name: 'AI prompt enhancer' }));
  act(() => env.flow.updateNodeData('audio', { config: { ...env.node.current.config, direction: 'cold and clipped' } }));
  await act(async () => finish('Enhanced warm direction'));
  expect(env.node.current.config.direction).toBe('cold and clipped');
  expect(screen.getByRole('alert')).toHaveTextContent('Your text changed');
});

it.each([
  { label: 'Describe the voice', field: 'voiceDescription', initial: { voiceMode: 'design' } },
  { label: 'Voice name', field: 'voiceDesignName', initial: { voiceMode: 'design' } },
  { label: 'Voice preview script', field: 'voiceSampleText', initial: { voiceMode: 'design' } },
  { label: 'Library description', field: 'voiceSaveDescription', initial: { voiceMode: 'design', voicePreviewDescription: 'A'.repeat(501), voicePreviews: [{ id: 'a', url: 'https://audio.example/a.mp3' }] } },
  { label: 'Dialogue', field: 'text', initial: {} },
  { label: 'Sound brief', field: 'text', initial: { kind: 'sound' } },
  { label: 'Performance direction', field: 'direction', initial: { directionOpen: true } },
])('keeps middle-of-text edits and the caret in $label while Canvas batches updates', ({ label, field, initial }) => {
  render(<Harness deferred initial={{ ...initial, [field]: 'Warm voice' }} />);
  const input = screen.getByLabelText(label, { selector: 'textarea, input', exact: false }) as HTMLTextAreaElement;
  input.focus();
  fireEvent.change(input, { target: { value: 'Warm low voice', selectionStart: 9, selectionEnd: 9 } });
  // The graph has not acknowledged this input yet. React must not restore its old value.
  expect(env.node.current.config[field]).toBe('Warm voice');
  expect(input.value).toBe('Warm low voice');
  expect(input.selectionStart).toBe(9);
  // A second edit can arrive before the graph acknowledges the first.
  fireEvent.change(input, { target: { value: 'Warm low, calm voice', selectionStart: 15, selectionEnd: 15 } });
  act(() => env.flush());
  expect(input.value).toBe('Warm low, calm voice');
  expect(input.selectionStart).toBe(15);
  act(() => env.flush());
  expect(env.node.current.config[field]).toBe('Warm low, calm voice');
  expect(input.selectionStart).toBe(15);
  expect(document.activeElement).toBe(input);
});

it('accepts a restored description after local typing has been saved', () => {
  render(<Harness deferred initial={{ voiceMode: 'design', voiceDescription: 'Warm voice' }} />);
  const input = screen.getByLabelText('Describe the voice');
  fireEvent.change(input, { target: { value: 'Warm low voice' } });
  act(() => env.flush());
  act(() => {
    env.flow.updateNodeData('audio', { config: { ...env.node.current.config, voiceDescription: 'Restored character voice' } });
    env.flush();
  });
  expect(input).toHaveValue('Restored character voice');
});
