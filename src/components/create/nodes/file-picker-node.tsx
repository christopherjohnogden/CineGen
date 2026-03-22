

import { memo, useCallback, useRef, useState, useEffect } from 'react';
import { type NodeProps, useReactFlow } from '@xyflow/react';
import { BaseNode } from './base-node';
import { getApiKey } from '@/lib/utils/api-key';
import type { WorkflowNodeData } from '@/types/workflow';

type FilePickerNodeProps = NodeProps & { data: WorkflowNodeData };

type FileMediaType = 'image' | 'video' | 'audio' | '';

function detectMediaType(file: File): FileMediaType {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return '';
}

const ACCEPT = 'image/*,video/*,audio/*';

function FilePickerNodeInner({ id, data, selected }: FilePickerNodeProps) {
  const { updateNodeData } = useReactFlow();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const fileUrl = (data.config?.fileUrl as string) ?? '';
  const fileType = (data.config?.fileType as FileMediaType) ?? '';
  const fileName = (data.config?.fileName as string) ?? '';
  const configThumb = (data.config?.thumbnailUrl as string) ?? '';

  // For videos, extract a thumbnail frame from the video itself
  const [videoThumb, setVideoThumb] = useState<string>('');
  useEffect(() => {
    if (fileType !== 'video' || !fileUrl || configThumb) { setVideoThumb(''); return; }
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'auto';
    video.src = fileUrl;
    const timeout = setTimeout(() => { video.src = ''; }, 10000);
    video.addEventListener('loadeddata', () => {
      video.currentTime = 0.1;
    }, { once: true });
    video.addEventListener('seeked', () => {
      clearTimeout(timeout);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0);
          setVideoThumb(canvas.toDataURL('image/jpeg', 0.8));
        }
      } catch { /* tainted canvas */ }
    }, { once: true });
    video.addEventListener('error', () => clearTimeout(timeout), { once: true });
    video.load();
    return () => { clearTimeout(timeout); video.src = ''; };
  }, [fileUrl, fileType, configThumb]);

  const thumbSrc = configThumb || videoThumb;

  const detectMediaTypeFromExt = useCallback((filePath: string): FileMediaType => {
    const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'svg'];
    const videoExts = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'm4v'];
    const audioExts = ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a', 'wma', 'aiff'];
    if (imageExts.includes(ext)) return 'image';
    if (videoExts.includes(ext)) return 'video';
    if (audioExts.includes(ext)) return 'audio';
    return '';
  }, []);

  const openNativeFilePicker = useCallback(async () => {
    if (uploading) return;
    setError('');

    try {
      const result = await window.electronAPI.dialog.showOpen({
        filters: [
          { name: 'Media Files', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'mp4', 'mov', 'avi', 'mkv', 'webm', 'mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a', 'aiff'] },
        ],
        properties: ['openFile'],
      });

      if (!result) return; // user cancelled
      const filePath = typeof result === 'string' ? result : result[0];
      if (!filePath) return;

      const fileName = filePath.split('/').pop() ?? filePath;
      const mediaType = detectMediaTypeFromExt(filePath);

      if (!mediaType) {
        setError('Unsupported file type');
        return;
      }

      const url = `local-media://file${filePath}`;
      updateNodeData(id, {
        config: { ...data.config, fileUrl: url, fileType: mediaType, fileName },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open file');
    }
  }, [id, data.config, updateNodeData, uploading, detectMediaTypeFromExt]);

  const uploadFile = useCallback(
    async (file: File) => {
      const mediaType = detectMediaType(file);
      if (!mediaType) {
        setError('Unsupported file type');
        return;
      }

      setUploading(true);
      setError('');

      try {
        const localPath = (file as any).path as string | undefined;
        let url: string;

        if (localPath) {
          url = `local-media://file${localPath}`;
        } else {
          const apiKey = getApiKey();
          const buffer = await file.arrayBuffer();
          const result = await window.electronAPI.elements.upload(
            { buffer, name: file.name, type: file.type },
            apiKey,
          );
          url = result.url;
        }

        updateNodeData(id, {
          config: { ...data.config, fileUrl: url, fileType: mediaType, fileName: file.name },
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setUploading(false);
      }
    },
    [id, data.config, updateNodeData],
  );

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      uploadFile(files[0]);
    },
    [uploadFile],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const handleClear = useCallback(() => {
    updateNodeData(id, {
      config: { ...data.config, fileUrl: '', fileType: '', fileName: '' },
    });
    setError('');
  }, [id, data.config, updateNodeData]);

  return (
    <BaseNode nodeType="filePicker" selected={!!selected}>
      <div className="file-picker-node__body">
        {fileUrl ? (
          <div className="file-picker-node__preview">
            {fileType === 'image' && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fileUrl} alt={fileName} className="file-picker-node__preview-img" />
            )}
            {fileType === 'video' && thumbSrc && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumbSrc} alt={fileName} className="file-picker-node__preview-img" />
            )}
            {fileType === 'video' && !thumbSrc && (
              <div className="file-picker-node__video-placeholder">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              </div>
            )}
            {fileType === 'audio' && (
              <div className="file-picker-node__audio-preview">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
              </div>
            )}
            <div className="file-picker-node__preview-bar">
              <div className="file-picker-node__file-info">
                <span className="file-picker-node__file-name">{fileName}</span>
                <span className="file-picker-node__file-type">{fileType}</span>
              </div>
              <button
                type="button"
                className="file-picker-node__clear nodrag"
                onClick={handleClear}
                title="Remove file"
              >
                &times;
              </button>
            </div>
          </div>
        ) : (
          <div
            className={`file-picker-node__dropzone nodrag${isDragging ? ' file-picker-node__dropzone--dragging' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => openNativeFilePicker()}
          >
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              className="file-picker-node__input"
              onChange={(e) => handleFiles(e.target.files)}
            />
            {uploading ? (
              <>
                <div className="file-picker-node__spinner" />
                <span className="file-picker-node__label">Uploading...</span>
              </>
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <span className="file-picker-node__label">Drop file or click</span>
              </>
            )}
          </div>
        )}
        {error && <div className="file-picker-node__error">{error}</div>}
      </div>
    </BaseNode>
  );
}

export const FilePickerNode = memo(FilePickerNodeInner);
