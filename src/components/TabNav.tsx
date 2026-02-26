import type { TopLevelTab } from '../types/engine'

interface TabNavProps {
  activeTab: TopLevelTab
  onChange: (tab: TopLevelTab) => void
}

const tabLabels: Record<TopLevelTab, string> = {
  generate: 'Generate',
  edit: 'Editor',
  export: 'Export',
}

const tabOrder: TopLevelTab[] = ['edit', 'generate', 'export']
const visualOnlyTabs = ['Stock', 'ConfyUI', 'LLM'] as const

export function TabNav({ activeTab, onChange }: TabNavProps) {
  return (
    <div className="tab-nav">
      <div className="tab-nav__inner">
        <div className="tab-nav__tabs" role="tablist" aria-label="Primary workspace tabs">
          {tabOrder.map((tab) => (
            <button
              key={tab}
              role="tab"
              aria-selected={activeTab === tab}
              className={`tab-nav__button ${activeTab === tab ? 'is-active' : ''}`}
              onClick={() => onChange(tab)}
            >
              {tabLabels[tab]}
            </button>
          ))}
        </div>
        <div className="tab-nav__extras" aria-hidden="true">
          {visualOnlyTabs.map((label) => (
            <span key={label} className="tab-nav__ghost">
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
