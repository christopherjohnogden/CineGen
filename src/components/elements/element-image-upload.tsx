

import { useRef, useState, useCallback } from 'react';
import type { ElementImage } from '@/types/elements';
import { getApiKey } from '@/lib/utils/api-key';

interface ElementImageUploadProps {
  onUpload: (images: ElementImage[]) => void;
  title?: string;
  hint?: string;
}

async function uploadElementFile(file: File): Promise<string> {
  const apiKey = getApiKey();
  const buffer = await file.arrayBuffer();
  const { url } = await window.electronAPI.elements.upload(
    { buffer, name: file.name, type: file.type },
    apiKey,
  );
  return url;
}

export function ElementImageUpload({
  onUpload,
  title = 'Drop images here or click to browse',
  hint = 'JPG, PNG or WebP · Select one image or a complete reference set',
}: ElementImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const processFiles = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      setError('Choose an image file such as JPG, PNG or WebP.');
      return;
    }

    setError(null);
    setUploading(imageFiles.length);

    const uploaded: ElementImage[] = [];
    const failed: string[] = [];
    for (const file of imageFiles) {
      try {
        const url = await uploadElementFile(file);
        uploaded.push({
          id: crypto.randomUUID(),
          url,
          createdAt: new Date().toISOString(),
          source: 'upload' as const,
        });
      } catch (err) {
        console.error('[element-upload] Failed to upload:', file.name, err);
        failed.push(file.name);
      }
      setUploading((prev) => prev - 1);
    }

    if (uploaded.length > 0) onUpload(uploaded);
    if (failed.length > 0) {
      setError(failed.length === imageFiles.length
        ? 'CineGen could not upload these images. Check your connection and try again.'
        : `${failed.length} image${failed.length === 1 ? '' : 's'} could not be uploaded. The other files were added.`);
    }
    setUploading(0);
  }, [onUpload]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    processFiles(e.dataTransfer.files);
  }, [processFiles]);

  return (
    <div
      className={`element-upload ${isDragging ? 'element-upload--dragging' : ''}`}
      role="button"
      tabIndex={0}
      aria-busy={uploading > 0}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => !uploading && inputRef.current?.click()}
      onKeyDown={(event) => {
        if (!uploading && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="element-upload__input"
        onChange={(e) => {
          void processFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {uploading > 0 ? (
        <>
          <div className="element-upload__spinner" />
          <span className="element-upload__text">Preparing {uploading} image{uploading > 1 ? 's' : ''}…</span>
          <span className="element-upload__hint">Keep this window open while the files are added.</span>
        </>
      ) : (
        <>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="element-upload__icon">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span className="element-upload__text">{title}</span>
          <span className="element-upload__hint">{hint}</span>
        </>
      )}
      {error && <span className="element-upload__error" role="alert">{error}</span>}
    </div>
  );
}
