import { render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowNodeData } from '@/types/workflow';

vi.mock('@/components/workspace/workspace-shell', () => ({
  useWorkspace: () => ({
    state: { assets: [] },
    dispatch: vi.fn(),
  }),
  getActiveTimeline: vi.fn(),
}));

vi.mock('@/components/create/workflow-canvas', () => ({
  useRunNode: () => vi.fn(),
}));

import { ModelNode } from '@/components/create/nodes/model-node';

describe('ModelNode visual sizing', () => {
  it('uses a visible default size while React Flow reports zero initial dimensions', () => {
    const data: WorkflowNodeData = {
      type: 'runpod-ltx25-session',
      label: 'LTX-2.5 Session',
      config: {},
    };

    const { container } = render(
      <ReactFlowProvider>
        <ModelNode
          {...({
            id: 'ltx-session-node',
            data,
            type: 'runpod-ltx25-session',
            selected: false,
            dragging: false,
            zIndex: 0,
            isConnectable: true,
            positionAbsoluteX: 0,
            positionAbsoluteY: 0,
            width: 0,
            height: 0,
          } as never)}
        />
      </ReactFlowProvider>,
    );

    expect(screen.getByText('LTX-2.5 Session')).toBeInTheDocument();
    expect(container.querySelector('.model-node--media')).toHaveStyle({
      width: '300px',
      height: '168.75px',
    });
  });

  it('preserves dimensions after the user resizes the node', () => {
    const data: WorkflowNodeData = {
      type: 'runpod-ltx25-session',
      label: 'LTX-2.5 Session',
      config: {},
    };

    const { container } = render(
      <ReactFlowProvider>
        <ModelNode
          {...({
            id: 'resized-ltx-session-node',
            data,
            type: 'runpod-ltx25-session',
            selected: false,
            dragging: false,
            zIndex: 0,
            isConnectable: true,
            positionAbsoluteX: 0,
            positionAbsoluteY: 0,
            width: 480,
            height: 270,
          } as never)}
        />
      </ReactFlowProvider>,
    );

    expect(container.querySelector('.model-node--media')).toHaveStyle({
      width: '480px',
      height: '270px',
    });
  });

  it('shows elapsed time instead of a synthetic percentage for an active LTX session render', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T17:00:00Z'));
    try {
      const data: WorkflowNodeData = {
        type: 'runpod-ltx25-session',
        label: 'LTX-2.5 Session',
        config: {},
        result: {
          status: 'running',
          progress: 55,
          progressStage: 'rendering',
          progressMessage: 'LTX-2.5 is rendering the video…',
          progressStartedAt: Date.now() - 65_000,
        },
      };

      render(
        <ReactFlowProvider>
          <ModelNode
            {...({
              id: 'running-ltx-session-node',
              data,
              type: 'runpod-ltx25-session',
              selected: false,
              dragging: false,
              zIndex: 0,
              isConnectable: true,
              positionAbsoluteX: 0,
              positionAbsoluteY: 0,
              width: 480,
              height: 270,
            } as never)}
          />
        </ReactFlowProvider>,
      );

      expect(screen.getByText('1:05')).toBeInTheDocument();
      expect(screen.queryByText('55%')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
