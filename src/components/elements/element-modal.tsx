

import { useState, useCallback } from 'react';
import type { Element, ElementType, ElementImage } from '@/types/elements';
import { ElementImageUpload } from './element-image-upload';
import { ElementGenerate } from './element-generate';

const ELEMENT_TYPES: { id: ElementType; label: string; icon: string }[] = [
  { id: 'character', label: 'Character', icon: '👤' },
  { id: 'location', label: 'Location', icon: '🏔' },
  { id: 'prop', label: 'Prop', icon: '🎬' },
  { id: 'vehicle', label: 'Vehicle', icon: '🚗' },
];

interface ElementModalProps {
  element?: Element;
  onSave: (data: { name: string; type: ElementType; description: string; images: ElementImage[] }) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export function ElementModal({ element, onSave, onDelete, onClose }: ElementModalProps) {
  const [name, setName] = useState(element?.name ?? '');
  const [type, setType] = useState<ElementType>(element?.type ?? 'character');
  const [description, setDescription] = useState(element?.description ?? '');
  const [images, setImages] = useState<ElementImage[]>(element?.images ?? []);
  const [activeImageTab, setActiveImageTab] = useState<'upload' | 'generate'>('upload');

  const handleAddImages = useCallback((newImages: ElementImage[]) => {
    setImages((prev) => [...prev, ...newImages]);
  }, []);

  const handleRemoveImage = useCallback((imageId: string) => {
    setImages((prev) => prev.filter((img) => img.id !== imageId));
  }, []);

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({ name: name.trim(), type, description: description.trim(), images });
  };

  return (
    <div className="element-modal__backdrop" onClick={onClose}>
      <div className="element-modal" onClick={(e) => e.stopPropagation()}>
        <div className="element-modal__header">
          <h3 className="element-modal__title">{element ? 'Edit Element' : 'New Element'}</h3>
          <button className="element-modal__close" onClick={onClose} type="button">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="element-modal__body">
          <div className="element-modal__field">
            <label className="element-modal__label">Name</label>
            <input
              className="element-modal__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Detective Sarah"
            />
          </div>

          <div className="element-modal__field">
            <label className="element-modal__label">Type</label>
            <div className="element-modal__type-grid">
              {ELEMENT_TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`element-modal__type-btn ${type === t.id ? 'element-modal__type-btn--active' : ''}`}
                  onClick={() => setType(t.id)}
                >
                  <span>{t.icon}</span>
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="element-modal__field">
            <label className="element-modal__label">Description</label>
            <textarea
              className="element-modal__textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe this element in detail..."
              rows={3}
            />
          </div>

          <div className="element-modal__field">
            <label className="element-modal__label">Reference Images</label>

            <div className="element-modal__image-tabs">
              <button
                type="button"
                className={`element-modal__image-tab ${activeImageTab === 'upload' ? 'element-modal__image-tab--active' : ''}`}
                onClick={() => setActiveImageTab('upload')}
              >
                Upload
              </button>
              <button
                type="button"
                className={`element-modal__image-tab ${activeImageTab === 'generate' ? 'element-modal__image-tab--active' : ''}`}
                onClick={() => setActiveImageTab('generate')}
              >
                Generate
              </button>
            </div>

            {activeImageTab === 'upload' && (
              <ElementImageUpload onUpload={handleAddImages} />
            )}
            {activeImageTab === 'generate' && (
              <ElementGenerate
                elementType={type}
                description={description}
                onGenerated={handleAddImages}
                referenceImages={images}
              />
            )}

            {images.length > 0 && (
              <div className="element-modal__image-grid">
                {images.map((img) => (
                  <div key={img.id} className="element-modal__image-item">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt="" className="element-modal__image-thumb" />
                    <button
                      type="button"
                      className="element-modal__image-remove"
                      onClick={() => handleRemoveImage(img.id)}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="element-modal__footer">
          {element && onDelete && (
            <button type="button" className="element-modal__delete-btn" onClick={onDelete}>Delete</button>
          )}
          <div className="element-modal__footer-right">
            <button type="button" className="element-modal__cancel-btn" onClick={onClose}>Cancel</button>
            <button type="button" className="element-modal__save-btn" onClick={handleSave} disabled={!name.trim()}>
              {element ? 'Save' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
