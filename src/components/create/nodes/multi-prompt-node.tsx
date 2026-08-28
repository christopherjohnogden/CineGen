

import { memo, useCallback } from 'react';
import { type NodeProps, useReactFlow } from '@xyflow/react';
import { BaseNode } from './base-node';
import { MentionTextarea } from './mention-textarea';
import { useWorkspace } from '@/components/workspace/workspace-shell';
import type { WorkflowNodeData } from '@/types/workflow';

interface MultiPromptShot {
  prompt: string;
  duration: number;
}

type MultiPromptNodeProps = NodeProps & { data: WorkflowNodeData };

const DURATION_OPTIONS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

function MultiPromptNodeInner({ id, data, selected }: MultiPromptNodeProps) {
  const { updateNodeData } = useReactFlow();
  const { state, dispatch } = useWorkspace();
  const shots: MultiPromptShot[] = (data.config?.shots as MultiPromptShot[]) ?? [{ prompt: '', duration: 5 }];
  const totalDuration = shots.reduce((total, shot) => total + shot.duration, 0);

  const updateShots = useCallback(
    (newShots: MultiPromptShot[]) => {
      updateNodeData(id, { config: { ...data.config, shots: newShots } });
    },
    [id, data.config, updateNodeData],
  );

  const handlePromptChange = useCallback(
    (index: number, value: string) => {
      const newShots = shots.map((s, i) => (i === index ? { ...s, prompt: value } : s));
      updateShots(newShots);
    },
    [shots, updateShots],
  );

  const handleMentionInsert = useCallback(
    (index: number, element: (typeof state.elements)[number], value: string) => {
      const newShots = shots.map((shot, shotIndex) => (
        shotIndex === index ? { ...shot, prompt: value } : shot
      ));
      dispatch({
        type: 'APPLY_ELEMENT_MENTION',
        nodeId: id,
        elementId: element.id,
        config: { shots: newShots },
      });
    },
    [dispatch, id, shots],
  );

  const handleDurationChange = useCallback(
    (index: number, value: number) => {
      const newShots = shots.map((s, i) => (i === index ? { ...s, duration: value } : s));
      updateShots(newShots);
    },
    [shots, updateShots],
  );

  const addShot = useCallback(() => {
    updateShots([...shots, { prompt: '', duration: 5 }]);
  }, [shots, updateShots]);

  const removeShot = useCallback(
    (index: number) => {
      if (shots.length <= 1) return;
      updateShots(shots.filter((_, i) => i !== index));
    },
    [shots, updateShots],
  );

  return (
    <BaseNode
      nodeType="multiPrompt"
      selected={!!selected}
      title="Shot Sequence"
      meta={`${shots.length} shot${shots.length === 1 ? '' : 's'} · ${totalDuration}s`}
    >
      <div className="multi-prompt-node__shots">
        {shots.map((shot, i) => (
          <div key={i} className="multi-prompt-node__shot">
            <div className="multi-prompt-node__shot-header">
              <span className="multi-prompt-node__shot-index">{String(i + 1).padStart(2, '0')}</span>
              <span className="multi-prompt-node__shot-label">
                {shot.prompt.trim().split(/[.!?\n]/)[0]?.slice(0, 34) || `Untitled shot ${i + 1}`}
              </span>
              <div className="multi-prompt-node__shot-controls">
                <select
                  className="multi-prompt-node__duration nodrag nowheel"
                  value={shot.duration}
                  onChange={(e) => handleDurationChange(i, Number(e.target.value))}
                >
                  {DURATION_OPTIONS.map((d) => (
                    <option key={d} value={d}>{d}s</option>
                  ))}
                </select>
                {shots.length > 1 && (
                  <button
                    type="button"
                    className="multi-prompt-node__remove-btn nodrag"
                    onClick={() => removeShot(i)}
                  >
                    &times;
                  </button>
                )}
              </div>
            </div>
            <MentionTextarea
              value={shot.prompt}
              onChange={(value) => handlePromptChange(i, value)}
              onMentionInsert={(element, value) => handleMentionInsert(i, element, value)}
              placeholder={`Describe shot ${i + 1}...`}
              rows={3}
              elements={state.elements}
            />
          </div>
        ))}
      </div>
      <button
        type="button"
        className="multi-prompt-node__add-btn nodrag"
        onClick={addShot}
      >
        <span>+</span> Add shot
      </button>
    </BaseNode>
  );
}

export const MultiPromptNode = memo(MultiPromptNodeInner);
