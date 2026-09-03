import { useEffect, useRef } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { executeFromNode, type WorkflowDispatch } from '@/lib/workflows/execute';
import { createMcpHandlers } from '@/lib/mcp/handlers';
import type { McpAction, McpHost, McpHostState } from '@/lib/mcp/types';
import type { WorkflowNodeData } from '@/types/workflow';

interface McpBridgeApi {
  onInvoke?: (handler: (payload: { id: string; tool: string; args?: Record<string, unknown> }) => void) => () => void;
  respond?: (payload: { id: string; ok: boolean; result?: unknown; error?: string }) => void;
  ready?: (ready: boolean) => void;
}

/**
 * Answers MCP tool calls from the main process against the live workspace.
 *
 * The handlers are rebuilt from a ref on every call rather than captured, so a
 * tool always reads the state as it is now — a conversation can take minutes,
 * and the user keeps working during it.
 */
export function useMcpBridge(
  state: McpHostState,
  dispatch: (action: McpAction) => void,
  options: { projectName?: string } = {},
): void {
  const hostRef = useRef<McpHost | null>(null);

  const workflowDispatch = (): WorkflowDispatch => ({
    setNodeRunning: (nodeId, running) => dispatch({ type: 'SET_NODE_RUNNING', nodeId, running } as unknown as McpAction),
    setNodeResult: (nodeId, result) => dispatch({ type: 'SET_NODE_RESULT', nodeId, result } as unknown as McpAction),
    addGeneration: (nodeId, url) => dispatch({ type: 'ADD_GENERATION', nodeId, url } as unknown as McpAction),
    addAsset: (asset) => dispatch({ type: 'ADD_ASSET', asset: { ...asset, thumbnailUrl: asset.url } } as unknown as McpAction),
    getElements: () => hostRef.current?.getState().elements ?? [],
  });

  hostRef.current = {
    getState: () => state,
    dispatch,
    projectName: options.projectName,
    runNode: (nodeId: string, nodes: Node<WorkflowNodeData>[], edges: Edge[]) => {
      const adapter = workflowDispatch();
      void executeFromNode(nodeId, nodes, edges, adapter).catch((error: unknown) => {
        adapter.setNodeRunning(nodeId, false);
        adapter.setNodeResult(nodeId, {
          status: 'error',
          error: error instanceof Error ? error.message : 'Generation failed.',
        });
      });
    },
  };

  useEffect(() => {
    const api = (window as unknown as { electronAPI?: { mcpBridge?: McpBridgeApi } }).electronAPI?.mcpBridge;
    if (!api?.onInvoke || !api.respond) return undefined;
    api.ready?.(true);

    const stop = api.onInvoke(({ id, tool, args }) => {
      void (async () => {
        const host = hostRef.current;
        try {
          if (!host) throw new Error('CineGen is still starting up.');
          const handler = createMcpHandlers(host)[tool];
          if (!handler) throw new Error(`CineGen has no tool called "${tool}".`);
          api.respond?.({ id, ok: true, result: await handler(args ?? {}) });
        } catch (error) {
          api.respond?.({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      })();
    });

    return () => {
      api.ready?.(false);
      stop();
    };
  }, []);
}
