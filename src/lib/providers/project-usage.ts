import type { VideoGenerationProvider } from '@/lib/utils/video-generation-provider';

export interface ProviderProjectUsage {
  connected?: boolean;
  creditsRemaining?: number;
  creditsUsed: number;
  lastObservedCredits?: number;
  updatedAt?: string;
}

export type ProjectProviderUsage = Partial<Record<VideoGenerationProvider, ProviderProjectUsage>>;

export interface ProviderBalanceObservation {
  provider: VideoGenerationProvider;
  connected?: boolean;
  credits?: number;
  observedAt?: string;
}

function finiteNonNegative(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

export function normalizeProjectProviderUsage(value: unknown): ProjectProviderUsage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const result: ProjectProviderUsage = {};
  for (const provider of ['topview', 'higgsfield', 'artlist', 'runpod'] as const) {
    const raw = source[provider];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    const creditsRemaining = finiteNonNegative(record.creditsRemaining);
    const lastObservedCredits = finiteNonNegative(record.lastObservedCredits);
    result[provider] = {
      ...(typeof record.connected === 'boolean' ? { connected: record.connected } : {}),
      ...(creditsRemaining !== undefined ? { creditsRemaining } : {}),
      creditsUsed: finiteNonNegative(record.creditsUsed) ?? 0,
      ...(lastObservedCredits !== undefined ? { lastObservedCredits } : {}),
      ...(typeof record.updatedAt === 'string' ? { updatedAt: record.updatedAt } : {}),
    };
  }
  return result;
}

export function observeProviderBalance(
  usage: ProjectProviderUsage,
  observation: ProviderBalanceObservation,
): ProjectProviderUsage {
  const current = usage[observation.provider] ?? { creditsUsed: 0 };
  const credits = finiteNonNegative(observation.credits);
  const previous = finiteNonNegative(current.lastObservedCredits);
  const charged = credits !== undefined && previous !== undefined && credits < previous
    ? previous - credits
    : 0;
  const next: ProviderProjectUsage = {
    ...current,
    ...(typeof observation.connected === 'boolean' ? { connected: observation.connected } : {}),
    creditsUsed: (finiteNonNegative(current.creditsUsed) ?? 0) + charged,
    ...(credits !== undefined ? { creditsRemaining: credits, lastObservedCredits: credits } : {}),
    updatedAt: observation.observedAt ?? new Date().toISOString(),
  };

  const unchanged = current.connected === next.connected
    && current.creditsRemaining === next.creditsRemaining
    && current.lastObservedCredits === next.lastObservedCredits
    && current.creditsUsed === next.creditsUsed;
  if (unchanged) return usage;
  return { ...usage, [observation.provider]: next };
}

export function requestProviderUsageRefresh(provider?: VideoGenerationProvider): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('cinegen:provider-usage-refresh', {
    detail: provider ? { provider } : undefined,
  }));
}
