import { Minus, Settings, Square, X } from 'lucide-react'
import type { TopLevelTab } from '../types/engine'

interface TopBarProps {
  activeTab: TopLevelTab
  onTabChange: (tab: TopLevelTab) => void
}

const mainTabs: Array<{ id: TopLevelTab; label: string }> = [
  { id: 'edit', label: 'Editor' },
  { id: 'generate', label: 'Generate' },
  { id: 'export', label: 'Export' },
]

const visualOnlyTabs = ['Stock', 'ConfyUI', 'LLM'] as const

export function TopBar({ activeTab, onTabChange }: TopBarProps) {
  return (
    <header className="top-bar">
      <div className="top-bar__left">
        <div className="window-traffic" aria-hidden="true">
          <span className="traffic-dot is-red" />
          <span className="traffic-dot is-yellow" />
          <span className="traffic-dot is-green" />
        </div>
        <span
          style={{
            fontSize: '0.72rem',
            fontWeight: 600,
            letterSpacing: '0.06em',
            color: 'var(--text-dim)',
            fontFamily: "'IBM Plex Mono', monospace",
            marginLeft: '4px',
          }}
        >
          CINEGEN
        </span>
      </div>

      <div className="top-bar__center">
        <nav className="top-nav" role="tablist" aria-label="Primary workspace tabs">
          {mainTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`top-nav__button ${activeTab === tab.id ? 'is-active' : ''}`}
              onClick={() => onTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
          {visualOnlyTabs.map((label) => (
            <span key={label} className="top-nav__ghost">
              {label}
            </span>
          ))}
        </nav>
      </div>

      <div className="top-bar__right">
        <button type="button" className="icon-button top-icon" aria-label="Preferences">
          <Settings size={13} />
        </button>
        <button type="button" className="icon-button top-icon window-action" aria-label="Minimize window">
          <Minus size={12} />
        </button>
        <button type="button" className="icon-button top-icon window-action" aria-label="Maximize window">
          <Square size={11} />
        </button>
        <button type="button" className="icon-button top-icon window-action" aria-label="Close window">
          <X size={12} />
        </button>
      </div>
    </header>
  )
}
