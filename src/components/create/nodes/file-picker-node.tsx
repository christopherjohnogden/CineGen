

import { memo, useCallback, useRef, useState, useEffect } from 'react';
import { Handle, NodeResizer, Position, type NodeProps, useReactFlow } from '@xyflow/react';
import { BaseNode } from './base-node';
import {
  detectMediaType,
  detectMediaTypeFromExt,
  resolveMediaFileUrl,
  type FileMediaType,
} from '@/lib/utils/media-file';
import { toFileUrl } from '@/lib/utils/file-url';
import type { WorkflowNodeData } from '@/types/workflow';
import { PORT_COLORS } from '@/lib/workflows/node-registry';

type FilePickerNodeProps = NodeProps & { data: WorkflowNodeData };

const ACCEPT = 'image/*,video/*,audio/*';
const DEFAULT_VISUAL_WIDTH = 280;
const DEFAULT_VISUAL_HEIGHT = 157.5;

function positiveDimension(value: number | null | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function FilePickerNodeInner({ id, data, selected, width, height }: FilePickerNodeProps) {
  const { updateNodeData } = useReactFlow();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const fileUrl = (data.config?.fileUrl as string) ?? '';
  const fileType = (data.config?.fileType as FileMediaType) ?? '';
  const fileName = (data.config?.fileName as string) ?? '';
  const [mediaReady, setMediaReady] = useState(false);
  const [mediaError, setMediaError] = useState(false);

  useEffect(() => {
    setMediaReady(false);
    setMediaError(false);
  }, [fileUrl, fileType]);

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

      const url = toFileUrl(filePath);
      updateNodeData(id, {
        config: { ...data.config, fileUrl: url, fileType: mediaType, fileName },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open file');
    }
  }, [id, data.config, updateNodeData, uploading]);

  const uploadFile = useCallback(
    async (file: File) => {
      const mediaType = detectMediaType(file) || detectMediaTypeFromExt(file.name);
      if (!mediaType) {
        setError('Unsupported file type');
        return;
      }

      setUploading(true);
      setError('');

      try {
        const url = await resolveMediaFileUrl(file);
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

  const isVisualMedia = Boolean(fileUrl && (fileType === 'image' || fileType === 'video'));

  if (isVisualMedia) {
    const visualWidth = positiveDimension(width, DEFAULT_VISUAL_WIDTH);
    const visualHeight = positiveDimension(height, DEFAULT_VISUAL_HEIGHT);
    return (
      <div
        className={`file-picker-node file-picker-node--visual${selected ? ' file-picker-node--selected' : ''}`}
        data-media-type={fileType}
        aria-label={`${fileType} node: ${fileName || 'Untitled media'}`}
        style={{ width: visualWidth, height: visualHeight }}
      >
        <NodeResizer
          isVisible={!!selected}
          minWidth={180}
          minHeight={101.25}
          maxWidth={960}
          maxHeight={540}
          keepAspectRatio
          lineClassName="media-node-resizer__line"
          handleClassName="media-node-resizer__handle"
        />

        <div className="file-picker-node__media-frame" onDoubleClick={() => void openNativeFilePicker()}>
          {fileType === 'video' ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              key={fileUrl}
              src={fileUrl}
              className={`file-picker-node__media nodrag nowheel${mediaReady ? ' file-picker-node__media--ready' : ''}`}
              controls
              playsInline
              preload="metadata"
              onLoadedData={() => setMediaReady(true)}
              onError={() => setMediaError(true)}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={fileUrl}
              alt={fileName}
              className={`file-picker-node__media${mediaReady ? ' file-picker-node__media--ready' : ''}`}
              draggable={false}
              onLoad={() => setMediaReady(true)}
              onError={() => setMediaError(true)}
            />
          )}

          {!mediaReady && !mediaError && (
            <div className="file-picker-node__media-loading" aria-label={`Loading ${fileType}`}>
              <span />
            </div>
          )}

          {mediaError && (
            <div className="file-picker-node__media-error nodrag">
              <span>Media unavailable</span>
              <button type="button" onClick={() => void openNativeFilePicker()}>Replace</button>
            </div>
          )}

          <div className="file-picker-node__media-overlay">
            <div className="file-picker-node__media-meta">
              <span className="file-picker-node__media-kind">{fileType}</span>
              <span className="file-picker-node__media-name">{fileName || 'Untitled'}</span>
            </div>
            <button
              type="button"
              className="file-picker-node__media-remove nodrag"
              onClick={handleClear}
              title="Remove media"
              aria-label="Remove media"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        </div>

        <Handle
          type="source"
          position={Position.Right}
          id="media"
          className="file-picker-node__media-handle"
          style={{ background: PORT_COLORS.media, top: '50%' }}
        />
        <span className="file-picker-node__media-port-label" aria-hidden>output</span>
      </div>
    );
  }

  return (
    <BaseNode nodeType="filePicker" selected={!!selected}>
      <div className="file-picker-node__body">
        {fileUrl ? (
          <div className="file-picker-node__preview">
            {fileType === 'image' && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fileUrl} alt={fileName} className="file-picker-node__preview-img" />
            )}
            {fileType === 'video' && (
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
