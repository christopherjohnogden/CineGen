

import { useRef, useState, useCallback } from 'react';
import type { ElementImage } from '@/types/elements';
import { getApiKey } from '@/lib/utils/api-key';

interface ElementImageUploadProps {
  onUpload: (images: ElementImage[]) => void;
}

async function uploadToFal(file: File): Promise<string> {
  const apiKey = getApiKey();
  const buffer = await file.arrayBuffer();
  const { url } = await window.electronAPI.elements.upload(
    { buffer, name: file.name, type: file.type },
    apiKey,
  );
  return url;
}

export function ElementImageUpload({ onUpload }: ElementImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(0);

  const processFiles = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    setUploading(imageFiles.length);

    const uploaded: ElementImage[] = [];
    for (const file of imageFiles) {
      try {
        const url = await uploadToFal(file);
        uploaded.push({
          id: crypto.randomUUID(),
          url,
          createdAt: new Date().toISOString(),
          source: 'upload' as const,
        });
      } catch (err) {
        console.error('[element-upload] Failed to upload:', file.name, err);
      }
      setUploading((prev) => prev - 1);
    }

    if (uploaded.length > 0) onUpload(uploaded);
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
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => !uploading && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="element-upload__input"
        onChange={(e) => processFiles(e.target.files)}
      />
      {uploading > 0 ? (
        <>
          <div className="element-upload__spinner" />
          <span className="element-upload__text">Uploading {uploading} image{uploading > 1 ? 's' : ''}...</span>
        </>
      ) : (
        <>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="element-upload__icon">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span className="element-upload__text">Drop images here or click to browse</span>
        </>
      )}
    </div>
  );
}
