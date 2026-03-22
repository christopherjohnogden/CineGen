

import { useState, useMemo } from 'react';
import { getModelsByProvider } from '@/lib/fal/models';
import { getProvider } from '@/lib/utils/api-key';

interface ModelsPanelProps {
  onSelect: (nodeType: string) => void;
}

const CATEGORY_ORDER = ['image', 'image-edit', 'video', 'audio'] as const;
const CATEGORY_LABELS: Record<string, string> = {
  image: 'Image Models',
  'image-edit': 'Image Edit',
  video: 'Video Models',
  audio: 'Audio Models',
};

export function ModelsPanel({ onSelect }: ModelsPanelProps) {
  const [search, setSearch] = useState('');
  const provider = getProvider();

  const groups = useMemo(() => {
    const models = Object.values(getModelsByProvider(provider));
    const filtered = search
      ? models.filter((m) => m.name.toLowerCase().includes(search.toLowerCase()))
      : models;

    return CATEGORY_ORDER
      .map((cat) => ({
        category: cat,
        label: CATEGORY_LABELS[cat],
        models: filtered.filter((m) => m.category === cat),
      }))
      .filter((g) => g.models.length > 0);
  }, [search, provider]);

  return (
    <div className="toolbar-panel">
      <div className="toolbar-panel__header">Models</div>
      <input
        type="text"
        className="toolbar-panel__search"
        placeholder="Search models..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="toolbar-panel__list">
        {groups.map((group) => (
          <div key={group.category}>
            <div className="models-panel__category">{group.label}</div>
            <div className="models-panel__grid">
              {group.models.map((model) => (
                <button
                  key={model.nodeType}
                  className="models-panel__card"
                  onClick={() => onSelect(model.nodeType)}
                >
                  <span className="models-panel__card-badge" data-type={model.outputType}>
                    {model.outputType === 'video' ? 'VID' : model.outputType === 'audio' ? 'AUD' : 'IMG'}
                  </span>
                  <span className="models-panel__card-name">{model.name}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        {groups.length === 0 && (
          <div className="toolbar-panel__empty">No matching models</div>
        )}
      </div>
    </div>
  );
}
