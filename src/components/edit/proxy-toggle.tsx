import { useState } from 'react';

interface ProxyToggleProps {
  initialValue?: boolean;
  onChange: (useProxies: boolean) => void;
}

export function ProxyToggle({ initialValue = false, onChange }: ProxyToggleProps) {
  const [enabled, setEnabled] = useState(initialValue);

  const handleToggle = () => {
    const next = !enabled;
    setEnabled(next);
    onChange(next);
  };

  return (
    <button
      className="proxy-toggle"
      onClick={handleToggle}
      title={enabled ? 'Using proxy files for playback' : 'Using original files for playback'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '2px 8px',
        fontSize: '11px',
        fontWeight: 500,
        borderRadius: '4px',
        border: `1px solid ${enabled ? 'rgba(126, 211, 33, 0.4)' : 'rgba(255,255,255,0.15)'}`,
        background: enabled ? 'rgba(126, 211, 33, 0.15)' : 'rgba(255,255,255,0.05)',
        color: enabled ? '#7ED321' : 'rgba(255,255,255,0.5)',
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      <span style={{ fontSize: '8px' }}>{enabled ? '\u25CF' : '\u25CB'}</span>
      Proxy
    </button>
  );
}
