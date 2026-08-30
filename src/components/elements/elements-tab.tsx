
import { useState, useCallback, useEffect, useMemo } from 'react';
import { useWorkspace } from '@/components/workspace/workspace-shell';
import { ElementCard } from './element-card';
import { ElementModal } from './element-modal';
import { ElementContextMenu } from './element-context-menu';
import { ElementDeleteConfirm } from './element-delete-confirm';
import { ElementFolderBar } from './element-folder-bar';
import { useElementSelection } from './use-element-selection';
import { deleteIdsForContext } from '@/lib/elements/selection';
import {
  defaultFolderForNewElement,
  filterElements,
  projectFolderId,
} from '@/lib/elements/library';
import type { Element, ElementFolderFilter, ElementType, ElementImage, ElementVariation } from '@/types/elements';

const FILTERS: { id: ElementType | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'character', label: 'Characters' },
  { id: 'location', label: 'Locations' },
  { id: 'prop', label: 'Props' },
  { id: 'vehicle', label: 'Vehicles' },
];

function uniqueFolderName(existing: string[], base = 'New folder'): string {
  const names = new Set(existing.map((n) => n.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  let i = 2;
  while (names.has(`${base} ${i}`.toLowerCase())) i += 1;
  return `${base} ${i}`;
}

export function ElementsTab() {
  const { state, dispatch, projectId } = useWorkspace();
  const [typeFilter, setTypeFilter] = useState<ElementType | 'all'>('all');
  const [folder, setFolder] = useState<ElementFolderFilter>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingElement, setEditingElement] = useState<Element | undefined>();
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(null);

  const currentProjectFolderId = projectFolderId(
    { version: 1, folders: state.elementFolders, elements: state.elements },
    projectId,
  );

  const filtered = useMemo(
    () => filterElements(state.elements, folder, typeFilter),
    [state.elements, folder, typeFilter],
  );
  const orderedIds = useMemo(() => filtered.map((el) => el.id), [filtered]);
  const blocked = modalOpen || pendingDeleteIds !== null;

  const {
    selected,
    marquee,
    contextMenu,
    gridRef,
    dragging,
    handleCardClick,
    handleCardContextMenu,
    handleGridContextMenu,
    handleGridPointerDown,
    closeContextMenu,
    clearSelection,
  } = useElementSelection(orderedIds, blocked);

  const handleAdd = useCallback(() => {
    setEditingElement(undefined);
    setModalOpen(true);
  }, []);

  const handleSave = useCallback((data: {
    name: string;
    type: ElementType;
    description: string;
    images: ElementImage[];
    variations: ElementVariation[];
    activeVariationId: string;
  }) => {
    if (editingElement) {
      dispatch({ type: 'UPDATE_ELEMENT', elementId: editingElement.id, updates: { ...data } });
    } else {
      const now = new Date().toISOString();
      dispatch({
        type: 'ADD_ELEMENT',
        element: {
          id: crypto.randomUUID(),
          ...data,
          folderId: defaultFolderForNewElement(folder, currentProjectFolderId),
          createdAt: now,
          updatedAt: now,
        },
      });
    }
    setModalOpen(false);
    setEditingElement(undefined);
  }, [editingElement, dispatch, folder, currentProjectFolderId]);

  const requestDelete = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    closeContextMenu();
    setPendingDeleteIds(ids);
  }, [closeContextMenu]);

  const confirmDelete = useCallback(() => {
    if (!pendingDeleteIds || pendingDeleteIds.length === 0) return;
    dispatch({ type: 'REMOVE_ELEMENTS', elementIds: pendingDeleteIds });
    if (editingElement && pendingDeleteIds.includes(editingElement.id)) {
      setModalOpen(false);
      setEditingElement(undefined);
    }
    setPendingDeleteIds(null);
    clearSelection();
  }, [pendingDeleteIds, dispatch, editingElement, clearSelection]);

  const handleClose = useCallback(() => {
    setModalOpen(false);
    setEditingElement(undefined);
  }, []);

  const pendingNames = useMemo(() => {
    if (!pendingDeleteIds) return [];
    const byId = new Map(state.elements.map((el) => [el.id, el.name]));
    return pendingDeleteIds.map((id) => byId.get(id) ?? 'Untitled');
  }, [pendingDeleteIds, state.elements]);

  const contextIds = contextMenu ? deleteIdsForContext(selected, contextMenu.id) : [];

  useEffect(() => {
    if (blocked) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.key === 'Escape') {
        closeContextMenu();
        clearSelection();
        return;
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && selected.size > 0) {
        e.preventDefault();
        requestDelete([...selected]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [blocked, selected, closeContextMenu, clearSelection, requestDelete]);

  const emptyHint = state.elements.length === 0
    ? 'Add your first element to get started'
    : folder !== 'all'
      ? 'This folder is empty'
      : 'No elements match this filter';

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
            className={`elements-tab__filter ${typeFilter === f.id ? 'elements-tab__filter--active' : ''}`}
            onClick={() => setTypeFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
        {selected.size > 0 && (
          <span className="elements-tab__selection-count">{selected.size} selected</span>
        )}
      </div>

      <ElementFolderBar
        folders={state.elementFolders}
        elements={state.elements}
        folder={folder}
        onSelect={setFolder}
        onCreate={() => {
          const id = crypto.randomUUID();
          dispatch({
            type: 'ADD_ELEMENT_FOLDER',
            folder: {
              id,
              name: uniqueFolderName(state.elementFolders.map((f) => f.name)),
              createdAt: new Date().toISOString(),
            },
          });
          setFolder(id);
        }}
        onRename={(folderId, name) => dispatch({ type: 'UPDATE_ELEMENT_FOLDER', folderId, updates: { name } })}
        onDelete={(folderId) => {
          dispatch({ type: 'REMOVE_ELEMENT_FOLDER', folderId });
          if (folder === folderId) setFolder('all');
        }}
      />

      {filtered.length === 0 ? (
        <div className="elements-tab__empty">
          <span className="elements-tab__empty-icon" aria-hidden="true">
            <svg width="44" height="44" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
              <path d="M8 16 24 7l16 9-16 9L8 16Z" />
              <path d="M8 16v17l16 9 16-9V16M24 25v17" />
            </svg>
          </span>
          <span className="elements-tab__empty-text">{emptyHint}</span>
          {state.elements.length === 0 && (
            <button className="elements-tab__add-btn" onClick={handleAdd} type="button">
              New Element
            </button>
          )}
        </div>
      ) : (
        <div
          ref={gridRef}
          className={`elements-tab__body${dragging ? ' elements-tab__body--selecting' : ''}`}
          onPointerDown={handleGridPointerDown}
          onContextMenu={handleGridContextMenu}
        >
          <div className="elements-tab__grid">
            {filtered.map((el) => (
              <ElementCard
                key={el.id}
                element={el}
                selected={selected.has(el.id)}
                onClick={(e) => {
                  const { shouldOpen } = handleCardClick(el.id, e);
                  if (shouldOpen) {
                    setEditingElement(el);
                    setModalOpen(true);
                  }
                }}
                onContextMenu={(e) => handleCardContextMenu(el.id, e)}
              />
            ))}
          </div>
          {marquee && (
            <div
              className="elements-tab__marquee"
              style={{ left: marquee.left, top: marquee.top, width: marquee.width, height: marquee.height }}
            />
          )}
        </div>
      )}

      {contextMenu && (
        <ElementContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          count={contextIds.length}
          folders={state.elementFolders}
          currentFolderId={contextMenu.id ? state.elements.find((el) => el.id === contextMenu.id)?.folderId : undefined}
          onMove={(folderId) => {
            dispatch({ type: 'MOVE_ELEMENTS', elementIds: contextIds, folderId });
            closeContextMenu();
            clearSelection();
          }}
          onDelete={() => requestDelete(contextIds)}
        />
      )}

      {modalOpen && (
        <ElementModal
          element={editingElement}
          onSave={handleSave}
          onDelete={editingElement ? () => requestDelete([editingElement.id]) : undefined}
          onClose={handleClose}
        />
      )}

      {pendingDeleteIds && (
        <ElementDeleteConfirm
          names={pendingNames}
          onConfirm={confirmDelete}
          onCancel={() => setPendingDeleteIds(null)}
        />
      )}
    </div>
  );
}
