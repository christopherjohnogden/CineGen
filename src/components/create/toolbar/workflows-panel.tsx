
import { useState, useCallback, useRef, useEffect } from 'react';
import { useWorkspace } from '@/components/workspace/workspace-shell';
import { generateId, timestamp } from '@/lib/utils/ids';
import type { Node, Edge } from '@xyflow/react';
import type { WorkflowNodeData } from '@/types/workflow';

/* -----------------------------------------------------------------------
   Workflow template persistence (localStorage)
   ----------------------------------------------------------------------- */

const STORAGE_KEY = 'cinegen_workflow_templates';

interface WorkflowTemplate {
  id: string;
  name: string;
  createdAt: string;
  nodeCount: number;
  edgeCount: number;
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
}

function loadTemplates(): WorkflowTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveTemplates(templates: WorkflowTemplate[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
}

/* -----------------------------------------------------------------------
   Component
   ----------------------------------------------------------------------- */

export function WorkflowsPanel() {
  const { state, dispatch } = useWorkspace();
  const [templates, setTemplates] = useState<WorkflowTemplate[]>(loadTemplates);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [renamingId]);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [ctxMenu]);

  const handleSaveCurrent = useCallback(() => {
    if (state.nodes.length === 0) return;

    // Rebase node positions so the template starts near origin
    const minX = Math.min(...state.nodes.map((n) => n.position.x));
    const minY = Math.min(...state.nodes.map((n) => n.position.y));
    const rebasedNodes = state.nodes.map((n) => ({
      ...n,
      id: n.id, // keep original IDs for edge references
      position: { x: n.position.x - minX, y: n.position.y - minY },
      selected: false,
    }));

    const template: WorkflowTemplate = {
      id: generateId(),
      name: `Workflow ${templates.length + 1}`,
      createdAt: timestamp(),
      nodeCount: state.nodes.length,
      edgeCount: state.edges.length,
      nodes: rebasedNodes,
      edges: state.edges,
    };

    const next = [template, ...templates];
    setTemplates(next);
    saveTemplates(next);
    setRenamingId(template.id);
    setRenameValue(template.name);
  }, [state.nodes, state.edges, templates]);

  const handleLoad = useCallback((template: WorkflowTemplate) => {
    // Generate fresh IDs so loaded templates don't collide
    const idMap = new Map<string, string>();
    template.nodes.forEach((n) => {
      idMap.set(n.id, generateId());
    });

    const newNodes: Node<WorkflowNodeData>[] = template.nodes.map((n) => ({
      ...n,
      id: idMap.get(n.id) ?? generateId(),
      selected: false,
    }));

    const newEdges: Edge[] = template.edges.map((e) => ({
      ...e,
      id: generateId(),
      source: idMap.get(e.source) ?? e.source,
      target: idMap.get(e.target) ?? e.target,
    }));

    // Create a new space with the template
    dispatch({
      type: 'ADD_SPACE',
      space: {
        id: generateId(),
        name: template.name,
        createdAt: timestamp(),
        nodes: newNodes,
        edges: newEdges,
      },
    });
  }, [dispatch]);

  const handleDelete = useCallback((id: string) => {
    const next = templates.filter((t) => t.id !== id);
    setTemplates(next);
    saveTemplates(next);
  }, [templates]);

  const commitRename = useCallback(() => {
    if (!renamingId) return;
    const trimmed = renameValue.trim();
    if (trimmed) {
      const next = templates.map((t) =>
        t.id === renamingId ? { ...t, name: trimmed } : t,
      );
      setTemplates(next);
      saveTemplates(next);
    }
    setRenamingId(null);
  }, [renamingId, renameValue, templates]);

  return (
    <div className="toolbar-panel">
      <div className="toolbar-panel__list">
        {/* Save current button */}
        <button
          className="wf-panel__save-btn"
          onClick={handleSaveCurrent}
          disabled={state.nodes.length === 0}
          title={state.nodes.length === 0 ? 'Add nodes to the canvas first' : 'Save current space as a workflow template'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Save Current as Template
        </button>

        {templates.length === 0 && (
          <div className="toolbar-panel__empty">
            No saved workflows yet. Build a node setup and save it as a reusable template.
          </div>
        )}

        {templates.map((template) => {
          const isRenaming = renamingId === template.id;
          return (
            <div
              key={template.id}
              className="wf-panel__item"
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setCtxMenu({ x: e.clientX, y: e.clientY, id: template.id });
              }}
            >
              <div className="wf-panel__item-main" onClick={() => handleLoad(template)}>
                <svg className="wf-panel__item-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="16 18 22 12 16 6" />
                  <polyline points="8 6 2 12 8 18" />
                </svg>
                {isRenaming ? (
                  <input
                    ref={renameRef}
                    className="wf-panel__rename"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="wf-panel__item-name">{template.name}</span>
                )}
              </div>
              <span className="wf-panel__item-meta">
                {template.nodeCount} node{template.nodeCount !== 1 ? 's' : ''}
              </span>
            </div>
          );
        })}
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div
          className="cs-ctx"
          style={{ left: ctxMenu.x, top: ctxMenu.y, position: 'fixed' }}
          onClick={(e) => e.stopPropagation()}
        >
          <button className="cs-ctx__item" onClick={() => {
            const t = templates.find((t) => t.id === ctxMenu.id);
            if (t) handleLoad(t);
            setCtxMenu(null);
          }}>Load into New Space</button>
          <button className="cs-ctx__item" onClick={() => {
            const t = templates.find((t) => t.id === ctxMenu.id);
            if (t) { setRenamingId(t.id); setRenameValue(t.name); }
            setCtxMenu(null);
          }}>Rename</button>
          <div className="cs-ctx__divider" />
          <button className="cs-ctx__item cs-ctx__item--danger" onClick={() => {
            handleDelete(ctxMenu.id);
            setCtxMenu(null);
          }}>Delete</button>
        </div>
      )}
    </div>
  );
}
