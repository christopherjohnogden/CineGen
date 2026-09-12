import { useState, useEffect, useRef, useMemo, useCallback, useId } from 'react';
import { NODE_REGISTRY } from '@/lib/workflows/node-registry';
import { ALL_MODELS } from '@/lib/fal/models';
import { areWorkflowPortsCompatible } from '@/lib/workflows/port-compatibility';
import {
  compareModelsByProvider,
  isLegacyTopviewAutomaticModel,
  MODEL_PROVIDER_LABELS,
  type ModelProvider,
} from '@/lib/workflows/provider-model-options';
import { useTopviewModelCatalogVersion } from '@/components/create/use-topview-model-catalog';
import type { NodeCategory, PortType } from '@/types/workflow';

interface NodePaletteProps {
  position: { x: number; y: number };
  onSelect: (nodeType: string) => void;
  onClose: () => void;
  sourcePortType?: PortType | null;
}

type Tab = 'all' | 'topview' | 'higgsfield' | 'cloud' | 'local' | 'runpod' | 'pod';

const TABS: { id: Tab; label: string }[] = [
  { id: 'all',        label: 'All'        },
  { id: 'topview',    label: 'Topview'    },
  { id: 'higgsfield', label: 'Higgsfield' },
  { id: 'cloud',      label: 'Cloud'      },
  { id: 'local',      label: 'Local'      },
  { id: 'runpod',     label: 'RunPod'     },
  { id: 'pod',        label: 'Pod'        },
];

const PROVIDERS = Object.entries(MODEL_PROVIDER_LABELS) as [ModelProvider, string][];
// Topview and Higgsfield already have their own tabs.
const CLOUD_PROVIDERS_WITHOUT_TABS: ModelProvider[] = ['fal', 'kie'];
const HIDDEN_PROVIDERS_KEY = 'cinegen:canvas:hidden-providers';

function loadHiddenProviders(): ModelProvider[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(HIDDEN_PROVIDERS_KEY) ?? '[]');
    return Array.isArray(stored) ? PROVIDERS.map(([id]) => id).filter(id => stored.includes(id)) : [];
  } catch { return []; }
}

const CATEGORY_ORDER: NodeCategory[] = ['utility', 'text', 'image', 'image-edit', 'video', 'model3d', 'audio'];
const CATEGORY_LABELS: Record<NodeCategory, string> = {
  utility:      'UTILITY',
  text:         'TEXT / LLM',
  image:        'IMAGE',
  'image-edit': 'IMAGE EDIT',
  video:        'VIDEO',
  model3d:      '3D',
  audio:        'AUDIO',
};

function modelTypeBadge(outputType: string): string {
  if (outputType === 'video') return 'VID';
  if (outputType === 'audio') return 'AUD';
  if (outputType === 'text') return 'TXT';
  if (outputType === 'model3d') return '3D';
  return 'IMG';
}

export function NodePalette({ position, onSelect, onClose, sourcePortType = null }: NodePaletteProps) {
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [hiddenProviders, setHiddenProviders] = useState(loadHiddenProviders);
  const [providersOpen, setProvidersOpen] = useState(false);
  const providerPanelId = useId();
  const firstProviderRef = useRef<HTMLInputElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const topviewCatalogVersion = useTopviewModelCatalogVersion();
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const openAbove = position.y > window.innerHeight / 2;
  const visibleTabs = TABS.filter(({ id }) => id === 'all' || (id === 'cloud'
    ? CLOUD_PROVIDERS_WITHOUT_TABS.some(provider => !hiddenProviders.includes(provider))
    : !hiddenProviders.includes(id)));
  const activeTab = visibleTabs.some(({ id }) => id === tab) ? tab : 'all';

  useEffect(() => {
    try { localStorage.setItem(HIDDEN_PROVIDERS_KEY, JSON.stringify(hiddenProviders)); } catch { /* Keep filtering usable when storage is unavailable. */ }
  }, [hiddenProviders]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === HIDDEN_PROVIDERS_KEY || event.key === null) setHiddenProviders(loadHiddenProviders());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  useEffect(() => { if (activeTab !== tab) setTab(activeTab); }, [activeTab, tab]);
  useEffect(() => {
    if (providersOpen) firstProviderRef.current?.focus();
    else inputRef.current?.focus();
  }, [providersOpen]);

  const filteredGroups = useMemo(() => {
    const entries = Object.values(NODE_REGISTRY).filter((n) => {
      if (sourcePortType && !n.inputs.some((input) => areWorkflowPortsCompatible(sourcePortType, input.type))) {
        return false;
      }
      const modelDef = ALL_MODELS[n.type];
      const provider = modelDef ? (modelDef.provider ?? 'fal') : null;
      if (modelDef && isLegacyTopviewAutomaticModel(modelDef)) return false;
      if (provider && hiddenProviders.includes(provider)) return false;

      if (activeTab === 'cloud') {
        if (!n.isModel) return false;
        return provider === 'topview' || provider === 'fal' || provider === 'kie' || provider === 'higgsfield';
      }
      if (activeTab === 'topview') {
        if (!n.isModel) return false;
        return provider === 'topview';
      }
      if (activeTab === 'higgsfield') {
        if (!n.isModel) return false;
        return provider === 'higgsfield';
      }
      if (activeTab === 'local') {
        if (!n.isModel) return false;
        return provider === 'local';
      }
      if (activeTab === 'runpod') {
        if (!n.isModel) return false;
        return provider === 'runpod';
      }
      if (activeTab === 'pod') {
        if (!n.isModel) return false;
        return provider === 'pod';
      }
      // 'all': show everything
      return true;
    });

    const query = search.trim().toLowerCase();
    const filtered = query
      ? entries.filter((n) => {
          const model = ALL_MODELS[n.type];
          return n.label.toLowerCase().includes(query)
            || model?.id.toLowerCase().includes(query)
            || model?.description.toLowerCase().includes(query);
        })
      : entries;

    return CATEGORY_ORDER
      .map((cat) => ({
        category: cat,
        label: CATEGORY_LABELS[cat],
        nodes: filtered.filter((n) => n.category === cat).sort(compareModelsByProvider),
      }))
      .filter((g) => g.nodes.length > 0);
  }, [search, sourcePortType, activeTab, hiddenProviders, topviewCatalogVersion]);

  const flatList = useMemo(
    () => filteredGroups.flatMap((g) => g.nodes),
    [filteredGroups],
  );

  useEffect(() => { setSelectedIndex(0); }, [search, activeTab, hiddenProviders]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as HTMLElement)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selected = list.querySelector('.np__item--selected') as HTMLElement | null;
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Checkbox Space/Enter and Escape belong to the provider picker, not the
      // canvas's global Space shortcut or the highlighted model underneath it.
      e.stopPropagation();
      if (providersOpen) {
        if (e.key === 'Escape') { e.preventDefault(); setProvidersOpen(false); }
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if ((e.target as HTMLElement).closest('button')) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, flatList.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (flatList[selectedIndex]) onSelect(flatList[selectedIndex].type);
      } else if (e.code === 'Space' && !search) {
        e.preventDefault();
        onClose();
      }
    },
    [flatList, selectedIndex, onSelect, onClose, search, providersOpen],
  );

  return (
    <div
      ref={panelRef}
      className="np"
      style={{
        left: position.x,
        ...(openAbove
          ? { bottom: window.innerHeight - position.y }
          : { top: position.y }),
      }}
      onKeyDown={handleKeyDown}
      onContextMenu={(event) => {
        if ((event.target as HTMLElement).closest('input[type="text"]')) return;
        event.preventDefault();
        event.stopPropagation();
        setProvidersOpen(true);
      }}
    >
      {sourcePortType && (
        <div className="np__connection-context">
          <span className={`np__connection-dot np__connection-dot--${sourcePortType}`} />
          Connect {sourcePortType} output
        </div>
      )}
      {/* Search */}
      <div className="np__search-row">
        <svg className="np__search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          className="np__search"
          placeholder="Search nodes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button className="np__search-clear" onClick={() => setSearch('')}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
        <button
          type="button"
          className={`np__provider-toggle${providersOpen || hiddenProviders.length ? ' np__provider-toggle--active' : ''}`}
          aria-label="Choose visible providers"
          aria-expanded={providersOpen}
          aria-controls={providerPanelId}
          title="Choose visible providers · or right-click this menu"
          onClick={() => setProvidersOpen(open => !open)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h7m6 0h3M4 17h3m6 0h7" /><circle cx="14" cy="7" r="3" /><circle cx="10" cy="17" r="3" />
          </svg>
          {hiddenProviders.length > 0 && <span className="np__provider-count">{hiddenProviders.length}</span>}
        </button>
      </div>

      {providersOpen ? (
        <div className="np__providers" id={providerPanelId} role="group" aria-label="Visible providers">
          <div className="np__providers-heading">
            <strong>Visible providers</strong>
            <span>Choose which models appear in this menu.</span>
          </div>
          <div className="np__provider-options">
            {PROVIDERS.map(([id, label], index) => (
              <label key={id} className="np__provider-option">
                <input
                  ref={index === 0 ? firstProviderRef : undefined}
                  type="checkbox"
                  checked={!hiddenProviders.includes(id)}
                  onChange={(event) => {
                    const visible = event.currentTarget.checked;
                    setHiddenProviders(current => visible ? current.filter(provider => provider !== id) : [...current, id]);
                  }}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <div className="np__providers-footer">
            <button type="button" onClick={() => setHiddenProviders([])} disabled={!hiddenProviders.length}>Show all</button>
            <button type="button" className="np__providers-done" onClick={() => setProvidersOpen(false)}>Done</button>
          </div>
        </div>
      ) : (
      <>
      {/* Tabs */}
      <div className="np__tabs">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            className={`np__tab${activeTab === t.id ? ' np__tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="np__list" ref={listRef}>
        {flatList.length === 0 ? (
          <div className="np__empty">
            {sourcePortType && !search
              ? `No compatible nodes for this ${sourcePortType} output`
              : search ? `No results for "${search}"` : 'No models from your visible providers'}
            {hiddenProviders.length > 0 && <button type="button" onClick={() => setProvidersOpen(true)}>Manage providers</button>}
          </div>
        ) : (
          filteredGroups.map((group) => (
            <div key={group.category} className="np__group">
              <div className="np__category">{group.label}</div>
              {group.nodes.map((node) => {
                const idx = flatList.indexOf(node);
                const modelDef = ALL_MODELS[node.type];
                const provider = modelDef ? (modelDef.provider ?? 'fal') : null;
                const providerLabel = provider ? MODEL_PROVIDER_LABELS[provider] ?? provider : null;
                const typeBadge = node.isModel
                  ? modelTypeBadge(modelDef?.outputType ?? node.category)
                  : null;

                return (
                  <button
                    key={node.type}
                    className={`np__item${idx === selectedIndex ? ' np__item--selected' : ''}`}
                    title={modelDef ? `${modelDef.name} · ${modelDef.id}` : node.label}
                    onClick={() => onSelect(node.type)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <span className="np__item-label">{node.label}</span>
                    <span className="np__item-badges">
                      {providerLabel && (
                        <span className={`np__provider np__provider--${provider}`}>
                          ({providerLabel})
                        </span>
                      )}
                      {typeBadge && (
                        <span className={`np__badge np__badge--${node.category}`}>
                          {typeBadge}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
      </>
      )}
    </div>
  );
}
