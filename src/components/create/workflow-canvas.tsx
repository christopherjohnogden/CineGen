

import { useCallback, useEffect, useState, useRef } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  SelectionMode,
  useReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  applyEdgeChanges,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { nodeTypes } from './nodes';
import { edgeTypes } from './edges/animated-edge';
import { NodePalette } from './node-palette';
import { NodeInspector } from './node-inspector';
// ToolbarStrip moved to sidebar — see create-tab.tsx
import { HelperLines, getHelperLines } from './helper-lines';
import { NODE_REGISTRY } from '@/lib/workflows/node-registry';
import { useWorkspace } from '@/components/workspace/workspace-shell';
import { generateId } from '@/lib/utils/ids';
import { executeFromNode } from '@/lib/workflows/execute';
import type { WorkflowNodeData } from '@/types/workflow';
import { getModelDefinition } from '@/lib/fal/models';
import { createContext, useContext } from 'react';

type RunNodeFn = (nodeId: string) => void;
const RunNodeContext = createContext<RunNodeFn>(() => {});
export function useRunNode() { return useContext(RunNodeContext); }

const VIEWPORT_STORAGE_KEY = 'cinegen_canvas_viewport';

function WorkflowCanvasInner() {
  const { state, dispatch } = useWorkspace();
  const { screenToFlowPosition, flowToScreenPosition, fitView } = useReactFlow();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [palettePos, setPalettePos] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [typeWarning, setTypeWarning] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const mouseRef = useRef({ x: 0, y: 0 });
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const nodesRef = useRef(state.nodes);
  nodesRef.current = state.nodes;
  const edgesRef = useRef(state.edges);
  edgesRef.current = state.edges;

  const [helperLines, setHelperLines] = useState<{ horizontal: number | null; vertical: number | null }>({
    horizontal: null,
    vertical: null,
  });

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      dispatch({
        type: 'SET_NODES',
        nodes: applyNodeChanges(changes, nodesRef.current) as Node<WorkflowNodeData>[],
      });
    },
    [dispatch],
  );

  const onNodeDrag = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const result = getHelperLines(node, nodesRef.current);
      setHelperLines({ horizontal: result.horizontal, vertical: result.vertical });

      if (result.snapX !== undefined || result.snapY !== undefined) {
        const snappedNode = {
          ...node,
          position: {
            x: result.snapX ?? node.position.x,
            y: result.snapY ?? node.position.y,
          },
        };
        dispatch({
          type: 'SET_NODES',
          nodes: nodesRef.current.map((n) => (n.id === node.id ? { ...n, position: snappedNode.position } : n)) as Node<WorkflowNodeData>[],
        });
      }
    },
    [dispatch],
  );

  const onNodeDragStop = useCallback(() => {
    setHelperLines({ horizontal: null, vertical: null });
  }, []);

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      dispatch({ type: 'SET_EDGES', edges: applyEdgeChanges(changes, edgesRef.current) });
    },
    [dispatch],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      const sourceNode = state.nodes.find((n) => n.id === connection.source);
      const targetNode = state.nodes.find((n) => n.id === connection.target);
      if (!sourceNode || !targetNode) return;

      const sourceNodeDef = NODE_REGISTRY[sourceNode.data.type];
      const targetNodeDef = NODE_REGISTRY[targetNode.data.type];
      if (!sourceNodeDef || !targetNodeDef) return;
      const sourcePort = sourceNodeDef.outputs.find((p) => p.id === connection.sourceHandle);
      let targetPort = targetNodeDef.inputs.find((p) => p.id === connection.targetHandle);

      // Resolve dynamic element-list handles (e.g. extra_images_0, extra_images_1)
      if (!targetPort && connection.targetHandle && /_\d+$/.test(connection.targetHandle)) {
        const baseId = connection.targetHandle.replace(/_\d+$/, '');
        const modelDef = getModelDefinition(targetNode.data.type);
        if (modelDef) {
          const field = modelDef.inputs.find((f) => f.id === baseId && f.fieldType === 'element-list');
          if (field) {
            targetPort = { id: connection.targetHandle, type: field.portType, label: field.label };
          }
        }
      }

      if (sourcePort && targetPort && sourcePort.type !== targetPort.type) {
        // Allow media port to connect to image/video/audio, but warn on mismatch
        const MEDIA_TYPES = ['image', 'video', 'audio'];
        if (sourcePort.type === 'media' && MEDIA_TYPES.includes(targetPort.type)) {
          const fileType = sourceNode.data.config?.fileType as string;
          if (fileType && fileType !== targetPort.type) {
            setTypeWarning(
              `This input expects ${targetPort.type}, but the uploaded file is ${fileType}. The connection may not work correctly.`,
            );
          }
        } else {
          return;
        }
      }

      const newEdge: Edge = {
        id: generateId(),
        source: connection.source!,
        target: connection.target!,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
        type: 'animated',
        data: { sourcePortType: sourcePort?.type ?? 'text' },
      };

      dispatch({ type: 'SET_EDGES', edges: [...state.edges, newEdge] });
    },
    [state.nodes, state.edges, dispatch],
  );

  const handlePaletteSelect = useCallback(
    (nodeType: string) => {
      const definition = NODE_REGISTRY[nodeType];
      if (!definition) return;
      const flowPosition = screenToFlowPosition({ x: palettePos.x, y: palettePos.y });

      const modelDef = getModelDefinition(nodeType);
      const newNode = {
        id: generateId(),
        type: nodeType,
        position: flowPosition,
        data: {
          type: nodeType,
          label: definition.label,
          config: { ...definition.defaultData },
          ...(modelDef ? { modelId: modelDef.id } : {}),
        } as WorkflowNodeData,
      };

      dispatch({ type: 'SET_NODES', nodes: [...state.nodes, newNode] });
      setPaletteOpen(false);
    },
    [screenToFlowPosition, palettePos, state.nodes, dispatch],
  );

  // --- Grouping logic ---
  const handleGroupSelected = useCallback(() => {
    const selected = state.nodes.filter((n) => n.selected && n.type !== 'group');
    if (selected.length < 2) return;

    const PADDING = 40;
    const HEADER = 32;

    // Calculate bounding box of selected nodes
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of selected) {
      const w = (node.measured?.width ?? node.width ?? 240);
      const h = (node.measured?.height ?? node.height ?? 100);
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + w);
      maxY = Math.max(maxY, node.position.y + h);
    }

    const groupId = generateId();
    const groupX = minX - PADDING;
    const groupY = minY - PADDING - HEADER;
    const groupW = maxX - minX + PADDING * 2;
    const groupH = maxY - minY + PADDING * 2 + HEADER;

    const groupNode: Node<WorkflowNodeData> = {
      id: groupId,
      type: 'group',
      position: { x: groupX, y: groupY },
      style: { width: groupW, height: groupH },
      data: {
        type: 'group',
        label: 'Group',
        config: {
          groupLabel: 'Group',
          color: '#d4a054',
          labelAlign: 'left',
          labelPosition: 'outside',
          labelSize: 16,
        },
      } as WorkflowNodeData,
    };

    // Re-position children relative to group and set parentId
    const updatedSelected = selected.map((n) => ({
      ...n,
      position: {
        x: n.position.x - groupX,
        y: n.position.y - groupY,
      },
      parentId: groupId,
      extent: 'parent' as const,
      selected: false,
    }));

    const otherNodes = state.nodes.filter((n) => !n.selected || n.type === 'group');
    dispatch({
      type: 'SET_NODES',
      nodes: [...otherNodes, groupNode, ...updatedSelected] as Node<WorkflowNodeData>[],
    });
    setContextMenu(null);
  }, [state.nodes, dispatch]);

  const handleUngroupSelected = useCallback(() => {
    const selectedGroups = state.nodes.filter((n) => n.selected && n.type === 'group');
    if (selectedGroups.length === 0) return;

    const groupIds = new Set(selectedGroups.map((g) => g.id));
    const updatedNodes = state.nodes
      .filter((n) => !groupIds.has(n.id))
      .map((n) => {
        if (n.parentId && groupIds.has(n.parentId)) {
          const parent = selectedGroups.find((g) => g.id === n.parentId);
          return {
            ...n,
            position: {
              x: n.position.x + (parent?.position.x ?? 0),
              y: n.position.y + (parent?.position.y ?? 0),
            },
            parentId: undefined,
            extent: undefined,
          };
        }
        return n;
      });

    dispatch({ type: 'SET_NODES', nodes: updatedNodes as Node<WorkflowNodeData>[] });
    setContextMenu(null);
  }, [state.nodes, dispatch]);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    function handleClick(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as HTMLElement)) {
        setContextMenu(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [contextMenu]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const selectedCount = state.nodes.filter((n) => n.selected).length;
      if (selectedCount < 1) return;
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY });
    },
    [state.nodes],
  );

  const addNodeToCenter = useCallback(
    (nodeType: string) => {
      const definition = NODE_REGISTRY[nodeType];
      if (!definition) return;
      const center = screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      const modelDef = getModelDefinition(nodeType);
      const newNode = {
        id: generateId(),
        type: nodeType,
        position: center,
        data: {
          type: nodeType,
          label: definition.label,
          config: { ...definition.defaultData },
          ...(modelDef ? { modelId: modelDef.id } : {}),
        } as WorkflowNodeData,
      };
      dispatch({ type: 'SET_NODES', nodes: [...state.nodes, newNode] });
    },
    [screenToFlowPosition, state.nodes, dispatch],
  );

  // Listen for sidebar-triggered node additions
  useEffect(() => {
    function handleAddNodeEvent(e: Event) {
      const nodeType = (e as CustomEvent<string>).detail;
      if (nodeType) addNodeToCenter(nodeType);
    }
    window.addEventListener('cinegen:add-node', handleAddNodeEvent);
    return () => window.removeEventListener('cinegen:add-node', handleAddNodeEvent);
  }, [addNodeToCenter]);

  // Listen for "send to spaces" node additions with custom data
  useEffect(() => {
    function handleAddNodeWithData(e: Event) {
      const detail = (e as CustomEvent<{ nodeType: string; config: Record<string, unknown> }>).detail;
      if (!detail?.nodeType) return;
      const definition = NODE_REGISTRY[detail.nodeType];
      if (!definition) return;
      const center = screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      const newNode = {
        id: generateId(),
        type: detail.nodeType,
        position: center,
        data: {
          type: detail.nodeType,
          label: (detail.config?.name as string) || definition.label,
          config: { ...definition.defaultData, ...detail.config },
        } as WorkflowNodeData,
      };
      dispatch({ type: 'SET_NODES', nodes: [...state.nodes, newNode] });
    }
    window.addEventListener('cinegen:add-node-with-data', handleAddNodeWithData);
    return () => window.removeEventListener('cinegen:add-node-with-data', handleAddNodeWithData);
  }, [screenToFlowPosition, state.nodes, dispatch]);

  // Listen for sidebar-triggered fitView on a node
  useEffect(() => {
    function handleFitNode(e: Event) {
      const nodeId = (e as CustomEvent<string>).detail;
      if (nodeId) fitView({ nodes: [{ id: nodeId }], duration: 300, padding: 0.5 });
    }
    window.addEventListener('cinegen:fit-node', handleFitNode);
    return () => window.removeEventListener('cinegen:fit-node', handleFitNode);
  }, [fitView]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (paletteOpen) {
          setPaletteOpen(false);
        } else {
          setPalettePos({ x: mouseRef.current.x, y: mouseRef.current.y });
          setPaletteOpen(true);
        }
      } else if (e.key === 'Escape' && paletteOpen) {
        setPaletteOpen(false);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [paletteOpen]);

  const workflowDispatch = useCallback(() => ({
    setNodeRunning: (nodeId: string, running: boolean) =>
      dispatch({ type: 'SET_NODE_RUNNING', nodeId, running }),
    setNodeResult: (nodeId: string, result: WorkflowNodeData['result']) =>
      dispatch({ type: 'SET_NODE_RESULT', nodeId, result }),
    addGeneration: (nodeId: string, url: string) =>
      dispatch({ type: 'ADD_GENERATION', nodeId, url }),
    addAsset: (asset: { id: string; name: string; type: 'image' | 'video'; url: string; createdAt: string }) =>
      dispatch({ type: 'ADD_ASSET', asset: { ...asset, thumbnailUrl: asset.url } }),
    getElements: () => state.elements,
  }), [dispatch, state.elements]);


  const handleRunNode: RunNodeFn = useCallback(async (nodeId: string) => {
    try {
      await executeFromNode(nodeId, state.nodes, state.edges, workflowDispatch());
    } catch (err) {
      console.error('Run failed:', err);
    }
  }, [state.nodes, state.edges, workflowDispatch]);

  const handleCanvasDrop = useCallback(
    (e: React.DragEvent) => {
      const shotData = e.dataTransfer.getData('application/cinegen-shot');
      if (!shotData) return;
      e.preventDefault();
      try {
        const { url, label } = JSON.parse(shotData) as { url: string; label: string };
        if (!url) return;
        const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        const definition = NODE_REGISTRY['filePicker'];
        if (!definition) return;
        const newNode = {
          id: generateId(),
          type: 'filePicker',
          position,
          data: {
            type: 'filePicker',
            label: `Shot: ${label}`,
            config: { ...definition.defaultData, fileUrl: url, fileType: 'image', fileName: `${label}.png` },
          } as WorkflowNodeData,
        };
        dispatch({ type: 'SET_NODES', nodes: [...state.nodes, newNode] });
      } catch {}
    },
    [screenToFlowPosition, state.nodes, dispatch],
  );

  const handleCanvasDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/cinegen-shot')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const edgesWithGeneratingState = state.edges.map((edge) => {
    const targetRunning = state.runningNodeIds.has(edge.target);
    return targetRunning
      ? { ...edge, data: { ...edge.data, isGenerating: true } }
      : edge;
  });

  const selectedNode = state.nodes.find((n) => n.selected);
  const showInspector = selectedNode && getModelDefinition(selectedNode.data.type);

  // Floating group button for multi-selection
  const selectedNonGroup = state.nodes.filter((n) => n.selected && n.type !== 'group');
  const showGroupBtn = selectedNonGroup.length >= 2;
  let groupBtnPos: { x: number; y: number } | null = null;
  if (showGroupBtn) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity;
    for (const node of selectedNonGroup) {
      const w = node.measured?.width ?? node.width ?? 240;
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + w);
    }
    const centerX = (minX + maxX) / 2;
    const screenPos = flowToScreenPosition({ x: centerX, y: minY });
    groupBtnPos = { x: screenPos.x, y: screenPos.y - 40 };
  }

  return (
    <RunNodeContext.Provider value={handleRunNode}>
    <div
      className="workflow-canvas-wrapper"
      onMouseMove={(e) => {
        mouseRef.current = { x: e.clientX, y: e.clientY };
      }}
      onDrop={handleCanvasDrop}
      onDragOver={handleCanvasDragOver}
      style={{ width: '100%', height: '100%', position: 'relative', outline: 'none' }}
    >
      <ReactFlow
        nodes={state.nodes}
        edges={edgesWithGeneratingState}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onNodeContextMenu={handleContextMenu}
        onSelectionContextMenu={handleContextMenu}
        onPaneClick={() => { paletteOpen && setPaletteOpen(false); setContextMenu(null); }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ type: 'animated' }}
        connectionRadius={25}
        minZoom={0.1}
        panOnDrag={[1, 2]}
        selectionOnDrag
        selectionMode={SelectionMode.Partial}
        onMoveStart={() => setIsPanning(true)}
        onMoveEnd={(_, viewport) => {
          setIsPanning(false);
          try { localStorage.setItem(VIEWPORT_STORAGE_KEY, JSON.stringify(viewport)); } catch {}
        }}
        defaultViewport={(() => {
          try {
            const saved = localStorage.getItem(VIEWPORT_STORAGE_KEY);
            if (saved) return JSON.parse(saved);
          } catch {}
          return { x: 0, y: 0, zoom: 1 };
        })()}
        fitView={false}
        proOptions={{ hideAttribution: true }}
        className={`cinegen-canvas${isPanning ? ' cinegen-canvas--panning' : ''}`}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} color="rgba(120, 115, 105, 0.35)" />
        <Controls position="bottom-left" />
      </ReactFlow>

      <HelperLines horizontal={helperLines.horizontal} vertical={helperLines.vertical} />

      {showGroupBtn && groupBtnPos && (
        <button
          type="button"
          className="workflow-group-btn"
          style={{ left: groupBtnPos.x, top: groupBtnPos.y }}
          onClick={handleGroupSelected}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
          </svg>
          Group
        </button>
      )}

      {showInspector && selectedNode && (
        <NodeInspector nodeId={selectedNode.id} data={selectedNode.data} />
      )}

      {paletteOpen && (
        <NodePalette
          position={palettePos}
          onSelect={handlePaletteSelect}
          onClose={() => setPaletteOpen(false)}
        />
      )}

      {typeWarning && (
        <div className="type-warning-overlay" onClick={() => setTypeWarning('')}>
          <div className="type-warning-modal" onClick={(e) => e.stopPropagation()}>
            <div className="type-warning-modal__icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <p className="type-warning-modal__text">{typeWarning}</p>
            <button
              type="button"
              className="type-warning-modal__btn"
              onClick={() => setTypeWarning('')}
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="workflow-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {state.nodes.filter((n) => n.selected && n.type !== 'group').length >= 2 && (
            <button type="button" className="workflow-context-menu__item" onClick={handleGroupSelected}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
              </svg>
              Group
            </button>
          )}
          {state.nodes.some((n) => n.selected && n.type === 'group') && (
            <button type="button" className="workflow-context-menu__item" onClick={handleUngroupSelected}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
              Ungroup
            </button>
          )}
          <button
            type="button"
            className="workflow-context-menu__item workflow-context-menu__item--danger"
            onClick={() => {
              const selectedIds = state.nodes.filter((n) => n.selected).map((n) => n.id);
              const remaining = state.nodes.filter((n) => !selectedIds.includes(n.id));
              const remainingEdges = state.edges.filter(
                (e) => !selectedIds.includes(e.source) && !selectedIds.includes(e.target),
              );
              dispatch({ type: 'SET_NODES', nodes: remaining as Node<WorkflowNodeData>[] });
              dispatch({ type: 'SET_EDGES', edges: remainingEdges });
              setContextMenu(null);
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            Delete
          </button>
        </div>
      )}
    </div>
    </RunNodeContext.Provider>
  );
}

export function WorkflowCanvas() {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner />
    </ReactFlowProvider>
  );
}
