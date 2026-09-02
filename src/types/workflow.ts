export type PortType = 'text' | 'image' | 'video' | 'audio' | 'model3d' | 'media' | 'number' | 'config' | 'model' | 'multi_prompt' | 'composition_plan';

export type NodeCategory = 'utility' | 'image' | 'video' | 'image-edit' | 'audio' | 'text' | 'model3d';

export type UtilityNodeType = 'prompt' | 'duration' | 'assetOutput' | 'multiPrompt' | 'shotPrompt' | 'element' | 'compositionPlan' | 'musicPrompt' | 'filePicker';

export type CinegenNodeType = UtilityNodeType | string;

export interface PortDefinition {
  id: string;
  type: PortType;
  label: string;
  multiple?: boolean;
  mediaRole?: 'image' | 'start_image' | 'end_image' | 'video' | 'audio';
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
  fieldType: 'port' | 'text' | 'textarea' | 'number' | 'select' | 'range' | 'toggle' | 'json' | 'element-list';
  /** `description` renders as the secondary line in a setting row's option flyout. */
  options?: { value: string; label: string; description?: string }[];
  default?: unknown;
  min?: number;
  max?: number;
  step?: number;
  description?: string;
  placeholder?: string;
  schemaType?: 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object' | 'null';
  multiple?: boolean;
  mediaRole?: 'image' | 'start_image' | 'end_image' | 'video' | 'audio';
  minItems?: number;
  maxItems?: number;
}

export interface ModelOutputField {
  id: string;
  portType: PortType;
  label: string;
  responsePath?: string;
}

export interface ModelDefinition {
  id: string;
  altId?: string;
  nodeType: string;
  name: string;
  category: 'image' | 'video' | 'image-edit' | 'audio' | 'text' | 'model3d';
  description: string;
  inputs: ModelInputField[];
  outputType: 'image' | 'video' | 'audio' | 'text' | 'model3d';
  outputs?: ModelOutputField[];
  provider?: 'topview' | 'higgsfield' | 'fal' | 'kie' | 'local' | 'runpod' | 'pod';
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

/** Non-secret task coordinates needed to resume a paid Topview video render. */
export interface TopviewVideoTaskState {
  taskId: string;
  taskType: 'text_to_video' | 'image_to_video' | 'omni_reference';
  boardId?: string;
  model: string;
  /** Absent for fixed-length models, which do not expose a duration parameter. */
  durationSec?: number;
  boardUrl?: string;
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
    /** Renderer timestamp used to show honest elapsed time for long remote jobs. */
    progressStartedAt?: number;
    error?: string;
    layers?: LayerInfo[];
    selectedLayerIndex?: number;
    segments?: TranscriptSegment[];
    language?: string;
    transcriptPath?: string;
    wordTimestampsStatus?: 'idle' | 'loading' | 'ready' | 'error';
    /** Remote render retained so a transient transfer failure can resume without paying for another job. */
    remoteJobId?: string;
    /** Topview task retained across polling failures, app restarts, and project saves. */
    topviewTask?: TopviewVideoTaskState;
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
