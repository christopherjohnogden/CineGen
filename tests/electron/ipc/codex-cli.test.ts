// @vitest-environment node
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ handle: vi.fn(), spawn: vi.fn(), send: vi.fn(), stage: vi.fn(), cleanup: vi.fn() }));
vi.mock('../../../electron/ipc/assistant-image-attachments.js', () => ({ stageAssistantImages: mocks.stage }));
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/cinegen-test' },
  ipcMain: { handle: mocks.handle },
}));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('node:fs/promises', () => ({ mkdir: vi.fn() }));
vi.mock('../../../electron/ipc/cli-llm-shared.js', () => ({
  resolveCliBinary: vi.fn(async () => '/test/codex'),
  buildCliPathEnv: () => ({}),
  getMainWindow: () => ({ webContents: { send: mocks.send } }),
  buildConversationPrompt: (rows: Array<{ content: string }>) => rows.map((row) => row.content).join('\n'),
  CHAT_ONLY_SUFFIX: 'Chat only.', ENHANCE_PROMPT_SUFFIX: 'Rewrite only.',
}));
import { registerCodexCliHandlers } from '../../../electron/ipc/codex-cli';

describe('Codex assistant transport', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.stage.mockResolvedValue({ refs: [], cleanup: mocks.cleanup }); registerCodexCliHandlers(); });
  async function run(model?: string, failure = false, images: unknown[] = []) {
    mocks.spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(), stderr: new EventEmitter(),
        stdin: { write: vi.fn(), end: vi.fn() },
      });
      setTimeout(() => {
        // Codex can report a reconnect before successfully completing a turn.
        child.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'error', message: 'Reconnecting 1/5' }) + '\n'));
        child.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: failure ? 'Partial' : 'Four image nodes.' } }) + '\n'));
        if (failure) {
          child.stderr.emit('data', Buffer.from('Unrelated diagnostic\n'));
          child.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'turn.failed', error: { message: JSON.stringify({ error: { message: 'Account request rejected.' } }) } }) + '\n'));
        }
        child.emit('close', failure ? 1 : 0);
      }, 0);
      return child;
    });
    const handler = mocks.handle.mock.calls.find(([channel]) => channel === 'llm:codex-chat')![1];
    return handler({}, { requestId: 'req', purpose: 'copilot', injectProjectContext: true, userMessage: 'Count nodes', systemPrompt: 'Live canvas: four images', model, images });
  }
  it.each([undefined, 'auto', 'gpt-5.3-codex'])('uses the account default for %s, with isolated context', async (model) => {
    await expect(run(model)).resolves.toMatchObject({ message: 'Four image nodes.' });
    const args = mocks.spawn.mock.calls[0][1];
    expect(args).not.toContain('-m');
    expect(args).toEqual(expect.arrayContaining(['--ignore-user-config', '--ignore-rules', '-C', '/tmp/cinegen-test/codex-workspace', 'read-only']));
    expect(args.at(-1)).toContain('Live canvas: four images');
  });
  it('separates image flags from the prompt and cleans up after success or failure', async () => {
    const images = [{ label: 'Canvas image', dataUrl: 'preview' }];
    mocks.stage.mockResolvedValue({ refs: [{ mediaPath: '/tmp/preview.png' }], cleanup: mocks.cleanup });
    await run('auto', false, images);
    const args = mocks.spawn.mock.calls[0][1];
    expect(args.slice(-4, -1)).toEqual(['--image', '/tmp/preview.png', '--']);
    expect(args.at(-1)).toContain('Count nodes');
    expect(mocks.stage).toHaveBeenCalledWith(images);
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
    await expect(run('auto', true, images)).rejects.toThrow();
    expect(mocks.cleanup).toHaveBeenCalledTimes(2);
  });
  it('honors an explicit Luna selection', async () => {
    await run('gpt-5.6-luna');
    const args = mocks.spawn.mock.calls[0][1];
    expect(args[args.indexOf('-m') + 1]).toBe('gpt-5.6-luna');
  });
  it('reports the structured failure instead of treating partial text as success', async () => {
    await expect(run('auto', true)).rejects.toThrow('Account request rejected.');
  });
});
