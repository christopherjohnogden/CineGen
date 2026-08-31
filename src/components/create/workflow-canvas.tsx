

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
  type FinalConnectionState,
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
import { getMediaTypeForFile, isMediaDragEvent, resolveMediaFileUrl } from '@/lib/utils/media-file';
import { executeFromNode } from '@/lib/workflows/execute';
import type { WorkflowNodeData } from '@/types/workflow';
import { getModelDefinition } from '@/lib/fal/models';
import { reconcilePromptMentionConnections } from '@/lib/llm/prompt-elements';
import { areWorkflowPortsCompatible } from '@/lib/workflows/port-compatibility';
import { createContext, useContext } from 'react';
import type { PortType } from '@/types/workflow';

type RunNodeFn = (nodeId: string) => void;
const RunNodeContext = createContext<RunNodeFn>(() => {});
export function useRunNode() { return useContext(RunNodeContext); }

const VIEWPORT_STORAGE_KEY = 'cinegen_canvas_viewport';

interface PendingPaletteConnection {
  sourceNodeId: string;
  sourceHandleId: string | null;
  sourcePortType: PortType;
}

function WorkflowCanvasInner() {
  const { state, dispatch } = useWorkspace();
  const { screenToFlowPosition, flowToScreenPosition, fitView } = useReactFlow();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [palettePos, setPalettePos] = useState({ x: 0, y: 0 });
  const [pendingPaletteConnection, setPendingPaletteConnection] = useState<PendingPaletteConnection | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [typeWarning, setTypeWarning] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isFileDragging, setIsFileDragging] = useState(false);
  const [isMobileCanvas, setIsMobileCanvas] = useState(false);
  const [mobileMultiSelect, setMobileMultiSelect] = useState(false);
  const [mobileGuideOpen, setMobileGuideOpen] = useState(false);
  const [confirmMobileDelete, setConfirmMobileDelete] = useState(false);
  const mouseRef = useRef({ x: 0, y: 0 });
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);

  const nodesRef = useRef(state.nodes);
  nodesRef.current = state.nodes;
  const edgesRef = useRef(state.edges);
  edgesRef.current = state.edges;

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const updateMobileCanvas = () => setIsMobileCanvas(media.matches);
    updateMobileCanvas();
    media.addEventListener('change', updateMobileCanvas);
    return () => media.removeEventListener('change', updateMobileCanvas);
  }, []);

  useEffect(() => {
    if (!isMobileCanvas) return;
    try {
      if (localStorage.getItem('cinegen_mobile_canvas_guide_seen') !== '1') {
        setMobileGuideOpen(true);
      }
    } catch {
      setMobileGuideOpen(true);
    }
  }, [isMobileCanvas]);

  const [helperLines, setHelperLines] = useState<{ horizontal: number | null; vertical: number | null }>({
    horizontal: null,
    vertical: null,
  });

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const effectiveChanges = isMobileCanvas && mobileMultiSelect
        ? changes.filter((change) => change.type !== 'select' || change.selected)
        : changes;
      dispatch({
        type: 'SET_NODES',
        nodes: applyNodeChanges(effectiveChanges, nodesRef.current) as Node<WorkflowNodeData>[],
      });
    },
    [dispatch, isMobileCanvas, mobileMultiSelect],
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
      const effectiveChanges = isMobileCanvas && mobileMultiSelect
        ? changes.filter((change) => change.type !== 'select' || change.selected)
        : changes;
      dispatch({ type: 'SET_EDGES', edges: applyEdgeChanges(effectiveChanges, edgesRef.current) });
    },
    [dispatch, isMobileCanvas, mobileMultiSelect],
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
        if (!areWorkflowPortsCompatible(sourcePort.type, targetPort.type)) {
          return;
        }
        if (sourcePort.type === 'media' && ['image', 'video', 'audio'].includes(targetPort.type)) {
          const fileType = sourceNode.data.config?.fileType as string;
          if (fileType && fileType !== targetPort.type) {
            setTypeWarning(
              `This input expects ${targetPort.type}, but the uploaded file is ${fileType}. The connection may not work correctly.`,
            );
          }
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

      const nextEdges = [...state.edges, newEdge];
      if (sourceNode.data.type === 'prompt' || sourceNode.data.type === 'multiPrompt' || sourceNode.data.type === 'shotPrompt') {
        const reconciled = reconcilePromptMentionConnections({
          nodes: state.nodes,
          edges: nextEdges,
          promptNodeId: sourceNode.id,
        });
        if (reconciled.nodes !== state.nodes) {
          dispatch({ type: 'SET_NODES', nodes: reconciled.nodes });
        }
        dispatch({ type: 'SET_EDGES', edges: reconciled.edges });
      } else {
        dispatch({ type: 'SET_EDGES', edges: nextEdges });
      }
    },
    [state.nodes, state.edges, dispatch],
  );

  const handlePaletteSelect = useCallback(
    (nodeType: string) => {
      const definition = NODE_REGISTRY[nodeType];
      if (!definition) return;
      const targetInput = pendingPaletteConnection
        ? definition.inputs.find((input) => areWorkflowPortsCompatible(pendingPaletteConnection.sourcePortType, input.type))
        : null;
      if (pendingPaletteConnection && !targetInput) return;
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

      const nextNodes = [...state.nodes, newNode];
      if (pendingPaletteConnection && targetInput) {
        const newEdge: Edge = {
          id: generateId(),
          source: pendingPaletteConnection.sourceNodeId,
          target: newNode.id,
          sourceHandle: pendingPaletteConnection.sourceHandleId,
          targetHandle: targetInput.id,
          type: 'animated',
          data: { sourcePortType: pendingPaletteConnection.sourcePortType },
        };
        const nextEdges = [...state.edges, newEdge];
        const sourceNode = state.nodes.find((node) => node.id === pendingPaletteConnection.sourceNodeId);
        if (sourceNode?.data.type === 'prompt' || sourceNode?.data.type === 'multiPrompt' || sourceNode?.data.type === 'shotPrompt') {
          const reconciled = reconcilePromptMentionConnections({
            nodes: nextNodes,
            edges: nextEdges,
            promptNodeId: sourceNode.id,
          });
          dispatch({ type: 'SET_NODES', nodes: reconciled.nodes });
          dispatch({ type: 'SET_EDGES', edges: reconciled.edges });
        } else {
          dispatch({ type: 'SET_NODES', nodes: nextNodes });
          dispatch({ type: 'SET_EDGES', edges: nextEdges });
        }
      } else {
        dispatch({ type: 'SET_NODES', nodes: nextNodes });
      }
      setPaletteOpen(false);
      setPendingPaletteConnection(null);
    },
    [screenToFlowPosition, palettePos, pendingPaletteConnection, state.nodes, state.edges, dispatch],
  );

  const handleConnectEnd = useCallback((event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
    if (connectionState.isValid || connectionState.toNode || connectionState.fromHandle?.type !== 'source') return;
    const sourceNode = state.nodes.find((node) => node.id === connectionState.fromHandle?.nodeId);
    const sourceDefinition = sourceNode ? NODE_REGISTRY[sourceNode.data.type] : null;
    const sourcePort = sourceDefinition?.outputs.find((port) => port.id === connectionState.fromHandle?.id)
      ?? sourceDefinition?.outputs[0];
    if (!sourceNode || !sourcePort) return;

    const pointer = 'changedTouches' in event
      ? event.changedTouches[0]
      : event;
    if (!pointer) return;

    setContextMenu(null);
    setPendingPaletteConnection({
      sourceNodeId: sourceNode.id,
      sourceHandleId: connectionState.fromHandle.id ?? sourcePort.id,
      sourcePortType: sourcePort.type,
    });
    setPalettePos({ x: pointer.clientX, y: pointer.clientY });
    setPaletteOpen(true);
  }, [state.nodes]);

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

  const clearSelection = useCallback(() => {
    dispatch({
      type: 'SET_NODES',
      nodes: state.nodes.map((node) => (node.selected ? { ...node, selected: false } : node)) as Node<WorkflowNodeData>[],
    });
    dispatch({
      type: 'SET_EDGES',
      edges: state.edges.map((edge) => (edge.selected ? { ...edge, selected: false } : edge)),
    });
    setMobileMultiSelect(false);
    setConfirmMobileDelete(false);
    setContextMenu(null);
  }, [state.nodes, state.edges, dispatch]);

  const deleteSelection = useCallback(() => {
    const selectedNodeIds = new Set(state.nodes.filter((node) => node.selected).map((node) => node.id));
    const remainingNodes = state.nodes.filter((node) => !selectedNodeIds.has(node.id));
    const remainingEdges = state.edges.filter(
      (edge) => !edge.selected && !selectedNodeIds.has(edge.source) && !selectedNodeIds.has(edge.target),
    );
    dispatch({ type: 'SET_NODES', nodes: remainingNodes as Node<WorkflowNodeData>[] });
    dispatch({ type: 'SET_EDGES', edges: remainingEdges });
    setMobileMultiSelect(false);
    setConfirmMobileDelete(false);
    setContextMenu(null);
  }, [state.nodes, state.edges, dispatch]);

  const closeMobileGuide = useCallback(() => {
    setMobileGuideOpen(false);
    try { localStorage.setItem('cinegen_mobile_canvas_guide_seen', '1'); } catch {}
  }, []);

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
    longPressStartRef.current = null;
  }, []);

  const handleMobilePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!isMobileCanvas || event.pointerType === 'mouse') return;
    const target = event.target as HTMLElement;
    if (target.closest('button, input, textarea, select, a, [role="button"]')) return;
    const nodeElement = target.closest<HTMLElement>('.react-flow__node');
    const nodeId = nodeElement?.dataset.id;
    if (!nodeId) return;

    cancelLongPress();
    const point = { x: event.clientX, y: event.clientY };
    longPressStartRef.current = point;
    longPressTimerRef.current = setTimeout(() => {
      const nodeIsSelected = nodesRef.current.some((node) => node.id === nodeId && node.selected);
      if (!nodeIsSelected) {
        dispatch({
          type: 'SET_NODES',
          nodes: nodesRef.current.map((node) => ({ ...node, selected: node.id === nodeId })) as Node<WorkflowNodeData>[],
        });
      }
      setContextMenu({ x: point.x, y: point.y });
      longPressTimerRef.current = null;
    }, 520);
  }, [isMobileCanvas, cancelLongPress, dispatch]);

  const handleMobilePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const start = longPressStartRef.current;
    if (!start) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 9) cancelLongPress();
  }, [cancelLongPress]);

  useEffect(() => cancelLongPress, [cancelLongPress]);

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
          setPendingPaletteConnection(null);
        } else {
          setPalettePos({ x: mouseRef.current.x, y: mouseRef.current.y });
          setPendingPaletteConnection(null);
          setPaletteOpen(true);
        }
      } else if (e.key === 'Escape' && paletteOpen) {
        setPaletteOpen(false);
        setPendingPaletteConnection(null);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [paletteOpen]);

  useEffect(() => {
    function handleOpenNodePalette() {
      const rect = canvasWrapperRef.current?.getBoundingClientRect();
      const position = rect
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      setContextMenu(null);
      setPendingPaletteConnection(null);
      setPalettePos(position);
      setPaletteOpen(true);
    }
    window.addEventListener('cinegen:open-node-palette', handleOpenNodePalette);
    return () => window.removeEventListener('cinegen:open-node-palette', handleOpenNodePalette);
  }, []);

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

  const createFilePickerNode = useCallback(
    (
      position: { x: number; y: number },
      config: { fileUrl: string; fileType: 'image' | 'video' | 'audio'; fileName: string; label?: string },
    ) => {
      const definition = NODE_REGISTRY['filePicker'];
      if (!definition) return null;

      return {
        id: generateId(),
        type: 'filePicker',
        position,
        data: {
          type: 'filePicker',
          label: config.label ?? config.fileName,
          config: { ...definition.defaultData, fileUrl: config.fileUrl, fileType: config.fileType, fileName: config.fileName },
        } as WorkflowNodeData,
      };
    },
    [],
  );

  const handleCanvasDrop = useCallback(
    async (e: React.DragEvent) => {
      if (!isMediaDragEvent(e)) return;
      e.preventDefault();
      setIsFileDragging(false);

      const shotData = e.dataTransfer.getData('application/cinegen-shot');
      if (shotData) {
        try {
          const { url, label } = JSON.parse(shotData) as { url: string; label: string };
          if (!url) return;
          const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
          const newNode = createFilePickerNode(position, {
            fileUrl: url,
            fileType: 'image',
            fileName: `${label}.png`,
            label: `Shot: ${label}`,
          });
          if (newNode) {
            dispatch({ type: 'SET_NODES', nodes: [...state.nodes, newNode] });
          }
        } catch {}
        return;
      }

      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;

      const basePosition = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const newNodes: Node<WorkflowNodeData>[] = [];
      let failedCount = 0;

      await Promise.all(
        files.map(async (file, index) => {
          const mediaType = getMediaTypeForFile(file);
          if (!mediaType) {
            failedCount += 1;
            return;
          }

          try {
            const url = await resolveMediaFileUrl(file);
            const node = createFilePickerNode(
              { x: basePosition.x + index * 32, y: basePosition.y + index * 32 },
              { fileUrl: url, fileType: mediaType, fileName: file.name },
            );
            if (node) newNodes.push(node);
          } catch (err) {
            failedCount += 1;
            console.error('Failed to add dropped file:', file.name, err);
          }
        }),
      );

      if (newNodes.length > 0) {
        dispatch({ type: 'SET_NODES', nodes: [...state.nodes, ...newNodes] });
      } else if (failedCount > 0) {
        setTypeWarning(
          'Could not add dropped file(s). Local files should work without upload; cloud upload failed or file type is unsupported.',
        );
      }
    },
    [screenToFlowPosition, state.nodes, dispatch, createFilePickerNode],
  );

  const handleCanvasDragOver = useCallback((e: React.DragEvent) => {
    if (!isMediaDragEvent(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setIsFileDragging(true);
  }, []);

  const handleCanvasDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) {
      setIsFileDragging(false);
    }
  }, []);

  const edgesWithGeneratingState = state.edges.map((edge) => {
    const targetRunning = state.runningNodeIds.has(edge.target);
    return targetRunning
      ? { ...edge, data: { ...edge.data, isGenerating: true } }
      : edge;
  });

  const selectedNodes = state.nodes.filter((node) => node.selected);
  const selectedEdges = state.edges.filter((edge) => edge.selected);
  const selectedCount = selectedNodes.length + selectedEdges.length;
  const selectedSignature = `${selectedNodes.map((node) => node.id).join(',')}|${selectedEdges.map((edge) => edge.id).join(',')}`;
  const selectedNode = selectedNodes[0];
  const showInspector = selectedNode && getModelDefinition(selectedNode.data.type);

  useEffect(() => {
    setConfirmMobileDelete(false);
  }, [selectedSignature]);

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
      ref={canvasWrapperRef}
      className={`workflow-canvas-wrapper${isFileDragging ? ' workflow-canvas-wrapper--file-drag' : ''}${isMobileCanvas ? ' workflow-canvas-wrapper--mobile' : ''}${selectedCount > 0 ? ' workflow-canvas-wrapper--has-selection' : ''}`}
      onMouseMove={(e) => {
        mouseRef.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerDownCapture={handleMobilePointerDown}
      onPointerMoveCapture={handleMobilePointerMove}
      onPointerUpCapture={cancelLongPress}
      onPointerCancelCapture={cancelLongPress}
      onDrop={handleCanvasDrop}
      onDragOver={handleCanvasDragOver}
      onDragLeave={handleCanvasDragLeave}
      style={{ width: '100%', height: '100%', position: 'relative', outline: 'none' }}
    >
      <ReactFlow
        nodes={state.nodes}
        edges={edgesWithGeneratingState}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onConnectEnd={handleConnectEnd}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onNodeContextMenu={handleContextMenu}
        onSelectionContextMenu={handleContextMenu}
        onPaneClick={() => {
          if (paletteOpen) {
            setPaletteOpen(false);
            setPendingPaletteConnection(null);
          }
          setContextMenu(null);
          setConfirmMobileDelete(false);
        }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ type: 'animated' }}
        connectionRadius={isMobileCanvas ? 36 : 25}
        minZoom={0.1}
        panOnDrag={isMobileCanvas ? true : [1, 2]}
        selectionOnDrag={!isMobileCanvas}
        selectionMode={SelectionMode.Partial}
        zoomOnPinch
        zoomOnDoubleClick={!isMobileCanvas}
        nodeClickDistance={isMobileCanvas ? 8 : 0}
        paneClickDistance={isMobileCanvas ? 8 : 0}
        deleteKeyCode={['Backspace', 'Delete']}
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

      {isMobileCanvas && (
        <button
          type="button"
          className={`canvas-touch-help-btn${mobileGuideOpen ? ' is-active' : ''}`}
          aria-label="Show canvas finger gestures"
          aria-expanded={mobileGuideOpen}
          onClick={() => {
            if (mobileGuideOpen) closeMobileGuide();
            else setMobileGuideOpen(true);
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 11V5a2 2 0 0 1 4 0v5" />
            <path d="M13 10V7a2 2 0 0 1 4 0v4" />
            <path d="M17 11V9a2 2 0 0 1 4 0v5c0 5-3 8-8 8h-1c-3 0-5-1-7-4l-2-3a2 2 0 0 1 3-2l3 2" />
          </svg>
          Gestures
        </button>
      )}

      {isMobileCanvas && mobileGuideOpen && (
        <section className="canvas-touch-guide" aria-label="Canvas finger gestures">
          <div className="canvas-touch-guide__header">
            <div>
              <span>Touch guide</span>
              <small>Move around the canvas without a mouse.</small>
            </div>
            <button type="button" aria-label="Close touch guide" onClick={closeMobileGuide}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="canvas-touch-guide__grid">
            <span><strong>Tap</strong><small>Select an item</small></span>
            <span><strong>Drag item</strong><small>Move it</small></span>
            <span><strong>Drag canvas</strong><small>Pan around</small></span>
            <span><strong>Pinch</strong><small>Zoom in or out</small></span>
            <span><strong>Drag a dot</strong><small>Connect nodes</small></span>
            <span><strong>Press and hold</strong><small>More item actions</small></span>
            <span><strong>Delete</strong><small>Use the selection bar</small></span>
            <span><strong>Select more</strong><small>Keep several selected</small></span>
          </div>
        </section>
      )}

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

      {isMobileCanvas && selectedCount > 0 && (
        <div className="canvas-touch-actions" role="toolbar" aria-label="Selected canvas item actions">
          <div className="canvas-touch-actions__selection" aria-live="polite">
            <strong>{selectedCount}</strong>
            <span>selected</span>
          </div>
          <button
            type="button"
            className={mobileMultiSelect ? 'is-active' : ''}
            aria-pressed={mobileMultiSelect}
            onClick={() => {
              setMobileMultiSelect((active) => !active);
              setConfirmMobileDelete(false);
            }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <path d="M14 6h7M17.5 2.5v7" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            Add
          </button>
          {selectedNonGroup.length >= 2 && (
            <button type="button" onClick={handleGroupSelected}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
              </svg>
              Group
            </button>
          )}
          {selectedNodes.some((node) => node.type === 'group') && (
            <button type="button" onClick={handleUngroupSelected}>Ungroup</button>
          )}
          <button
            type="button"
            className={`canvas-touch-actions__delete${confirmMobileDelete ? ' is-confirming' : ''}`}
            onClick={() => {
              if (confirmMobileDelete) deleteSelection();
              else setConfirmMobileDelete(true);
            }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6" />
            </svg>
            {confirmMobileDelete ? `Delete ${selectedCount}` : 'Delete'}
          </button>
          <button type="button" className="canvas-touch-actions__close" aria-label="Clear selection" onClick={clearSelection}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
      )}

      {paletteOpen && (
        <NodePalette
          position={palettePos}
          onSelect={handlePaletteSelect}
          onClose={() => {
            setPaletteOpen(false);
            setPendingPaletteConnection(null);
          }}
          sourcePortType={pendingPaletteConnection?.sourcePortType}
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
            onClick={deleteSelection}
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
