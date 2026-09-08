import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioPromptAssistant } from '@/components/create/studio-prompt-assistant';
import { rewriteStudioPrompt } from '@/lib/studio/rewrite-client';

vi.mock('@/lib/studio/rewrite-client', () => ({ rewriteStudioPrompt: vi.fn() }));
const rewrite = vi.mocked(rewriteStudioPrompt);
const original = 'SHOT 1 [0–5s] @Cody walks onto the golf course. SHOT 2 [5–10s] Close-up of the putter.';
const submit = vi.fn();
function Harness({ kind = 'video' }: { kind?: 'image' | 'video' }) {
  const [prompt, setPrompt] = useState(original);
  return <form onSubmit={event => { event.preventDefault(); submit(); }}>
    <textarea aria-label="Generation prompt" value={prompt} onChange={event => setPrompt(event.target.value)} />
    <StudioPromptAssistant prompt={prompt} kind={kind} onApply={(before, after) => setPrompt(current => current === before ? after : current)} />
  </form>;
}
function open() { fireEvent.click(screen.getByRole('button', { name: 'Edit prompt with AI' })); }
function send(message = 'Use softer morning light. Keep both shots.') {
  fireEvent.change(screen.getByLabelText('What would you like to change?'), { target: { value: message } });
  fireEvent.click(screen.getByRole('button', { name: 'Update prompt' }));
}
beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(cleanup);

describe('Studio AI prompt editing', () => {
  it('updates the full prompt, supports follow-up feedback and undo, and never submits generation', async () => {
    rewrite.mockResolvedValueOnce(original + ' Soft morning light.').mockResolvedValueOnce(original + ' Soft morning light. Slow camera.');
    render(<Harness />); open(); send();
    await waitFor(() => expect(screen.getByLabelText('Generation prompt')).toHaveValue(original + ' Soft morning light.'));
    expect(rewrite.mock.calls[0][0]).toMatchObject({ text: original, feedback: 'Use softer morning light. Keep both shots.', kind: 'video' });
    send('Slow down the camera.');
    await waitFor(() => expect(screen.getByLabelText('Generation prompt')).toHaveValue(original + ' Soft morning light. Slow camera.'));
    expect(rewrite.mock.calls[1][0].text).toBe(original + ' Soft morning light.');
    expect(rewrite.mock.calls[1][0].requestId).not.toBe(rewrite.mock.calls[0][0].requestId);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByLabelText('Generation prompt')).toHaveValue(original + ' Soft morning light.');
    expect(submit).not.toHaveBeenCalled();
  });
  it('reuses the same request after a connection failure, with no changes on failure', async () => {
    rewrite.mockRejectedValueOnce(new Error('Connection interrupted')).mockResolvedValueOnce('Recovered prompt');
    render(<Harness kind="image" />); open(); send();
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Generation prompt')).toHaveValue(original);
    fireEvent.click(screen.getByRole('button', { name: 'Update prompt' }));
    await waitFor(() => expect(screen.getByLabelText('Generation prompt')).toHaveValue('Recovered prompt'));
    expect(rewrite.mock.calls[0][0]).toEqual(rewrite.mock.calls[1][0]);
    expect(rewrite.mock.calls[0][0].kind).toBe('image');
  });
  it('keeps newer manual edits when a rewrite returns late', async () => {
    let finish!: (text: string) => void;
    rewrite.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<Harness />); open(); send();
    fireEvent.change(screen.getByLabelText('Generation prompt'), { target: { value: 'Newer edits' } });
    await act(async () => finish('Stale rewrite'));
    expect(screen.getByLabelText('Generation prompt')).toHaveValue('Newer edits');
    expect(screen.getByRole('alert')).toHaveTextContent('Your edits were kept');
  });
  it('cancels local application on close and ignores results after unmount', async () => {
    let finish!: (text: string) => void;
    rewrite.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { unmount } = render(<Harness />); open(); send();
    const signal = rewrite.mock.calls[0][1];
    fireEvent.click(screen.getByRole('button', { name: 'Close AI prompt editor' }));
    expect(signal.aborted).toBe(true);
    await act(async () => finish('Do not apply'));
    expect(screen.getByLabelText('Generation prompt')).toHaveValue(original);
    expect(screen.getByRole('button', { name: 'Edit prompt with AI' })).toHaveFocus();
    open(); send(); unmount();
    expect(rewrite.mock.calls[1][1].aborted).toBe(true);
    await act(async () => finish('Also do not apply'));
  });
  it('supports long prompts, blocks double clicks, and isolates the rewrite keyboard shortcut', async () => {
    let finish!: (text: string) => void;
    rewrite.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<Harness />);
    const long = original.repeat(70);
    fireEvent.change(screen.getByLabelText('Generation prompt'), { target: { value: long } });
    open();
    const field = screen.getByLabelText('What would you like to change?');
    fireEvent.change(field, { target: { value: 'Keep every shot; use warmer light.' } });
    fireEvent.keyDown(field, { key: 'Enter', metaKey: true });
    fireEvent.keyDown(field, { key: 'Enter', metaKey: true });
    expect(rewrite).toHaveBeenCalledTimes(1);
    expect(rewrite.mock.calls[0][0].text).toBe(long);
    expect(submit).not.toHaveBeenCalled();
    await act(async () => finish(long + ' Warm light.'));
    fireEvent.click(screen.getByRole('button', { name: 'Close AI prompt editor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo AI prompt change' }));
    expect(screen.getByLabelText('Generation prompt')).toHaveValue(long);
  });
});
