import type { DirectorLlmSpend } from '@/types/director';

/** Official GPT-5.6 Luna rates (USD / 1M tokens). Requests over 272k input
 *  tokens bill the whole call at the long-context column. */
export const LUNA_LONG_CONTEXT_INPUT_TOKENS = 272_000;

export const LUNA_RATES_PER_MILLION = {
  short: { input: 0.20, cached: 0.02, cacheWrite: 0.25, output: 1.20 },
  long: { input: 0.40, cached: 0.04, cacheWrite: 0.50, output: 1.80 },
} as const;

export interface OpenAiTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
}

export interface OpenAiPricedUsage extends OpenAiTokenUsage {
  cost: number;
}

function finiteCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

export function parseOpenAiUsage(payload: unknown): OpenAiTokenUsage | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const usage = (payload as Record<string, unknown>).usage;
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return undefined;
  const record = usage as Record<string, unknown>;
  const details = record.prompt_tokens_details && typeof record.prompt_tokens_details === 'object'
    && !Array.isArray(record.prompt_tokens_details)
    ? record.prompt_tokens_details as Record<string, unknown>
    : {};
  const promptTokens = finiteCount(record.prompt_tokens ?? record.input_tokens);
  const completionTokens = finiteCount(record.completion_tokens ?? record.output_tokens);
  const cachedTokens = finiteCount(details.cached_tokens);
  const cacheWriteTokens = finiteCount(details.cache_write_tokens);
  const totalTokens = finiteCount(record.total_tokens) || promptTokens + completionTokens;
  if (promptTokens <= 0 && completionTokens <= 0 && totalTokens <= 0) return undefined;
  return { promptTokens, completionTokens, totalTokens, cachedTokens, cacheWriteTokens };
}

export function priceOpenAiUsage(usage: OpenAiTokenUsage): OpenAiPricedUsage {
  const rates = usage.promptTokens > LUNA_LONG_CONTEXT_INPUT_TOKENS
    ? LUNA_RATES_PER_MILLION.long
    : LUNA_RATES_PER_MILLION.short;
  const cached = Math.min(usage.cachedTokens, usage.promptTokens);
  const writes = Math.min(usage.cacheWriteTokens, Math.max(0, usage.promptTokens - cached));
  const uncached = Math.max(0, usage.promptTokens - cached - writes);
  const cost = (
    uncached * rates.input
    + cached * rates.cached
    + writes * rates.cacheWrite
    + usage.completionTokens * rates.output
  ) / 1_000_000;
  return { ...usage, cost: Math.round(cost * 1e8) / 1e8 };
}

export function directorLlmSpendFrom(value: unknown): DirectorLlmSpend | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const requestCount = Number(record.requestCount);
  if (!Number.isFinite(requestCount) || requestCount < 1) return undefined;
  return {
    cost: Number(record.cost) || 0,
    promptTokens: Number(record.promptTokens) || 0,
    completionTokens: Number(record.completionTokens) || 0,
    cachedTokens: Number(record.cachedTokens) || 0,
    requestCount: Math.floor(requestCount),
    lastCost: Number(record.lastCost) || 0,
  };
}

export function mergeDirectorLlmSpend(
  base: DirectorLlmSpend | undefined,
  extra: OpenAiPricedUsage,
): DirectorLlmSpend {
  return {
    cost: (base?.cost ?? 0) + extra.cost,
    promptTokens: (base?.promptTokens ?? 0) + extra.promptTokens,
    completionTokens: (base?.completionTokens ?? 0) + extra.completionTokens,
    cachedTokens: (base?.cachedTokens ?? 0) + extra.cachedTokens,
    requestCount: (base?.requestCount ?? 0) + 1,
    lastCost: extra.cost,
  };
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

export function spendTitle(spend: DirectorLlmSpend): string {
  const cached = spend.cachedTokens > 0 ? ` · ${spend.cachedTokens.toLocaleString()} cached` : '';
  const last = spend.lastCost > 0 ? ` Last request ${formatUsd(spend.lastCost)}.` : '';
  return `OpenAI Luna: ${formatUsd(spend.cost)} across ${spend.requestCount} request${spend.requestCount === 1 ? '' : 's'} (${spend.promptTokens.toLocaleString()} in${cached} / ${spend.completionTokens.toLocaleString()} out).${last} Priced from each response's token counts at official Luna rates.`;
}
