

import { memo, useCallback } from 'react';
import { type NodeProps, useReactFlow } from '@xyflow/react';
import { BaseNode } from './base-node';
import { useWorkspace } from '@/components/workspace/workspace-shell';
import { resolveElementNodeIds, resolveElementNodeVariationIds } from '@/lib/workflows/node-registry';
import { elementImagesForVariation, elementVariationLabel } from '@/lib/elements/variations';
import type { WorkflowNodeData } from '@/types/workflow';
import type { ElementType } from '@/types/elements';

type ElementNodeProps = NodeProps & { data: WorkflowNodeData };

const TYPE_ORDER: ElementType[] = ['character', 'location', 'prop', 'vehicle'];
const TYPE_GROUP_LABELS: Record<ElementType, string> = {
  character: 'Characters',
  location: 'Locations',
  prop: 'Props',
  vehicle: 'Vehicles',
};

function ElementNodeInner({ id, data, selected }: ElementNodeProps) {
  const { updateNodeData } = useReactFlow();
  const { state } = useWorkspace();

  const elementIds = resolveElementNodeIds(data.config);
  const variationIds = resolveElementNodeVariationIds(data.config);
  const byId = new Map(state.elements.map((el) => [el.id, el]));
  const available = state.elements.filter((el) => !elementIds.includes(el.id));
  const stacked = elementIds
    .map((elementId) => byId.get(elementId))
    .filter((el): el is NonNullable<typeof el> => Boolean(el));
  const imageCount = stacked.reduce((sum, el) => sum + elementImagesForVariation(el, variationIds[el.id]).length, 0);
  const singleElement = elementIds.length === 1 && stacked.length === 1;

  const commit = useCallback(
    (next: string[]) => {
      // Clear the legacy single-id field so removals don't resurrect it
      const retainedVariationIds = Object.fromEntries(
        Object.entries(variationIds).filter(([elementId]) => next.includes(elementId)),
      );
      updateNodeData(id, {
        config: {
          ...data.config,
          elementIds: next,
          elementId: '',
          elementVariationIds: retainedVariationIds,
        },
      });
    },
    [id, data.config, updateNodeData, variationIds],
  );

  const handleVariation = useCallback(
    (elementId: string, variationId: string) => {
      updateNodeData(id, {
        config: {
          ...data.config,
          elementVariationIds: { ...variationIds, [elementId]: variationId },
        },
      });
    },
    [data.config, id, updateNodeData, variationIds],
  );

  const handleAdd = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (e.target.value) commit([...elementIds, e.target.value]);
    },
    [commit, elementIds],
  );

  const handleRemove = useCallback(
    (elementId: string) => {
      commit(elementIds.filter((entry) => entry !== elementId));
    },
    [commit, elementIds],
  );

  const handleReplace = useCallback(
    (index: number, nextId: string) => {
      if (!nextId || nextId === elementIds[index]) return;
      commit(elementIds.map((entry, i) => (i === index ? nextId : entry)));
    },
    [commit, elementIds],
  );

  return (
    <BaseNode
      nodeType="element"
      selected={!!selected}
      title="Element References"
      meta={stacked.length ? `${stacked.length} element${stacked.length === 1 ? '' : 's'} · ${imageCount} image${imageCount === 1 ? '' : 's'}` : 'Empty'}
      className={singleElement ? 'cinegen-node--element-hero' : undefined}
    >
      <div className={`element-node__stack${singleElement ? ' element-node__stack--single' : ''}`}>
        {elementIds.length === 0 && (
          <div className="element-node__empty">
            {state.elements.length === 0
              ? 'No elements in your library yet'
              : 'Stack elements to feed this workflow'}
          </div>
        )}

        {elementIds.map((elementId, index) => {
          const el = byId.get(elementId);
          const selectedVariationId = el
            ? variationIds[el.id] ?? el.activeVariationId ?? el.variations?.[0]?.id
            : undefined;
          const activeImages = el ? elementImagesForVariation(el, selectedVariationId) : [];
          const thumbnail = activeImages[0]?.url;
          return (
            <div
              key={elementId}
              className={[
                'element-node__row',
                !el && 'element-node__row--missing',
                singleElement && 'element-node__row--hero',
              ].filter(Boolean).join(' ')}
            >
              {/* Invisible full-row select: click anywhere on the row to swap this element */}
              <select
                className="element-node__swap nodrag nowheel"
                value={elementId}
                onChange={(e) => handleReplace(index, e.target.value)}
                title="Swap element"
                aria-label="Swap element"
              >
                <option value={elementId} disabled>
                  {el?.name ?? 'Missing element'}
                </option>
                {TYPE_ORDER.map((type) => {
                  const group = available.filter((entry) => entry.type === type);
                  if (group.length === 0) return null;
                  return (
                    <optgroup key={type} label={TYPE_GROUP_LABELS[type]}>
                      {group.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
              {thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbnail} alt={el?.name ?? 'Element'} className="element-node__thumb" />
              ) : (
                <div className="element-node__thumb element-node__thumb--empty">
                  {el ? el.name.charAt(0) : '?'}
                </div>
              )}
              <div className="element-node__meta">
                <span className="element-node__name">{el?.name ?? 'Missing element'}</span>
                <span className="element-node__sub">
                  {el && (
                    <span className={`element-node__type element-node__type--${el.type}`}>
                      {el.type}
                    </span>
                  )}
                  <span>
                    {el
                      ? `${activeImages.length} img${activeImages.length === 1 ? '' : 's'}`
                      : 'removed from library'}
                  </span>
                </span>
                {el && (el.variations?.length ?? 0) > 1 && (
                  <label className="element-node__look nodrag">
                    <span>Continuity look</span>
                    <select
                      className="nodrag nowheel"
                      value={selectedVariationId}
                      onChange={(event) => handleVariation(el.id, event.target.value)}
                      aria-label={`Continuity look for ${el.name}`}
                    >
                      {el.variations?.map((variation) => (
                        <option key={variation.id} value={variation.id}>{variation.name}</option>
                      ))}
                    </select>
                  </label>
                )}
                {el && (el.variations?.length ?? 0) <= 1 && (
                  <span className="element-node__look-label">{elementVariationLabel(el, selectedVariationId)}</span>
                )}
              </div>
              <span className="element-node__swap-hint" aria-hidden="true">Swap</span>
              <button
                type="button"
                className="element-node__remove nodrag"
                onClick={() => handleRemove(elementId)}
                title="Remove element"
                aria-label="Remove element"
              >
                &times;
              </button>
            </div>
          );
        })}

        <select
          className="element-node__add nodrag nowheel"
          value=""
          onChange={handleAdd}
          disabled={available.length === 0}
        >
          <option value="" disabled>
            {state.elements.length === 0
              ? 'No elements in library'
              : available.length === 0
                ? 'All elements added'
                : '+ Add element'}
          </option>
          {TYPE_ORDER.map((type) => {
            const group = available.filter((el) => el.type === type);
            if (group.length === 0) return null;
            return (
              <optgroup key={type} label={TYPE_GROUP_LABELS[type]}>
                {group.map((el) => (
                  <option key={el.id} value={el.id}>
                    {el.name}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>

        {stacked.length > 1 && (
          <span className="element-node__summary">
            References are combined at generation time
          </span>
        )}
      </div>
    </BaseNode>
  );
}

export const ElementNode = memo(ElementNodeInner);
