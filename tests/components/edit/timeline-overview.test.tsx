import { render, screen, fireEvent } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { TimelineOverview } from '@/components/edit/timeline-overview';
import type { Timeline } from '@/types/timeline';
it('preserves clip gaps and speed-adjusted lengths and opens the full timeline', () => {
  const onOpen = vi.fn();
  const timeline = { tracks: [{ id: 'v', kind: 'video' }], clips: [{ id: 'c', trackId: 'v', assetId: 'a', name: 'Shot', startTime: 5, duration: 12, trimStart: 2, trimEnd: 2, speed: 2 }] } as Timeline;
  const { container } = render(<TimelineOverview timeline={timeline} assets={[]} duration={20} currentTime={10} onOpen={onOpen} />);
  expect(container.querySelector('.timeline-overview__clip')).toHaveStyle({ left: '25%', width: '20%' });
  expect(container.querySelector('.timeline-overview__playhead')).toHaveStyle({ left: '50%' });
  fireEvent.click(screen.getByRole('button', { name: 'Open full timeline' }));
  expect(onOpen).toHaveBeenCalledOnce();
});
