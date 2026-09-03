import type { Edge, Node } from '@xyflow/react';
import type { Element } from '@/types/elements';
import type { DirectorShow } from '@/types/director';
import type { WorkflowSpace } from '@/types/workspace';
import type { Asset } from '@/types/project';
import type { Timeline } from '@/types/timeline';
import type { WorkflowNodeData } from '@/types/workflow';

/**
 * What the MCP tools are allowed to see and do.
 *
 * The handlers are written against this rather than against React so they can be
 * tested without a renderer, and so a future headless host can implement the
 * same six members and get the whole tool surface for free.
 */
export interface McpHostState {
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
  spaces: WorkflowSpace[];
  activeSpaceId: string;
  elements: Element[];
  assets: Asset[];
  timelines: Timeline[];
  activeTimelineId: string;
  director: DirectorShow;
}

/** The subset of workspace actions the tools emit. Each member mirrors the real reducer. */
export type McpAction =
  | { type: 'SET_NODES'; nodes: Node<WorkflowNodeData>[] }
  | { type: 'ADD_SPACE'; space: WorkflowSpace }
  | { type: 'SET_ACTIVE_SPACE'; spaceId: string }
  | { type: 'ADD_ELEMENT'; element: Element }
  | { type: 'SET_DIRECTOR'; director: DirectorShow };

export interface McpHost {
  getState(): McpHostState;
  dispatch(action: McpAction): void;
  /** Starts a generation. Fire and forget: results arrive on the node later. */
  runNode(nodeId: string, nodes: Node<WorkflowNodeData>[], edges: Edge[]): void;
  /** Name of the open project, for context. */
  projectName?: string;
}

/** A tool failed in a way the caller can act on. The message is shown to the model. */
export class McpToolError extends Error {}

export type McpToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
