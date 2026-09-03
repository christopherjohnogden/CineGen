import { describe, expect, it } from 'vitest';
import { workflowMediaInputs } from '@/lib/cloud/funding';

/**
 * Topview sorts omni-reference inputs into stills, clips and audio by the role
 * we send. A reference list is mixed media, so the role has to come from the
 * file — sending a clip as a still is silently wrong.
 */
describe('workflowMediaInputs', () => {
  it('reads the role off each reference rather than off the field', () => {
    expect(workflowMediaInputs({
      reference_images: [
        'https://media.example/hero.png',
        'https://media.example/run-cycle.mp4',
        'https://media.example/room-tone.wav',
      ],
    }, 'video')).toEqual([
      { value: 'https://media.example/hero.png', role: 'image' },
      { value: 'https://media.example/run-cycle.mp4', role: 'video' },
      { value: 'https://media.example/room-tone.wav', role: 'audio' },
    ]);
  });

  it('classifies a local file and ignores a query string on a signed URL', () => {
    expect(workflowMediaInputs({
      image_urls: [
        'local-media://file/Users/chris/Movies/take-1.MOV',
        'https://cdn.example/clip.mp4?sig=abc123&x=1',
      ],
    }, 'video')).toEqual([
      { value: 'local-media://file/Users/chris/Movies/take-1.MOV', role: 'video' },
      { value: 'https://cdn.example/clip.mp4?sig=abc123&x=1', role: 'video' },
    ]);
  });

  it('leaves frames as frames: a start frame is a frame whatever it is called', () => {
    expect(workflowMediaInputs({
      image_url: 'https://media.example/first.png',
      end_frame: 'https://media.example/last.png',
    }, 'video')).toEqual([
      { value: 'https://media.example/first.png', role: 'start_image' },
      { value: 'https://media.example/last.png', role: 'end_image' },
    ]);
  });

  it('treats an unknown extension as a still, which is the safe default', () => {
    expect(workflowMediaInputs({ reference_images: ['https://media.example/asset'] }, 'video'))
      .toEqual([{ value: 'https://media.example/asset', role: 'image' }]);
  });

  it('drops duplicates once they are classified', () => {
    const media = workflowMediaInputs({
      reference_images: ['https://media.example/a.mp4'],
      image_urls: ['https://media.example/a.mp4'],
    }, 'video');
    expect(media).toEqual([{ value: 'https://media.example/a.mp4', role: 'video' }]);
  });
});

describe('references that arrive already labelled', () => {
  it('corrects a clip that an upstream field labelled as a still', () => {
    // Higgsfield's media inputs carry {value, role} pairs and call everything an
    // image; Topview would then submit the clip as a still.
    expect(workflowMediaInputs({
      higgsfield_media_inputs: [
        { value: 'local-media://file/Users/chris/Movies/run-cycle.mp4', role: 'image' },
        { value: 'local-media://file/Users/chris/Pictures/jersey.png', role: 'image' },
      ],
    }, 'video')).toEqual([
      { value: 'local-media://file/Users/chris/Movies/run-cycle.mp4', role: 'video' },
      { value: 'local-media://file/Users/chris/Pictures/jersey.png', role: 'image' },
    ]);
  });

  it('never reinterprets an explicit frame', () => {
    expect(workflowMediaInputs({
      medias: [{ value: 'https://media.example/first.png', role: 'start_image' }],
    }, 'video')).toEqual([{ value: 'https://media.example/first.png', role: 'start_image' }]);
  });
});
