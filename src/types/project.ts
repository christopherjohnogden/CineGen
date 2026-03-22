import type { Node, Edge } from '@xyflow/react';
import type { Timeline } from './timeline';
import type { ExportJob } from './export';
import type { WorkflowNodeData } from './workflow';
import type { Element } from './elements';

export interface Asset {
  id: string;
  name: string;
  type: 'image' | 'video' | 'audio';
  url: string;
  thumbnailUrl?: string;
  duration?: number;
  width?: number;
  height?: number;
  createdAt: string;
  metadata?: Record<string, unknown>;
  folderId?: string;
  // Local file and proxy fields (optional — added for SQLite-backed projects)
  fileRef?: string;        // local file path (relative or absolute)
  originalPath?: string;   // original import location for relinking
  sourceUrl?: string;      // CDN URL for AI-generated content
  proxyRef?: string;       // path to proxy/low-res file
  fps?: number;
  codec?: string;
  fileSize?: number;
  checksum?: string;
  status?: 'online' | 'offline' | 'processing';
}

export interface MediaFolder {
  id: string;
  name: string;
  parentId?: string;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowSpaceSnapshot {
  id: string;
  name: string;
  createdAt: string;
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
}

export interface ProjectSnapshot {
  project: Project;
  workflow?: {
    nodes: Node<WorkflowNodeData>[];
    edges: Edge[];
  };
  spaces?: WorkflowSpaceSnapshot[];
  activeSpaceId?: string;
  openSpaceIds?: string[];
  sequence?: unknown;
  assets?: Asset[];
  mediaFolders?: MediaFolder[];
  timelines?: Timeline[];
  activeTimelineId?: string;
  exports?: ExportJob[];
  elements?: Element[];
}
