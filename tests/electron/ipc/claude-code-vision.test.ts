// @vitest-environment node
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ handle: vi.fn(), spawn: vi.fn(), input: vi.fn() }));
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/cinegen-test' }, ipcMain: { handle: mocks.handle }, BrowserWindow: { getAllWindows: () => [] } }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn, execFile: vi.fn() }));
vi.mock('node:util', () => ({ promisify: () => async () => ({ stdout: 'Claude Code test' }) }));
import { registerClaudeCodeHandlers } from '../../../electron/ipc/claude-code';

describe('Claude canvas vision', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerClaudeCodeHandlers();
    mocks.spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), stdin: { end: mocks.input }, kill: vi.fn() });
      setTimeout(() => child.stdout.emit('data', Buffer.from('{"type":"result","result":"I see the image."}\n')), 0);
      return child;
    });
  });
  it('streams image blocks through stdin with chat tools disabled', async () => {
    const handler = mocks.handle.mock.calls.find(([channel]) => channel === 'llm:claude-code-chat')![1];
    await expect(handler({}, { userMessage: 'Describe it', purpose: 'copilot', injectProjectContext: true,
      messages: [{ role: 'user', content: 'Describe it' }], images: [{ label: 'Canvas image', dataUrl: 'data:image/jpeg;base64,/9j/AA==' }] })).resolves.toMatchObject({ message: 'I see the image.' });
    const args = mocks.spawn.mock.calls[0][1];
    expect(args).toEqual(expect.arrayContaining(['--input-format', 'stream-json', '--tools', '']));
    const content = JSON.parse(mocks.input.mock.calls[0][0]).message.content;
    expect(content[0].text).toContain('Describe it');
    expect(content[2]).toMatchObject({ type: 'image', source: { media_type: 'image/jpeg', data: '/9j/AA==' } });
    expect(args.join(' ')).not.toContain('/9j/');
  });
});
