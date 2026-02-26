export function formatDateTime(isoDate: string): string {
  return new Date(isoDate).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`
}
