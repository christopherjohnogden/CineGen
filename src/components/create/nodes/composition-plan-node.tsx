

import { memo, useCallback } from 'react';
import { type NodeProps, useReactFlow } from '@xyflow/react';
import { BaseNode } from './base-node';
import type { WorkflowNodeData } from '@/types/workflow';

interface Section {
  name: string;
  positiveStyles: string;
  negativeStyles: string;
  durationMs: number;
  lines: string;
}

type CompositionPlanNodeProps = NodeProps & { data: WorkflowNodeData };

const DURATION_OPTIONS = [3000, 5000, 10000, 15000, 20000, 30000, 45000, 60000, 90000, 120000];
const DURATION_LABELS: Record<number, string> = {
  3000: '3s', 5000: '5s', 10000: '10s', 15000: '15s', 20000: '20s',
  30000: '30s', 45000: '45s', 60000: '1m', 90000: '1.5m', 120000: '2m',
};

const DEFAULT_SECTION: Section = { name: 'intro', positiveStyles: '', negativeStyles: '', durationMs: 15000, lines: '' };

function CompositionPlanNodeInner({ id, data, selected }: CompositionPlanNodeProps) {
  const { updateNodeData } = useReactFlow();

  const positiveGlobal: string = (data.config?.positiveGlobalStyles as string) ?? '';
  const negativeGlobal: string = (data.config?.negativeGlobalStyles as string) ?? '';
  const sections: Section[] = (data.config?.sections as Section[]) ?? [{ ...DEFAULT_SECTION }];

  const updateConfig = useCallback(
    (partial: Record<string, unknown>) => {
      updateNodeData(id, { config: { ...data.config, ...partial } });
    },
    [id, data.config, updateNodeData],
  );

  const updateSections = useCallback(
    (newSections: Section[]) => updateConfig({ sections: newSections }),
    [updateConfig],
  );

  const updateSection = useCallback(
    (index: number, partial: Partial<Section>) => {
      updateSections(sections.map((s, i) => (i === index ? { ...s, ...partial } : s)));
    },
    [sections, updateSections],
  );

  const addSection = useCallback(() => {
    updateSections([...sections, { ...DEFAULT_SECTION, name: `section ${sections.length + 1}` }]);
  }, [sections, updateSections]);

  const removeSection = useCallback(
    (index: number) => {
      if (sections.length <= 1) return;
      updateSections(sections.filter((_, i) => i !== index));
    },
    [sections, updateSections],
  );

  return (
    <BaseNode nodeType="compositionPlan" selected={!!selected}>
      <div className="comp-plan-node__globals">
        <div className="comp-plan-node__field">
          <label className="comp-plan-node__label">Global Styles</label>
          <input
            type="text"
            className="comp-plan-node__input nodrag"
            placeholder="orchestral, cinematic, epic..."
            value={positiveGlobal}
            onChange={(e) => updateConfig({ positiveGlobalStyles: e.target.value })}
          />
        </div>
        <div className="comp-plan-node__field">
          <label className="comp-plan-node__label">Exclude Styles</label>
          <input
            type="text"
            className="comp-plan-node__input nodrag"
            placeholder="electronic, pop..."
            value={negativeGlobal}
            onChange={(e) => updateConfig({ negativeGlobalStyles: e.target.value })}
          />
        </div>
      </div>

      <div className="comp-plan-node__sections">
        {sections.map((section, i) => (
          <div key={i} className="comp-plan-node__section">
            <div className="comp-plan-node__section-header">
              <input
                type="text"
                className="comp-plan-node__name-input nodrag"
                value={section.name}
                onChange={(e) => updateSection(i, { name: e.target.value })}
                placeholder="Section name"
              />
              <div className="comp-plan-node__section-controls">
                <select
                  className="comp-plan-node__duration nodrag nowheel"
                  value={section.durationMs}
                  onChange={(e) => updateSection(i, { durationMs: Number(e.target.value) })}
                >
                  {DURATION_OPTIONS.map((d) => (
                    <option key={d} value={d}>{DURATION_LABELS[d]}</option>
                  ))}
                </select>
                {sections.length > 1 && (
                  <button
                    type="button"
                    className="comp-plan-node__remove-btn nodrag"
                    onClick={() => removeSection(i)}
                  >
                    &times;
                  </button>
                )}
              </div>
            </div>
            <input
              type="text"
              className="comp-plan-node__input nodrag"
              placeholder="Styles: quiet, mysterious..."
              value={section.positiveStyles}
              onChange={(e) => updateSection(i, { positiveStyles: e.target.value })}
            />
            <textarea
              className="comp-plan-node__textarea nodrag nowheel"
              rows={2}
              placeholder="Lyrics (empty for instrumental)..."
              value={section.lines}
              onChange={(e) => updateSection(i, { lines: e.target.value })}
            />
          </div>
        ))}
      </div>
      <button
        type="button"
        className="comp-plan-node__add-btn nodrag"
        onClick={addSection}
      >
        + Add Section
      </button>
    </BaseNode>
  );
}

export const CompositionPlanNode = memo(CompositionPlanNodeInner);
