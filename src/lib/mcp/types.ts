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
 * same interface and expose the supported tool surface.
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
  mediaFolders?: import('@/types/project').MediaFolder[];
  elementFolders?: import('@/types/elements').ElementFolder[];
  exports?: import('@/types/export').ExportJob[];
}

/** Typed app actions; only validated, named MCP operations can emit these. */
export type McpAction = import('@/components/workspace/workspace-shell').WorkspaceAction;

export interface McpHost {
  getState(): McpHostState;
  dispatch(action: McpAction): void;
  /** Starts a generation. Fire and forget: results arrive on the node later. */
  runNode(nodeId: string, nodes: Node<WorkflowNodeData>[], edges: Edge[]): void;
  /** Name of the open project, for context. */
  projectName?: string;
  appAction?: (action: string, args: Record<string, unknown>) => Promise<unknown>;
}

/** A tool failed in a way the caller can act on. The message is shown to the model. */
export class McpToolError extends Error {}

export type McpToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
