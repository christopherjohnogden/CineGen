import { describe, expect, it } from 'vitest';
import {
  LUNA_LONG_CONTEXT_INPUT_TOKENS,
  formatUsd,
  mergeDirectorLlmSpend,
  parseOpenAiUsage,
  priceOpenAiUsage,
} from '@/lib/llm/openai-usage';

describe('OpenAI Luna spend', () => {
  it('prices each request from the response usage object', () => {
    const parsed = parseOpenAiUsage({
      usage: {
        prompt_tokens: 200_000,
        completion_tokens: 100_000,
        total_tokens: 300_000,
        prompt_tokens_details: { cached_tokens: 0 },
      },
    });
    expect(parsed).toEqual({
      promptTokens: 200_000,
      completionTokens: 100_000,
      totalTokens: 300_000,
      cachedTokens: 0,
      cacheWriteTokens: 0,
    });
    // $0.20/M in + $1.20/M out (short context)
    expect(priceOpenAiUsage(parsed!).cost).toBe(0.16);
  });

  it('bills cached input cheaper and long-context at the 2x/1.5x column', () => {
    expect(priceOpenAiUsage({
      promptTokens: 200_000,
      completionTokens: 0,
      totalTokens: 200_000,
      cachedTokens: 200_000,
      cacheWriteTokens: 0,
    }).cost).toBe(0.004);
    expect(priceOpenAiUsage({
      promptTokens: LUNA_LONG_CONTEXT_INPUT_TOKENS + 1,
      completionTokens: 1_000_000,
      totalTokens: LUNA_LONG_CONTEXT_INPUT_TOKENS + 1_000_001,
      cachedTokens: 0,
      cacheWriteTokens: 0,
    }).cost).toBeCloseTo(((LUNA_LONG_CONTEXT_INPUT_TOKENS + 1) * 0.40 + 1_000_000 * 1.80) / 1_000_000, 8);
  });

  it('accumulates per-request spend', () => {
    const first = priceOpenAiUsage({
      promptTokens: 1000, completionTokens: 500, totalTokens: 1500, cachedTokens: 0, cacheWriteTokens: 0,
    });
    const merged = mergeDirectorLlmSpend(undefined, first);
    const twice = mergeDirectorLlmSpend(merged, first);
    expect(twice.requestCount).toBe(2);
    expect(twice.cost).toBeCloseTo(first.cost * 2, 8);
    expect(twice.lastCost).toBe(first.cost);
    expect(formatUsd(0.0042)).toBe('$0.0042');
  });
});
