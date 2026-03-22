import type { Node, Edge } from '@xyflow/react';
import type { Asset, MediaFolder } from './project';
import type { Timeline } from './timeline';
import type { ExportJob } from './export';
import type { WorkflowNodeData, WorkflowRun } from './workflow';
import type { Element } from './elements';

export type ProjectTab = 'elements' | 'create' | 'edit' | 'llm' | 'export' | 'settings';

export interface WorkflowSpace {
  id: string;
  name: string;
  createdAt: string;
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
}

export interface WorkspaceState {
  activeTab: ProjectTab;
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
  spaces: WorkflowSpace[];
  activeSpaceId: string;
  openSpaceIds: Set<string>;
  assets: Asset[];
  mediaFolders: MediaFolder[];
  timelines: Timeline[];
  activeTimelineId: string;
  openTimelineIds: Set<string>;
  currentRun: WorkflowRun | null;
  runningNodeIds: Set<string>;
  exports: ExportJob[];
  elements: Element[];
}
