// @vitest-environment node
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ handle: vi.fn(), spawn: vi.fn(), stage: vi.fn(), cleanup: vi.fn(), binary: vi.fn() }));
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/cinegen-test' }, ipcMain: { handle: mocks.handle } }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('node:fs/promises', () => ({ mkdir: vi.fn() }));
vi.mock('../../../electron/ipc/assistant-image-attachments.js', () => ({ stageAssistantImages: mocks.stage }));
vi.mock('../../../electron/ipc/copilot-visual-media.js', () => ({
  prepareCopilotVisualRefs: async () => [], cleanupEphemeralVisualRefs: vi.fn(),
  buildGeminiUserMessageWithVisualRefs: (text: string, refs: Array<{ mediaPath: string }>) => `${text}\n${refs.map(ref => `@${ref.mediaPath}`).join('\n')}`,
}));
vi.mock('../../../electron/ipc/cli-llm-shared.js', () => ({
  resolveCliBinary: mocks.binary, buildGeminiCliEnv: () => ({}), getMainWindow: () => null,
  buildConversationPrompt: (rows: Array<{ content: string }>) => rows.map(row => row.content).join('\n'),
  stripAnsiCodes: (text: string) => text,
  CHAT_ONLY_SUFFIX: 'Chat only.', COPILOT_RESUME_REMINDER: 'Continue.', ENHANCE_PROMPT_SUFFIX: 'Rewrite only.',
}));
import { registerGeminiCliHandlers } from '../../../electron/ipc/gemini-cli';

describe('Gemini canvas vision', () => {
  const images = [{ label: 'Canvas image', dataUrl: 'preview' }];
  const messages = [{ role: 'user', content: 'What is here?' }];
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.binary.mockResolvedValue('/test/gemini');
    mocks.stage.mockResolvedValue({ refs: [{ mediaPath: '/tmp/cinegen-preview/1.jpeg', ephemeral: false }], cleanup: mocks.cleanup });
    registerGeminiCliHandlers();
    mocks.spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() });
      setTimeout(() => {
        child.stdout.emit('data', Buffer.from('{"type":"message","role":"assistant","content":"A blue square."}\n'));
        child.emit('close', 0);
      }, 0);
      return child;
    });
  });
  function run() {
    const handler = mocks.handle.mock.calls.find(([channel]) => channel === 'llm:gemini-chat')![1];
    return handler({}, { userMessage: 'What is here?', messages, images, resumeSessionId: 'old-session' });
  }
  it('preserves image paths with chat history and cleans up after the response', async () => {
    await expect(run()).resolves.toMatchObject({ message: 'A blue square.', resumed: false });
    const args = mocks.spawn.mock.calls[0][1] as string[];
    expect(args[args.indexOf('-p') + 1]).toContain('@/tmp/cinegen-preview/1.jpeg');
    expect(args[args.indexOf('--approval-mode') + 1]).toBe('default');
    expect(args).toContain('--include-directories');
    expect(args).not.toContain('-r');
    expect(messages[0].content).toBe('What is here?');
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
  });
  it('removes staged images even when the CLI cannot start', async () => {
    mocks.binary.mockResolvedValue(null);
    await expect(run()).rejects.toThrow('not installed');
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.cleanup).toHaveBeenCalledTimes(1);
  });
});
