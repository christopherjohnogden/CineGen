import { describe, expect, it } from 'vitest';
import {
  artlistLoginCommand,
  buildArtlistGenerationPrompt,
  parseArtlistGenerationOutput,
} from '../../../electron/ipc/artlist';

describe('Artlist MCP generation', () => {
  it('opens macOS login in Terminal so browser OAuth can complete', () => {
    const command = artlistLoginCommand('/opt/homebrew/bin/claude', 'darwin', '/tmp/artlist.command');
    expect(command.file).toBe('/usr/bin/open');
    expect(command.args).toEqual(['/tmp/artlist.command']);
    expect(command.detached).toBe(true);
    expect(command.script?.contents).toContain("'/opt/homebrew/bin/claude' mcp login artlist");
  });

  it('passes no more than three unique element references into the approved generation brief', () => {
    const prompt = buildArtlistGenerationPrompt({
      prompt: 'A courier crosses a neon street.',
      durationSec: 8,
      aspectRatio: '9:16',
      resolution: '1080p',
      generateAudio: true,
      medias: [
        { value: 'https://cdn.example/character.png' },
        { value: 'https://cdn.example/location.png' },
        { value: 'https://cdn.example/prop.png' },
        { value: 'https://cdn.example/character.png' },
        { value: 'https://cdn.example/fourth.png' },
      ],
    });

    expect(prompt).toContain('duration: 8 seconds');
    expect(prompt).toContain('aspect ratio: 9:16');
    expect(prompt).toContain('generated audio: on');
    expect(prompt.match(/character\.png/g)).toHaveLength(1);
    expect(prompt).toContain('location.png');
    expect(prompt).toContain('prop.png');
    expect(prompt).not.toContain('fourth.png');
    expect(prompt).toContain('identity and design are locked');
  });

  it('extracts the generated video from Claude JSON output', () => {
    const result = parseArtlistGenerationOutput(JSON.stringify({
      type: 'result',
      result: JSON.stringify({
        url: 'https://cdn.artlist.io/generations/take.mp4',
        generationId: 'gen_123',
        accountUrl: 'https://artlist.io/ai/session/123',
        model: 'seedance',
        durationSec: 8,
      }),
    }));

    expect(result).toEqual({
      url: 'https://cdn.artlist.io/generations/take.mp4',
      mediaType: 'video',
      durationSec: 8,
      generationId: 'gen_123',
      accountUrl: 'https://artlist.io/ai/session/123',
      model: 'seedance',
    });
  });

  it('falls back to a direct video URL in plain output', () => {
    expect(parseArtlistGenerationOutput('Done: https://cdn.artlist.io/take.webm?token=abc').url)
      .toBe('https://cdn.artlist.io/take.webm?token=abc');
  });
});
