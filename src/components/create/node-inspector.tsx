

import { useCallback, useState, useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import { ALL_MODELS } from '@/lib/fal/models';
import { CATEGORY_COLORS } from '@/lib/workflows/node-registry';
import { getLayerDecomposeStageLabel } from '@/lib/workflows/layer-decompose';
import { useRunNode } from './workflow-canvas';
import type { WorkflowNodeData, ModelInputField } from '@/types/workflow';

interface NodeInspectorProps {
  nodeId: string;
  data: WorkflowNodeData;
}

function InspectorFieldLabel({ field }: { field: ModelInputField }) {
  return (
    <>
      <label className="inspector__field-label">
        {field.label}
        {field.required && <span className="inspector__required" aria-label="required">*</span>}
      </label>
      {field.description && (
        <span className="inspector__field-description">{field.description}</span>
      )}
    </>
  );
}

function modelOutputBadge(outputType: string): string {
  if (outputType === 'video') return 'VID';
  if (outputType === 'audio') return 'AUD';
  if (outputType === 'text') return 'TXT';
  if (outputType === 'model3d') return '3D';
  return 'IMG';
}

function formatJsonValue(value: unknown): string {
  const resolved = value === undefined ? null : value;
  if (typeof resolved === 'string') {
    try {
      return JSON.stringify(JSON.parse(resolved), null, 2);
    } catch {
      return resolved;
    }
  }
  return JSON.stringify(resolved, null, 2) ?? 'null';
}

function JsonInspectorField({ field, value, onChange }: {
  field: ModelInputField;
  value: unknown;
  onChange: (val: unknown) => void;
}) {
  const serializedValue = formatJsonValue(value === undefined ? field.default : value);
  const [draft, setDraft] = useState(serializedValue);
  const [error, setError] = useState<string | null>(null);
  const errorId = `inspector-json-error-${field.id}`;

  useEffect(() => {
    setDraft(serializedValue);
    setError(null);
  }, [serializedValue]);

  return (
    <div className="inspector__field">
      <InspectorFieldLabel field={field} />
      <textarea
        className={`inspector__textarea inspector__textarea--json${error ? ' inspector__textarea--error' : ''}`}
        rows={5}
        value={draft}
        placeholder={field.placeholder}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        spellCheck={false}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          try {
            const parsed = JSON.parse(next);
            setError(null);
            onChange(parsed);
          } catch {
            setError('Enter valid JSON.');
          }
        }}
      />
      {error && <span id={errorId} className="inspector__json-error">{error}</span>}
    </div>
  );
}

function InspectorField({ field, value, onChange }: {
  field: ModelInputField;
  value: unknown;
  onChange: (val: unknown) => void;
}) {
  if (field.fieldType === 'select' && field.options) {
    return (
      <div className="inspector__field">
        <InspectorFieldLabel field={field} />
        <select
          className="inspector__select"
          value={String(value ?? field.default ?? '')}
          onChange={(e) => onChange(e.target.value)}
        >
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
    );
  }

  if (field.fieldType === 'range') {
    return (
      <div className="inspector__field">
        <InspectorFieldLabel field={field} />
        <div className="inspector__range-row">
          <input
            type="range"
            min={field.min} max={field.max} step={field.step}
            value={Number(value ?? field.default ?? 0)}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          <span className="inspector__range-value">
            {Number(value ?? field.default ?? 0)}
          </span>
        </div>
      </div>
    );
  }

  if (field.fieldType === 'number') {
    const isSeed = field.id === 'seed';
    const isRandom = isSeed && Number(value ?? field.default) === -1;
    const numberInput = (
      <input
        type="number"
        className={`inspector__number-input${isSeed ? '' : ' inspector__number-input--full'}`}
        value={Number(value ?? field.default ?? 0)}
        min={field.min} max={field.max} step={field.step}
        placeholder={field.placeholder}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    );
    return (
      <div className="inspector__field">
        <InspectorFieldLabel field={field} />
        {isSeed ? (
          <div className="inspector__seed-row">
            <label className="inspector__checkbox-label">
              <input
                type="checkbox"
                checked={isRandom}
                onChange={(e) => onChange(e.target.checked ? -1 : 0)}
              />
              Random
            </label>
            {!isRandom && numberInput}
          </div>
        ) : numberInput}
      </div>
    );
  }

  if (field.fieldType === 'text') {
    return (
      <div className="inspector__field">
        <InspectorFieldLabel field={field} />
        <input
          type="text"
          className="inspector__text-input"
          value={String(value ?? field.default ?? '')}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  if (field.fieldType === 'textarea') {
    return (
      <div className="inspector__field">
        <InspectorFieldLabel field={field} />
        <textarea
          className="inspector__textarea"
          rows={3}
          value={String(value ?? field.default ?? '')}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  if (field.fieldType === 'toggle') {
    const checked = Boolean(value ?? field.default ?? false);
    return (
      <div className="inspector__field inspector__field--toggle">
        <label className="inspector__checkbox-label">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
          />
          {field.label}
          {field.required && <span className="inspector__required" aria-label="required">*</span>}
        </label>
        {field.description && (
          <span className="inspector__field-description">{field.description}</span>
        )}
      </div>
    );
  }

  if (field.fieldType === 'json') {
    return <JsonInspectorField field={field} value={value} onChange={onChange} />;
  }

  return null;
}

export function NodeInspector({ nodeId, data }: NodeInspectorProps) {
  const { updateNodeData } = useReactFlow();
  const runNode = useRunNode();
  const modelDef = ALL_MODELS[data.type];

  const status = data.result?.status ?? 'idle';
  const isRunning = status === 'running';
  const reportedProgress = typeof data.result?.progress === 'number' ? data.result.progress : undefined;
  const [progress, setProgress] = useState(0);
  const progressMessage = data.result?.progressMessage
    ?? getLayerDecomposeStageLabel(data.result?.progressStage)
    ?? (isRunning ? 'Running…' : undefined);
  const isTranscriptModel = modelDef?.nodeType === 'whisperx-local'
    || modelDef?.nodeType === 'wizper'
    || modelDef?.nodeType === 'whisper-cloud';

  useEffect(() => {
    if (!isRunning) { setProgress(0); return; }
    if (reportedProgress !== undefined) {
      setProgress(reportedProgress);
      return;
    }
    setProgress(5);
    const interval = setInterval(() => {
      setProgress((p) => Math.min(p + Math.random() * 8 + 2, 95));
    }, 1500);
    return () => clearInterval(interval);
  }, [isRunning, reportedProgress]);

  if (!modelDef) return null;

  const accentColor = CATEGORY_COLORS[modelDef.category];
  const inspectorFields = modelDef.inputs.filter(
    (f) => f.fieldType !== 'port' && f.fieldType !== 'element-list',
  );

  const handleChange = useCallback(
    (fieldId: string, val: unknown) => {
      updateNodeData(nodeId, {
        config: {
          ...data.config,
          ...(data.type === 'layer-decompose-cloud' ? { __layerDecomposeVersion: 2 } : {}),
          [fieldId]: val,
        },
      });
    },
    [nodeId, data.config, updateNodeData],
  );

  return (
    <div className="node-inspector">
      <div className="node-inspector__header">
        <span className="node-inspector__badge" style={{ background: accentColor }}>
          {modelOutputBadge(modelDef.outputType)}
        </span>
        <span className="node-inspector__name">{modelDef.name}</span>
      </div>

      {inspectorFields.length > 0 && (
        <div className="node-inspector__body">
          {inspectorFields.map((field) => (
            <InspectorField
              key={field.id}
              field={field}
              value={data.config[field.id]}
              onChange={(val) => handleChange(field.id, val)}
            />
          ))}
        </div>
      )}

      <div className="node-inspector__footer">
        {isRunning ? (
          <div className="model-node__progress-wrap">
            <div className="model-node__progress">
              <div className="model-node__progress-bar" style={{ width: `${progress}%` }} />
              <span className="model-node__progress-text">{Math.round(progress)}%</span>
              <button
                type="button"
                className="model-node__progress-cancel"
                onClick={() => {}}
              >
                &times;
              </button>
            </div>
            {progressMessage && (
              <div className="model-node__progress-stage">{progressMessage}</div>
            )}
          </div>
        ) : (
          <button
            type="button"
            className="node-inspector__run-btn"
            onClick={() => runNode(nodeId)}
          >
            &rarr; Run selected
          </button>
        )}

        {/* WhisperX Export */}
        {isTranscriptModel && data.result?.segments && data.result.segments.length > 0 && (
          <div className="whisperx-export">
            <button
              type="button"
              className="whisperx-export__btn"
              onClick={() => {
                const segs = data.result?.segments ?? [];
                let srt = '';
                segs.forEach((s: { start: number; end: number; text: string; speaker?: string | null }, i: number) => {
                  const fmt = (t: number) => {
                    const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60);
                    const sec = Math.floor(t % 60); const ms = Math.floor((t % 1) * 1000);
                    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
                  };
                  srt += `${i+1}\n${fmt(s.start)} --> ${fmt(s.end)}\n${s.speaker ? `[${s.speaker}] ` : ''}${s.text}\n\n`;
                });
                const blob = new Blob([srt], { type: 'text/plain' });
                const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
                a.download = 'transcript.srt'; a.click(); URL.revokeObjectURL(a.href);
              }}
            >
              Export SRT
            </button>
            <button
              type="button"
              className="whisperx-export__btn"
              onClick={() => {
                const segs = data.result?.segments ?? [];
                let vtt = 'WEBVTT\n\n';
                segs.forEach((s: { start: number; end: number; text: string; speaker?: string | null }) => {
                  const fmt = (t: number) => {
                    const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60);
                    const sec = Math.floor(t % 60); const ms = Math.floor((t % 1) * 1000);
                    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;
                  };
                  vtt += `${fmt(s.start)} --> ${fmt(s.end)}\n${s.speaker ? `<v ${s.speaker}>` : ''}${s.text}\n\n`;
                });
                const blob = new Blob([vtt], { type: 'text/plain' });
                const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
                a.download = 'transcript.vtt'; a.click(); URL.revokeObjectURL(a.href);
              }}
            >
              Export VTT
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
