import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { getVideoPreviewTime, VideoNodePreview } from '@/components/create/nodes/video-node-preview';

describe('VideoNodePreview', () => {
  it('uses the connected frame as an immediate poster and preloads video data', () => {
    const { getByLabelText } = render(
      <VideoNodePreview
        sourceUrl="https://media.example/result.mp4"
        fallbackPosterUrl="https://media.example/start-frame.jpg"
        className="test-video"
        ariaLabel="Play generated video"
      />,
    );

    const video = getByLabelText('Play generated video');
    expect(video).toHaveAttribute('poster', 'https://media.example/start-frame.jpg');
    expect(video).toHaveAttribute('preload', 'auto');
    expect(video).toHaveAttribute('playsinline');
  });

  it('requests an early frame as soon as metadata is available', () => {
    const { getByLabelText } = render(
      <VideoNodePreview
        sourceUrl="https://media.example/result.mp4"
        className="test-video"
        ariaLabel="Play primed generated video"
      />,
    );

    const video = getByLabelText('Play primed generated video') as HTMLVideoElement;
    Object.defineProperty(video, 'duration', { configurable: true, value: 4 });
    fireEvent.loadedMetadata(video);

    expect(video.currentTime).toBeCloseTo(0.1);
  });

  it('keeps the preview seek inside very short videos', () => {
    expect(getVideoPreviewTime(0.05)).toBeGreaterThan(0);
    expect(getVideoPreviewTime(0.05)).toBeLessThan(0.05);
    expect(getVideoPreviewTime(Number.NaN)).toBe(0);
  });

  it('plays without opening the node inspector', () => {
    const onNodeClick = vi.fn();
    const { getByLabelText } = render(
      <div onClick={onNodeClick}>
        <VideoNodePreview
          sourceUrl="https://media.example/result.mp4"
          className="test-video"
          ariaLabel="Play isolated generated video"
        />
      </div>,
    );

    fireEvent.click(getByLabelText('Play isolated generated video'));
    expect(onNodeClick).not.toHaveBeenCalled();
  });
});
