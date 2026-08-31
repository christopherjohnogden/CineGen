import type { ReactNode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const flowHarness = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}));

const workspaceHarness = vi.hoisted(() => ({
  dispatch: vi.fn(),
  state: null as Record<string, unknown> | null,
}));

vi.mock('@xyflow/react', () => ({
  ReactFlow: (props: Record<string, unknown> & { children?: ReactNode }) => {
    flowHarness.props = props;
    return <div data-testid="react-flow">{props.children}</div>;
  },
  ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
  Background: () => null,
  Controls: () => null,
  BackgroundVariant: { Dots: 'dots' },
  SelectionMode: { Partial: 'partial' },
  applyNodeChanges: (_changes: unknown, nodes: unknown) => nodes,
  applyEdgeChanges: (_changes: unknown, edges: unknown) => edges,
  useReactFlow: () => ({
    screenToFlowPosition: (position: unknown) => position,
    flowToScreenPosition: (position: unknown) => position,
    fitView: vi.fn(),
  }),
}));

vi.mock('@/components/workspace/workspace-shell', () => ({
  useWorkspace: () => ({
    state: workspaceHarness.state,
    dispatch: workspaceHarness.dispatch,
    projectId: 'test-project',
  }),
}));

vi.mock('@/components/create/nodes', () => ({ nodeTypes: {} }));
vi.mock('@/components/create/edges/animated-edge', () => ({ edgeTypes: {} }));
vi.mock('@/components/create/node-palette', () => ({ NodePalette: () => null }));
vi.mock('@/components/create/helper-lines', () => ({
  HelperLines: () => null,
  getHelperLines: () => ({ horizontal: null, vertical: null }),
}));
vi.mock('@/components/create/node-inspector', () => ({
  NodeInspector: ({ nodeId }: { nodeId: string }) => (
    <div data-testid="node-inspector">{nodeId}</div>
  ),
}));
vi.mock('@/lib/workflows/node-registry', () => ({ NODE_REGISTRY: {} }));
vi.mock('@/lib/fal/models', () => ({
  getModelDefinition: (nodeType: string) => (
    nodeType === 'seedance-2' ? { id: 'seedance-test' } : undefined
  ),
}));
vi.mock('@/lib/workflows/execute', () => ({ executeFromNode: vi.fn() }));
vi.mock('@/lib/topview/video-task-recovery', () => ({
  resumePersistedTopviewVideoTasks: () => [],
}));
vi.mock('@/lib/llm/prompt-elements', () => ({
  reconcilePromptMentionConnections: (value: unknown) => value,
}));
vi.mock('@/lib/workflows/port-compatibility', () => ({
  areWorkflowPortsCompatible: () => true,
}));

import { WorkflowCanvas } from '@/components/create/workflow-canvas';

const modelNode = {
  id: 'video-model',
  type: 'seedance-2',
  position: { x: 0, y: 0 },
  selected: true,
  data: {
    type: 'seedance-2',
    label: 'Seedance 2.0',
    config: {},
  },
};

function flowHandler(name: string): (...args: never[]) => void {
  const handler = flowHarness.props?.[name];
  expect(handler).toBeTypeOf('function');
  return handler as (...args: never[]) => void;
}

describe('WorkflowCanvas node click and drag behavior', () => {
  beforeEach(() => {
    workspaceHarness.state = {
      nodes: [modelNode],
      edges: [],
      elements: [],
      runningNodeIds: new Set<string>(),
    };
    workspaceHarness.dispatch.mockClear();
    flowHarness.props = null;
    localStorage.setItem('cinegen_mobile_canvas_guide_seen', '1');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.each([
    { label: 'desktop mouse', mobile: false, clickDistance: 0 },
    { label: 'mobile touch', mobile: true, clickDistance: 8 },
  ])('opens only for a deliberate $label click, not selection or drag', ({ mobile, clickDistance }) => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: mobile,
        media: '(max-width: 767px)',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    render(<WorkflowCanvas />);

    expect(flowHarness.props?.nodeClickDistance).toBe(clickDistance);
    expect(screen.queryByTestId('node-inspector')).not.toBeInTheDocument();

    act(() => flowHandler('onNodeClick')({} as never, modelNode as never));
    expect(screen.getByTestId('node-inspector')).toHaveTextContent('video-model');

    act(() => flowHandler('onNodeDragStart')({} as never, modelNode as never));
    expect(screen.queryByTestId('node-inspector')).not.toBeInTheDocument();

    act(() => {
      flowHandler('onNodeDragStop')();
      flowHandler('onNodeClick')({} as never, modelNode as never);
    });
    expect(screen.queryByTestId('node-inspector')).not.toBeInTheDocument();

    act(() => flowHandler('onNodeClick')({} as never, modelNode as never));
    expect(screen.getByTestId('node-inspector')).toHaveTextContent('video-model');
  });
});
