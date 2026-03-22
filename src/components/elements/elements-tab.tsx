

import { useState, useCallback } from 'react';
import { useWorkspace } from '@/components/workspace/workspace-shell';
import { ElementCard } from './element-card';
import { ElementModal } from './element-modal';
import type { Element, ElementType, ElementImage } from '@/types/elements';

const FILTERS: { id: ElementType | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'character', label: 'Characters' },
  { id: 'location', label: 'Locations' },
  { id: 'prop', label: 'Props' },
  { id: 'vehicle', label: 'Vehicles' },
];

export function ElementsTab() {
  const { state, dispatch } = useWorkspace();
  const [filter, setFilter] = useState<ElementType | 'all'>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingElement, setEditingElement] = useState<Element | undefined>();

  const filtered = filter === 'all'
    ? state.elements
    : state.elements.filter((el) => el.type === filter);

  const handleAdd = useCallback(() => {
    setEditingElement(undefined);
    setModalOpen(true);
  }, []);

  const handleEdit = useCallback((element: Element) => {
    setEditingElement(element);
    setModalOpen(true);
  }, []);

  const handleSave = useCallback((data: { name: string; type: ElementType; description: string; images: ElementImage[] }) => {
    if (editingElement) {
      dispatch({
        type: 'UPDATE_ELEMENT',
        elementId: editingElement.id,
        updates: { ...data },
      });
    } else {
      const now = new Date().toISOString();
      dispatch({
        type: 'ADD_ELEMENT',
        element: {
          id: crypto.randomUUID(),
          ...data,
          createdAt: now,
          updatedAt: now,
        },
      });
    }
    setModalOpen(false);
    setEditingElement(undefined);
  }, [editingElement, dispatch]);

  const handleDelete = useCallback(() => {
    if (!editingElement) return;
    dispatch({ type: 'REMOVE_ELEMENT', elementId: editingElement.id });
    setModalOpen(false);
    setEditingElement(undefined);
  }, [editingElement, dispatch]);

  const handleClose = useCallback(() => {
    setModalOpen(false);
    setEditingElement(undefined);
  }, []);

  return (
    <div className="elements-tab">
      <div className="elements-tab__header">
        <h2 className="elements-tab__title">Elements</h2>
        <button className="elements-tab__add-btn" onClick={handleAdd} type="button">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Element
        </button>
      </div>

      <div className="elements-tab__filters">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`elements-tab__filter ${filter === f.id ? 'elements-tab__filter--active' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="elements-tab__empty">
          <span className="elements-tab__empty-icon">📦</span>
          <span className="elements-tab__empty-text">
            {state.elements.length === 0
              ? 'Add your first element to get started'
              : 'No elements match this filter'}
          </span>
          {state.elements.length === 0 && (
            <button className="elements-tab__add-btn" onClick={handleAdd} type="button">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New Element
            </button>
          )}
        </div>
      ) : (
        <div className="elements-tab__grid">
          {filtered.map((el) => (
            <ElementCard key={el.id} element={el} onClick={() => handleEdit(el)} />
          ))}
        </div>
      )}

      {modalOpen && (
        <ElementModal
          element={editingElement}
          onSave={handleSave}
          onDelete={editingElement ? handleDelete : undefined}
          onClose={handleClose}
        />
      )}
    </div>
  );
}
