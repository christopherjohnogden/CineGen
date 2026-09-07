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
it('opens the enhancer without submitting, then refines direction and supports Undo without changing dialogue', async () => {
  env.enhance.mockResolvedValue('Measured pace, quiet warmth, a restrained smile.');
  render(<Harness initial={{ voiceId: 'voice-cody', text: 'Do not rewrite this line.', direction: 'warm and slow' }} />);
  fireEvent.click(screen.getByRole('switch', { name: 'AI prompt enhancer' }));
  expect(env.enhance).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Enhance wording' }));
  await waitFor(() => expect(env.node.current.config.direction).toBe('Measured pace, quiet warmth, a restrained smile.'));
  expect(env.enhance).toHaveBeenCalledWith('direction', 'warm and slow', expect.any(AbortSignal), expect.any(String), '');
  expect(env.node.current.config.enhanceEnabled).toBe(true);
  expect(env.node.current.config.text).toBe('Do not rewrite this line.'); expect(env.run).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Undo enhancement' }));
  expect(env.node.current.config.direction).toBe('warm and slow');
});
it('does not overwrite newer edits with a late enhancer response', async () => {
  let finish: any; env.enhance.mockImplementation(() => new Promise(r => { finish = r; }));
  render(<Harness initial={{ direction: 'warm', text: 'My dialogue' }} />);
  fireEvent.click(screen.getByRole('switch', { name: 'AI prompt enhancer' }));
  fireEvent.click(screen.getByRole('button', { name: 'Enhance wording' }));
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

it('iterates on the current voice prompt using feedback, preserves previews, and undoes the latest revision', async () => {
  const original = 'A deep, gravelly voice, calm and reassuring.';
  const first = 'A youthful, smooth voice with a warm, conversational delivery.';
  const second = 'A youthful, smooth voice with warm, conversational delivery and a slower pace.';
  const previews = [{ id: 'existing-preview', url: 'https://audio.example/preview.mp3' }];
  env.enhance.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  render(<Harness initial={{ voiceMode: 'design', enhanceEnabled: true, voiceDescription: original, voicePreviews: previews }} />);
  const feedback = screen.getByRole('textbox', { name: 'What should change? Optional' });
  fireEvent.change(feedback, { target: { value: 'Too gravelly. Younger, warmer and more natural.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Rewrite prompt' }));
  await waitFor(() => expect(screen.getByLabelText('Describe the voice')).toHaveValue(first));
  expect(env.enhance).toHaveBeenLastCalledWith('voice', original, expect.any(AbortSignal), expect.any(String), 'Too gravelly. Younger, warmer and more natural.');
  expect(feedback).toHaveValue('');
  expect(env.node.current.config.voicePreviews).toEqual(previews);
  fireEvent.change(feedback, { target: { value: 'Keep that, but slow the pace.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Rewrite prompt' }));
  await waitFor(() => expect(screen.getByLabelText('Describe the voice')).toHaveValue(second));
  expect(env.enhance).toHaveBeenLastCalledWith('voice', first, expect.any(AbortSignal), expect.any(String), 'Keep that, but slow the pace.');
  fireEvent.click(screen.getByRole('button', { name: 'Undo enhancement' }));
  expect(screen.getByLabelText('Describe the voice')).toHaveValue(first);
  expect(env.design).not.toHaveBeenCalled(); expect(env.run).not.toHaveBeenCalled();
});

it('creates performance direction from feedback while keeping dialogue and feedback for other modes intact', async () => {
  env.enhance.mockResolvedValue('Speak quietly and conversationally, with natural pauses.');
  render(<Harness initial={{ enhanceEnabled: true, voiceId: 'cody', text: 'Keep this exact spoken line.', enhanceFeedback: { voice: 'A younger voice.', direction: 'Less announcer, more conversational.' } }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Rewrite prompt' }));
  await waitFor(() => expect(screen.getByLabelText('Performance direction')).toHaveValue('Speak quietly and conversationally, with natural pauses.'));
  expect(env.enhance).toHaveBeenCalledWith('direction', '', expect.any(AbortSignal), expect.any(String), 'Less announcer, more conversational.');
  expect(env.node.current.config.text).toBe('Keep this exact spoken line.');
  expect(env.node.current.config.enhanceFeedback).toEqual({ voice: 'A younger voice.', direction: '' });
  expect(env.node.current.config.directionOpen).toBe(true);
});

it('keeps feedback edits and the caret while Canvas batches updates', () => {
  render(<Harness deferred initial={{ enhanceEnabled: true, enhanceFeedback: { direction: 'Less gravel' } }} />);
  const input = screen.getByRole('textbox', { name: 'What should change? Optional' }) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: 'Less heavy gravel', selectionStart: 11, selectionEnd: 11 } });
  expect(input.value).toBe('Less heavy gravel');
  expect(input.selectionStart).toBe(11);
  act(() => env.flush());
  expect(input.selectionStart).toBe(11);
});

it('rejects a late rewrite after feedback changes elsewhere', async () => {
  let finish: any; env.enhance.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<Harness initial={{ enhanceEnabled: true, direction: 'Warm', enhanceFeedback: { direction: 'Slower' } }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Rewrite prompt' }));
  act(() => env.flow.updateNodeData('audio', { config: { ...env.node.current.config, enhanceFeedback: { direction: 'Faster' } } }));
  await act(async () => finish('Warm and slow.'));
  expect(env.node.current.config.direction).toBe('Warm');
  expect(screen.getByRole('alert')).toHaveTextContent('Your text changed');
});

it('recovers the same rewrite after a lost response but uses a new request when feedback changes', async () => {
  env.enhance.mockRejectedValueOnce(new Error('Connection lost')).mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValueOnce('Warm and bright.');
  render(<Harness initial={{ enhanceEnabled: true, direction: 'Warm', enhanceFeedback: { direction: 'Slower' } }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Rewrite prompt' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Rewrite prompt' }));
  await screen.findByRole('alert');
  expect(env.enhance.mock.calls[1][3]).toBe(env.enhance.mock.calls[0][3]);
  fireEvent.change(screen.getByRole('textbox', { name: 'What should change? Optional' }), { target: { value: 'Brighter' } });
  fireEvent.click(screen.getByRole('button', { name: 'Rewrite prompt' }));
  await waitFor(() => expect(env.node.current.config.direction).toBe('Warm and bright.'));
  expect(env.enhance.mock.calls[2][3]).not.toBe(env.enhance.mock.calls[0][3]);
  expect(env.enhance.mock.calls[2][4]).toBe('Brighter');
});
