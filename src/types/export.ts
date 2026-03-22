export type ExportPreset = 'draft' | 'standard' | 'high';
export type ExportStatus = 'queued' | 'rendering' | 'complete' | 'failed';

export interface ExportJob {
  id: string;
  status: ExportStatus;
  progress: number;
  preset: ExportPreset;
  fps: 24 | 30 | 60;
  outputUrl?: string;
  fileSize?: number;
  error?: string;
  createdAt: string;
  completedAt?: string;
}
