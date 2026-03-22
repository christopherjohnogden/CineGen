export type PortType = 'text' | 'image' | 'video' | 'audio' | 'media' | 'number' | 'config' | 'model' | 'multi_prompt' | 'composition_plan';

export type NodeCategory = 'utility' | 'image' | 'video' | 'image-edit' | 'audio' | 'text';

export type UtilityNodeType = 'prompt' | 'duration' | 'assetOutput' | 'shotPrompt' | 'element' | 'compositionPlan' | 'musicPrompt' | 'filePicker';

export type CinegenNodeType = UtilityNodeType | string;

export interface PortDefinition {
  id: string;
  type: PortType;
  label: string;
}

export interface NodeTypeDefinition {
  type: CinegenNodeType;
  label: string;
  category: NodeCategory;
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  defaultData: Record<string, unknown>;
  isModel?: boolean;
}

export interface ModelInputField {
  id: string;
  portType: PortType;
  label: string;
  required: boolean;
  falParam: string;
  fieldType: 'port' | 'text' | 'textarea' | 'number' | 'select' | 'range' | 'toggle' | 'element-list';
  options?: { value: string; label: string }[];
  default?: unknown;
  min?: number;
  max?: number;
  step?: number;
}

export interface ModelDefinition {
  id: string;
  altId?: string;
  nodeType: string;
  name: string;
  category: 'image' | 'video' | 'image-edit' | 'audio' | 'text';
  description: string;
  inputs: ModelInputField[];
  outputType: 'image' | 'video' | 'audio' | 'text';
  provider?: 'fal' | 'kie' | 'local' | 'runpod' | 'pod';
  runpodEndpointId?: string;
  podRoute?: string;  // e.g. 'sdxl', 'flux', 'qwen-edit', 'ltx', 'wan-t2v', 'wan-i2v'
  responseMapping: {
    path: string;
  };
}

export interface LayerInfo {
  url: string;
  name: string;
  type: string;
  z_order: number;
  metadata?: Record<string, unknown>;
}

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
  prob?: number;
  speaker?: string | null;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string | null;
  words?: TranscriptWord[];
}

export interface WorkflowNodeData extends Record<string, unknown> {
  type: CinegenNodeType;
  label: string;
  config: Record<string, unknown>;
  modelId?: string;
  result?: {
    url?: string;
    text?: string;
    status?: 'idle' | 'running' | 'complete' | 'error';
    progress?: number;
    progressStage?: string;
    progressMessage?: string;
    error?: string;
    layers?: LayerInfo[];
    selectedLayerIndex?: number;
    segments?: TranscriptSegment[];
    language?: string;
    transcriptPath?: string;
    wordTimestampsStatus?: 'idle' | 'loading' | 'ready' | 'error';
  };
  generations?: string[];
  activeGeneration?: number;
}

export interface WorkflowRun {
  id: string;
  status: 'pending' | 'running' | 'complete' | 'error';
  startedAt: string;
  completedAt?: string;
  nodeResults: Record<string, {
    status: string;
    output?: unknown;
    error?: string;
  }>;
}
