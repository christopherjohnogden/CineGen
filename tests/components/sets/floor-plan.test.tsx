import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FloorPlan } from '@/components/sets/floor-plan';
import type { ProjectSet } from '@/types/sets';

function makeSet(overrides: Partial<ProjectSet> = {}): ProjectSet {
  return {
    id: 's1',
    name: 'Diner',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    upAxis: 'y',
    scaleToMeters: 1,
    marks: [],
    cameras: [],
    ...overrides,
  };
}

describe('FloorPlan', () => {
  it('renders an empty Set without a degenerate viewBox', () => {
    render(<FloorPlan set={makeSet()} />);
    const svg = screen.getByRole('img', { name: /Overhead plan of Diner/ });
    expect(svg).toBeInTheDocument();
    expect(svg.getAttribute('viewBox')).toBe('0 0 100 100');
  });

  it('draws one labelled dot per mark', () => {
    render(<FloorPlan set={makeSet({
      marks: [
        { id: 'm1', name: 'doorway', x: 0, z: 0, facing: 0 },
        { id: 'm2', name: 'booth 3', x: 3, z: -2, facing: 1 },
      ],
    })} />);
    expect(screen.getByText('doorway')).toBeInTheDocument();
    expect(screen.getByText('booth 3')).toBeInTheDocument();
  });

  it('draws a frustum wedge per saved camera', () => {
    const { container } = render(<FloorPlan set={makeSet({
      cameras: [{
        id: 'c1', name: 'Wide', createdAt: '2026-09-01T00:00:00.000Z',
        position: [0, 1.6, 5], target: [0, 1.2, 0],
        focalMm: 35, sensorWidthMm: 36, sensorHeightMm: 24,
        aspect: '16:9', fovDiagonal: 63.4,
      }],
    })} />);
    expect(container.querySelectorAll('.floor-plan__camera polygon')).toHaveLength(1);
  });

  it('shows stand-ins alongside the saved marks', () => {
    const { container } = render(
      <FloorPlan
        set={makeSet({ marks: [{ id: 'm1', name: 'doorway', x: 0, z: 0, facing: 0 }] })}
        standIns={[{ id: 'a', heightM: 1.8, pose: 'standing', x: 1, z: 1, facing: 0 }]}
      />,
    );
    expect(container.querySelectorAll('.floor-plan__standin')).toHaveLength(1);
  });
});
