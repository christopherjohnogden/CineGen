

import { memo, useCallback } from 'react';
import { type NodeProps, useReactFlow } from '@xyflow/react';
import { BaseNode } from './base-node';
import { MentionTextarea } from './mention-textarea';
import { useWorkspace } from '@/components/workspace/workspace-shell';
import type { WorkflowNodeData } from '@/types/workflow';

interface Shot {
  prompt: string;
  duration: number;
}

type ShotPromptNodeProps = NodeProps & { data: WorkflowNodeData };

const DURATION_OPTIONS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

function ShotPromptNodeInner({ id, data, selected }: ShotPromptNodeProps) {
  const { updateNodeData } = useReactFlow();
  const { state } = useWorkspace();
  const shots: Shot[] = (data.config?.shots as Shot[]) ?? [{ prompt: '', duration: 5 }];

  const updateShots = useCallback(
    (newShots: Shot[]) => {
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
    <BaseNode nodeType="shotPrompt" selected={!!selected}>
      <div className="shot-prompt-node__shots">
        {shots.map((shot, i) => (
          <div key={i} className="shot-prompt-node__shot">
            <div className="shot-prompt-node__shot-header">
              <span className="shot-prompt-node__shot-label">Shot {i + 1}</span>
              <div className="shot-prompt-node__shot-controls">
                <select
                  className="shot-prompt-node__duration nodrag nowheel"
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
                    className="shot-prompt-node__remove-btn nodrag"
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
              placeholder={`Describe shot ${i + 1}...`}
              rows={3}
              elements={state.elements}
            />
          </div>
        ))}
      </div>
      <button
        type="button"
        className="shot-prompt-node__add-btn nodrag"
        onClick={addShot}
      >
        + Add Shot
      </button>
    </BaseNode>
  );
}

export const ShotPromptNode = memo(ShotPromptNodeInner);
