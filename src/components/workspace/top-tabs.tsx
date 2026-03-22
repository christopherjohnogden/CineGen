

import type { ProjectTab } from '@/types/workspace';

const TABS: { id: ProjectTab; label: string }[] = [
  { id: 'elements', label: 'Elements' },
  { id: 'create', label: 'Spaces' },
  { id: 'edit', label: 'Edit' },
  { id: 'llm', label: 'LLM' },
  { id: 'export', label: 'Export' },
];

interface TopTabsProps {
  activeTab: ProjectTab;
  onTabChange: (tab: ProjectTab) => void;
  onBackToHome?: () => void;
}

export function TopTabs({ activeTab, onTabChange, onBackToHome }: TopTabsProps) {
  const isSettingsActive = activeTab === 'settings';

  return (
    <nav className="top-nav">
      <div className="top-nav__left">
        <span className="top-nav__wordmark">CINEGEN</span>
        {onBackToHome && (
          <button className="top-nav__back" onClick={onBackToHome} title="Back to Projects">
            <svg width="14" height="14" viewBox="0 0 495.398 495.398" fill="currentColor"><path d="M487.083,225.514l-75.08-75.08V63.704c0-15.682-12.708-28.391-28.413-28.391c-15.669,0-28.377,12.709-28.377,28.391v29.941L299.31,37.74c-27.639-27.624-75.694-27.575-103.27,0.05L8.312,225.514c-11.082,11.104-11.082,29.071,0,40.158c11.087,11.101,29.089,11.101,40.172,0l187.71-187.729c6.115-6.083,16.893-6.083,22.976-0.018l187.742,187.747c5.567,5.551,12.825,8.312,20.081,8.312c7.271,0,14.541-2.764,20.091-8.312C498.17,254.586,498.17,236.619,487.083,225.514z"/><path d="M257.561,131.836c-5.454-5.451-14.285-5.451-19.723,0L72.712,296.913c-2.607,2.606-4.085,6.164-4.085,9.877v120.401c0,28.253,22.908,51.16,51.16,51.16h81.754v-126.61h92.299v126.61h81.755c28.251,0,51.159-22.907,51.159-51.159V306.79c0-3.713-1.465-7.271-4.085-9.877L257.561,131.836z"/></svg>
          </button>
        )}
      </div>

      <div className="top-nav__tabs">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            className={`top-nav__tab ${id === activeTab ? 'top-nav__tab--active' : ''}`}
            onClick={() => onTabChange(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="top-nav__actions">
        <button
          className={`top-nav__settings${isSettingsActive ? ' top-nav__settings--active' : ''}`}
          onClick={() => onTabChange(isSettingsActive ? 'create' : 'settings')}
          title="Settings"
          aria-label="Open app settings"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </nav>
  );
}
