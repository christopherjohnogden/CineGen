

import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { type NodeProps, NodeResizer } from '@xyflow/react';
import { useWorkspace } from '@/components/workspace/workspace-shell';
import type { WorkflowNodeData } from '@/types/workflow';

type GroupNodeProps = NodeProps & { data: WorkflowNodeData };

const PRESET_COLORS = [
  '#d4a054',
  '#5b8def',
  '#e06c75',
  '#56b870',
  '#c678dd',
  '#e5c07b',
  '#56b6c2',
  '#f78166',
];

const SIZE_OPTIONS = [12, 14, 16, 20, 24];

function GroupNodeInner({ id, data, selected }: GroupNodeProps) {
  const { dispatch } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);

  const config = data.config ?? {};
  const label = (config.groupLabel as string) || data.label || 'Group';
  const color = (config.color as string) || '#d4a054';
  const labelAlign = (config.labelAlign as 'left' | 'center' | 'right') || 'left';
  const labelPosition = (config.labelPosition as 'inside' | 'outside') || 'outside';
  const labelSize = (config.labelSize as number) || 16;

  const updateConfig = useCallback(
    (patch: Record<string, unknown>) => {
      dispatch({ type: 'UPDATE_NODE_CONFIG', nodeId: id, config: patch });
    },
    [id, dispatch],
  );

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  useEffect(() => {
    if (!showSettings) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (
        settingsRef.current && !settingsRef.current.contains(target) &&
        btnRef.current && !btnRef.current.contains(target)
      ) {
        setShowSettings(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSettings]);

  useEffect(() => {
    if (!showSettings || !btnRef.current) { setPanelPos(null); return; }
    const rect = btnRef.current.getBoundingClientRect();
    setPanelPos({ top: rect.top, left: rect.right + 12 });
  }, [showSettings]);

  const isOutside = labelPosition === 'outside';

  const labelContent = editing ? (
    <input
      ref={inputRef}
      className="group-node__label-input nodrag"
      style={{
        fontSize: labelSize,
        textAlign: labelAlign,
      }}
      defaultValue={label}
      onBlur={(e) => {
        updateConfig({ groupLabel: e.target.value || 'Group' });
        setEditing(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          updateConfig({ groupLabel: (e.target as HTMLInputElement).value || 'Group' });
          setEditing(false);
        }
      }}
    />
  ) : (
    <span
      className="group-node__label nodrag"
      style={{ fontSize: labelSize, textAlign: labelAlign }}
      onDoubleClick={() => setEditing(true)}
    >
      {label}
    </span>
  );

  return (
    <>
      <NodeResizer
        isVisible={!!selected}
        minWidth={200}
        minHeight={150}
        lineStyle={{ borderColor: color }}
        handleStyle={{ background: color, width: 8, height: 8, borderRadius: 2 }}
      />

      {isOutside && (
        <div className="group-node__header group-node__header--outside">
          {labelContent}
        </div>
      )}

      <div
        className="group-node"
        style={{
          '--group-color': color,
          borderColor: selected ? color : `${color}66`,
        } as React.CSSProperties}
      >
        {!isOutside && (
          <div className="group-node__header group-node__header--inside">
            {labelContent}
          </div>
        )}

        {selected && (
          <button
            ref={btnRef}
            type="button"
            className="group-node__settings-btn nodrag"
            onClick={() => setShowSettings((v) => !v)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        )}

        {showSettings && panelPos && createPortal(
          <div
            ref={settingsRef}
            className="group-node__settings"
            style={{ top: panelPos.top, left: panelPos.left }}
          >
            <div className="group-node__settings-section">
              <span className="group-node__settings-label">Color</span>
              <div className="group-node__color-grid">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`group-node__color-swatch${c === color ? ' group-node__color-swatch--active' : ''}`}
                    style={{ background: c }}
                    onClick={() => updateConfig({ color: c })}
                  />
                ))}
              </div>
            </div>
            <div className="group-node__settings-section">
              <span className="group-node__settings-label">Label Position</span>
              <div className="group-node__align-row">
                <button
                  type="button"
                  className={`group-node__align-btn${labelPosition === 'outside' ? ' group-node__align-btn--active' : ''}`}
                  onClick={() => updateConfig({ labelPosition: 'outside' })}
                >
                  Outside
                </button>
                <button
                  type="button"
                  className={`group-node__align-btn${labelPosition === 'inside' ? ' group-node__align-btn--active' : ''}`}
                  onClick={() => updateConfig({ labelPosition: 'inside' })}
                >
                  Inside
                </button>
              </div>
            </div>
            <div className="group-node__settings-section">
              <span className="group-node__settings-label">Label Align</span>
              <div className="group-node__align-row">
                {(['left', 'center', 'right'] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    className={`group-node__align-btn${a === labelAlign ? ' group-node__align-btn--active' : ''}`}
                    onClick={() => updateConfig({ labelAlign: a })}
                  >
                    {a === 'left' && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="17" y1="10" x2="3" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="14" x2="3" y2="14" /><line x1="17" y1="18" x2="3" y2="18" /></svg>
                    )}
                    {a === 'center' && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="10" x2="6" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="14" x2="3" y2="14" /><line x1="18" y1="18" x2="6" y2="18" /></svg>
                    )}
                    {a === 'right' && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="21" y1="10" x2="7" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="14" x2="3" y2="14" /><line x1="21" y1="18" x2="7" y2="18" /></svg>
                    )}
                  </button>
                ))}
              </div>
            </div>
            <div className="group-node__settings-section">
              <span className="group-node__settings-label">Text Size</span>
              <div className="group-node__align-row">
                {SIZE_OPTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`group-node__align-btn${s === labelSize ? ' group-node__align-btn--active' : ''}`}
                    onClick={() => updateConfig({ labelSize: s })}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )}
      </div>
    </>
  );
}

export const GroupNode = memo(GroupNodeInner);
