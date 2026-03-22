

interface StatusIndicatorProps {
  status: 'idle' | 'running' | 'error';
}

const STATUS_CONFIG = {
  idle: { color: 'var(--success)', animation: 'pulse-slow 2.4s ease-in-out infinite', label: 'Idle' },
  running: { color: 'var(--accent)', animation: 'pulse-fast 0.6s ease-in-out infinite', label: 'Running' },
  error: { color: 'var(--error)', animation: 'none', label: 'Error' },
} as const;

export function StatusIndicator({ status }: StatusIndicatorProps) {
  const { color, animation, label } = STATUS_CONFIG[status];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span
        className="status-dot"
        style={{ background: color, animation }}
      />
      <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </span>
    </div>
  );
}
