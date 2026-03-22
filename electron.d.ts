import type { ProjectSnapshot } from './src/types/project';
import type { ExportJob } from './src/types/export';
import type { TranscriptSegment } from './src/types/workflow';
import type {
  AssetVisualSummary,
  CutWorkflowResult,
  EditorialBrief,
  ProjectInsightIndex,
} from './src/lib/llm/editorial-workflow';

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  assetCount: number;
  elementCount: number;
  thumbnail: string | null;
  useSqlite?: boolean;
}

export interface ElectronAPI {
  project: {
    list: () => Promise<ProjectMeta[]>;
    create: (name: string) => Promise<ProjectSnapshot>;
    load: (id: string) => Promise<ProjectSnapshot>;
    save: (id: string, data: Partial<ProjectSnapshot>) => Promise<ProjectSnapshot>;
    delete: (id: string) => Promise<void>;
  };
  workflow: {
    run: (params: {
      apiKey?: string;
      kieKey?: string;
      runpodKey?: string;
      runpodEndpointId?: string;
      podUrl?: string;
      nodeId: string;
      nodeType: string;
      modelId: string;
      inputs: Record<string, unknown>;
    }) => Promise<unknown>;
    pollJob: (id: string) => Promise<{ status: string; result?: unknown }>;
  };
  pod: {
    start:  (params: { runpodKey: string; podId: string }) => Promise<unknown>;
    stop:   (params: { runpodKey: string; podId: string }) => Promise<unknown>;
    status: (params: { runpodKey: string; podId: string }) => Promise<{ status: string; ip: string | null; port: number | null }>;
  };
  export: {
    start: (params: {
      preset?: 'draft' | 'standard' | 'high';
      fps?: number;
      outputPath?: string;
      clips: Array<{
        inputPath: string;
        startTime: number;
        duration: number;
        trimStart: number;
        speed: number;
        volume: number;
        type: 'video' | 'audio' | 'image';
      }>;
      totalDuration: number;
    }) => Promise<ExportJob>;
    poll: (id: string) => Promise<ExportJob>;
    cancel: (id: string) => Promise<{ ok: boolean }>;
    onProgress: (cb: (data: { jobId: string; progress: number }) => void) => (() => void);
  };
  elements: {
    upload: (fileData: { buffer: ArrayBuffer; name: string; type: string }, apiKey?: string) => Promise<{ url: string }>;
    uploadTranscriptionSource: (sourceUrl: string, apiKey?: string) => Promise<{ url: string }>;
    uploadMediaSource: (sourceUrl: string, apiKey?: string) => Promise<{ url: string }>;
  };
  music: {
    generatePrompt: (params: {
      apiKey?: string;
      frameUrls?: string[];
      style?: string;
      genre?: string;
      mood?: string;
      tempo?: string;
      additionalNotes?: string;
    }) => Promise<{ prompt: string }>;
  };
  llm: {
    chat: (params: {
      apiKey?: string;
      model?: string;
      systemPrompt?: string;
      messages: Array<{
        role: 'user' | 'assistant' | 'system';
        content: string;
      }>;
      maxTokens?: number;
      temperature?: number;
    }) => Promise<{
      message: string;
      usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        cost: number;
      };
    }>;
    localChat: (params: {
      requestId?: string;
      model?: string;
      systemPrompt?: string;
      messages?: Array<{
        role: 'user' | 'assistant' | 'system';
        content: string;
      }>;
      maxTokens?: number;
      temperature?: number;
    }) => Promise<{
      message: string;
      usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        cost: number;
      };
    }>;
    localModels: () => Promise<string[]>;
    onLocalStream: (cb: (data: { requestId: string; token?: string; done?: boolean }) => void) => (() => void);
    runCutWorkflow: (params: {
      apiKey?: string;
      model?: string;
      systemPrompt?: string;
      request: string;
      projectId: string;
      activeTimelineId: string;
      index: ProjectInsightIndex;
      confirmedBrief?: boolean;
      briefOverride?: Partial<EditorialBrief>;
      questionAnswers?: Record<string, string>;
      visionModel?: string;
    }) => Promise<CutWorkflowResult>;
  };
  vision: {
    indexAsset: (params: {
      apiKey?: string;
      assetId: string;
      assetName: string;
      framePaths: string[];
      model?: string;
    }) => Promise<AssetVisualSummary>;
    detectObjects: (params: {
      apiKey?: string;
      imagePath: string;
      maxObjects?: number;
      context?: string;
      model?: string;
    }) => Promise<{
      status: 'ready' | 'failed' | 'missing';
      model: string;
      objects: Array<{
        label: string;
        box: [number, number, number, number];
        score: number;
        priority: number;
      }>;
      error?: string;
    }>;
  };
  dialog: {
    showSave: (options?: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>;
    showOpen: (options?: { filters?: { name: string; extensions: string[] }[]; properties?: string[] }) => Promise<string[] | string | null>;
  };
  shell: {
    openPath: (path: string) => Promise<string>;
  };
  pm: {
    openProject: (id: string, useSqlite: boolean) => Promise<{ ok: boolean }>;
    open: () => Promise<{ ok: boolean }>;
    onOpenProject: (cb: (id: string, useSqlite: boolean) => void) => (() => void);
  };
  db: {
    createProject: (name: string) => Promise<unknown>;
    loadProject: (id: string) => Promise<unknown>;
    saveProject: (id: string, state: unknown) => Promise<void>;
    deleteProject: (id: string) => Promise<void>;
    closeProject: (id: string) => Promise<void>;
    updateProject: (id: string, data: unknown) => Promise<void>;
    insertAsset: (asset: unknown) => Promise<unknown>;
    updateAsset: (projectId: string, id: string, data: unknown) => Promise<void>;
    deleteAsset: (projectId: string, id: string) => Promise<void>;
  };
  media: {
    import: (params: { filePaths: string[]; projectId: string; mode: 'link' | 'copy' }) => Promise<Array<{ assetId: string; jobId: string; filePath: string; type: 'video' | 'audio' | 'image' }>>;
    submitJob: (job: unknown) => Promise<unknown>;
    cancelJob: (jobId: string) => Promise<void>;
    queueProcessing: (params: {
      assetId: string;
      projectId: string;
      inputPath: string;
      needsProxy?: boolean;
      includeThumbnail?: boolean;
      includeWaveform?: boolean;
      includeFilmstrip?: boolean;
    }) => Promise<void>;
    onJobProgress: (cb: (data: { jobId: string; progress: number }) => void) => (() => void);
    onJobComplete: (cb: (data: { jobId: string; result: unknown; assetId?: string; jobType?: string }) => void) => (() => void);
    onJobError: (cb: (data: { jobId: string; error: string; assetId?: string; jobType?: string }) => void) => (() => void);
    extractFrame: (params: { inputPath: string; timeSec: number }) => Promise<{ outputPath: string } | null>;
    extractClip: (params: { inputPath: string; startTimeSec: number; durationSec: number }) => Promise<{ outputPath: string } | null>;
    downloadRemote: (params: { url: string; projectId: string; assetId: string; ext?: string }) => Promise<{ path: string }>;
  };
  transcription: {
    start: (params: {
      projectId: string;
      assetId: string;
      filePath: string;
      model?: 'tiny' | 'base' | 'small' | 'medium' | 'large';
      language?: string;
      engine?: 'faster-whisper-local' | 'whisperx-local' | 'whisper-cloud';
      apiKey?: string;
    }) => Promise<{ jobId: string }>;
    get: (jobId: string) => Promise<{
      status: 'pending' | 'running' | 'done' | 'error';
      fullText: string;
      segments: Array<{
        text: string;
        start: number;
        end: number;
        speaker?: string | null;
        words?: Array<{ word: string; start: number; end: number; prob?: number; speaker?: string | null }>;
      }>;
      language: string;
      engine?: 'faster-whisper-local' | 'whisperx-local' | 'whisper-cloud';
      error?: string;
    } | null>;
    onProgress: (cb: (data: {
      jobId: string;
      assetId?: string;
      engine?: 'faster-whisper-local' | 'whisperx-local' | 'whisper-cloud';
      type: 'status' | 'segment' | 'progress' | 'done' | 'error';
      text?: string;
      start?: number;
      end?: number;
      stage?: string;
      message?: string;
      speaker?: string | null;
      words?: Array<{ word: string; start: number; end: number; prob?: number; speaker?: string | null }>;
      segments?: Array<{
        text: string;
        start: number;
        end: number;
        speaker?: string | null;
        words?: Array<{ word: string; start: number; end: number; prob?: number; speaker?: string | null }>;
      }>;
      language?: string;
      error?: string;
    }) => void) => (() => void);
  };
  sam3: {
    start: () => Promise<{ port: number }>;
    stop: () => Promise<void>;
    getPort: () => Promise<{ port: number; running: boolean }>;
  };
  localModel: {
    run: (params: { nodeType: string; inputs: Record<string, unknown> }) => Promise<{ jobId: string }>;
    readTranscript: (transcriptPath: string) => Promise<{
      output_text?: string;
      segments?: TranscriptSegment[];
      language?: string;
    } | null>;
    get: (jobId: string) => Promise<{
      status: 'pending' | 'running' | 'done' | 'error';
      stage?: string;
      outputPath?: string;
      outputText?: string;
      segments?: TranscriptSegment[];
      language?: string;
      transcriptPath?: string;
      error?: string;
    } | null>;
    onProgress: (cb: (data: {
      jobId: string;
      type: 'status' | 'progress' | 'done' | 'error';
      stage?: string;
      message?: string;
      output_path?: string;
      output_text?: string;
      segments?: TranscriptSegment[];
      language?: string;
      transcript_path?: string;
      error?: string;
      layers?: Array<{ path: string; name: string; type: string; z_order: number; metadata?: Record<string, unknown> }>;
      needs_inpainting?: boolean;
      combined_mask_path?: string;
    }) => void) => (() => void);
  };
  app: {
    onPowerEvent: (cb: (data: { type: 'suspend' | 'resume' | 'unlock-screen' }) => void) => (() => void);
  };
  nativeVideo: {
    isAvailable: () => Promise<{ available: boolean; error?: string | null }>;
    resetSurfaces: (surfaceIds: string[]) => Promise<boolean>;
    createSurface: (surfaceId: string) => Promise<boolean>;
    setSurfaceRect: (payload: { surfaceId: string; x: number; y: number; width: number; height: number }) => void;
    setSurfaceHidden: (payload: { surfaceId: string; hidden: boolean }) => void;
    clearSurface: (surfaceId: string) => void;
    syncSurface: (payload: {
      surfaceId: string;
      descriptors: Array<{
        id: string;
        kind: 'video' | 'image';
        source: string;
        currentTime: number;
        rate: number;
        opacity: number;
        zIndex: number;
        visible: boolean;
        playing: boolean;
        muted: boolean;
        flipH: boolean;
        flipV: boolean;
      }>;
    }) => void;
    destroySurface: (surfaceId: string) => void;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
