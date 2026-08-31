import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import type { TopviewVideoTaskState, WorkflowNodeData } from '@/types/workflow';
import {
  runTopviewVideoTask,
  TopviewVideoTaskFailedError,
  TopviewVideoTaskPendingError,
} from '@/lib/topview/video-task';
import { executeWorkflow } from '@/lib/workflows/execute';

const task: TopviewVideoTaskState = {
  taskId: 'topview-task-1',
  taskType: 'text_to_video',
  boardId: 'board-1',
  model: 'seedance-2-5',
  durationSec: 8,
};

function queryResult(
  status: 'init' | 'running' | 'success' | 'fail',
  extras: { url?: string; error?: string; boardUrl?: string } = {},
) {
  return { ...task, status, ...extras };
}

function workflowNode(result?: WorkflowNodeData['result']): Node<WorkflowNodeData> {
  return {
    id: 'topview-video-1',
    position: { x: 0, y: 0 },
    data: {
      type: 'topview-video-auto',
      label: 'Topview Video',
      config: {
        prompt: 'A detective crosses a rain-lit street.',
        duration: 8,
        aspect_ratio: '16:9',
        resolution: '720p',
      },
      ...(result ? { result } : {}),
    },
  };
}

function workflowDispatch() {
  return {
    setNodeRunning: vi.fn(),
    setNodeResult: vi.fn(),
    addGeneration: vi.fn(),
    addAsset: vi.fn(),
    getElements: vi.fn(() => []),
  };
}

const originalElectronApi = (window as Window & { electronAPI?: unknown }).electronAPI;

function installTopviewBridge(submit: ReturnType<typeof vi.fn>, query: ReturnType<typeof vi.fn>): void {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: {
      topview: {
        submit,
        query,
        generate: vi.fn(),
      },
    },
  });
}

afterEach(() => {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: originalElectronApi,
  });
});

describe('Topview video task polling', () => {
  it('polls one submitted task until its video URL is available', async () => {
    const submit = vi.fn().mockResolvedValue(task);
    const query = vi.fn()
      .mockResolvedValueOnce(queryResult('running'))
      .mockResolvedValueOnce(queryResult('success', {
        url: 'https://cdn.example/topview-result.mp4',
        boardUrl: 'https://www.topview.ai/board/board-1',
      }));
    const onTask = vi.fn();
    const onStatus = vi.fn();

    await expect(runTopviewVideoTask({ submit, query }, { prompt: 'A detective.' }, {
      onTask,
      onStatus,
      sleep: vi.fn().mockResolvedValue(undefined),
      now: () => 0,
    })).resolves.toMatchObject({
      url: 'https://cdn.example/topview-result.mp4',
      taskId: task.taskId,
      boardUrl: 'https://www.topview.ai/board/board-1',
    });

    expect(submit).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(2);
    expect(onTask).toHaveBeenCalledWith(task);
    expect(onStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'success' }),
      expect.objectContaining({ boardUrl: 'https://www.topview.ai/board/board-1' }),
    );
  });

  it('distinguishes a still-running task from a terminal Topview failure', async () => {
    await expect(runTopviewVideoTask({
      submit: vi.fn().mockResolvedValue(task),
      query: vi.fn().mockResolvedValue(queryResult('running')),
    }, { prompt: 'A detective.' }, {
      pollTimeoutMs: 0,
      now: () => 0,
    })).rejects.toMatchObject({
      name: TopviewVideoTaskPendingError.name,
      task,
    });

    await expect(runTopviewVideoTask({
      submit: vi.fn().mockResolvedValue(task),
      query: vi.fn().mockResolvedValue(queryResult('fail', { error: 'Model rejected the request.' })),
    }, { prompt: 'A detective.' })).rejects.toBeInstanceOf(TopviewVideoTaskFailedError);
  });

  it('retains a paid task even when Topview does not return an optional board ID', async () => {
    const taskWithoutBoard = { ...task, boardId: undefined };
    const submit = vi.fn().mockResolvedValue(taskWithoutBoard);
    const query = vi.fn().mockResolvedValue({
      ...taskWithoutBoard,
      status: 'success',
      url: 'https://api.topview.ai/s/finished-video',
    });
    const onTask = vi.fn();

    await expect(runTopviewVideoTask({ submit, query }, { prompt: 'A detective.' }, {
      onTask,
    })).resolves.toMatchObject({
      url: 'https://api.topview.ai/s/finished-video',
      taskId: task.taskId,
    });

    expect(onTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: task.taskId }));
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ taskId: task.taskId }));
  });
});

describe('Spaces Topview video recovery', () => {
  it('persists the submitted task and publishes its eventual URL to the node', async () => {
    const submit = vi.fn().mockResolvedValue(task);
    const query = vi.fn().mockResolvedValue(queryResult('success', {
      url: 'https://cdn.example/spaces-result.mp4',
      boardUrl: 'https://www.topview.ai/board/board-1',
    }));
    installTopviewBridge(submit, query);
    const dispatch = workflowDispatch();

    await executeWorkflow([workflowNode()], [], dispatch);

    expect(dispatch.setNodeResult).toHaveBeenCalledWith('topview-video-1', expect.objectContaining({
      status: 'running',
      topviewTask: task,
    }));
    expect(dispatch.setNodeResult).toHaveBeenCalledWith('topview-video-1', {
      status: 'complete',
      url: 'https://cdn.example/spaces-result.mp4',
    });
    expect(dispatch.addGeneration).toHaveBeenCalledWith(
      'topview-video-1',
      'https://cdn.example/spaces-result.mp4',
    );
  });

  it('resumes a persisted task after a polling error without submitting again', async () => {
    const submit = vi.fn().mockResolvedValue(task);
    const query = vi.fn().mockRejectedValueOnce(new Error('Topview query timed out.'));
    installTopviewBridge(submit, query);
    const firstDispatch = workflowDispatch();

    await executeWorkflow([workflowNode()], [], firstDispatch);

    const failedResult = firstDispatch.setNodeResult.mock.calls.at(-1)?.[1] as WorkflowNodeData['result'];
    expect(failedResult).toMatchObject({
      status: 'error',
      topviewTask: task,
    });

    query.mockResolvedValueOnce(queryResult('success', {
      url: 'https://cdn.example/recovered.mp4',
    }));
    const resumedDispatch = workflowDispatch();
    await executeWorkflow([workflowNode(failedResult)], [], resumedDispatch);

    expect(submit).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenLastCalledWith(task);
    expect(resumedDispatch.setNodeResult).toHaveBeenCalledWith('topview-video-1', {
      status: 'complete',
      url: 'https://cdn.example/recovered.mp4',
    });
  });
});
