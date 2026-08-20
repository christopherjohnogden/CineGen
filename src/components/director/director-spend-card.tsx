import type { DirectorShow } from '@/types/director';
import { formatUsd, spendTitle } from '@/lib/llm/openai-usage';

function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.round(value)));
}

export function DirectorSpendCard({ spend }: { spend: DirectorShow['llmSpend'] }) {
  const tokens = (spend?.promptTokens ?? 0) + (spend?.completionTokens ?? 0);
  const title = spend && spend.requestCount > 0
    ? spendTitle(spend)
    : "OpenAI Luna spend for this show. Priced from each response's token counts at official Luna rates.";
  return (
    <div className="director-tab__rail-spend" title={title}>
      <div className="copilot__sidebar-usage">
        <div className="copilot__sidebar-usage-row">
          <span>Spend</span>
          <span className="copilot__sidebar-usage-val copilot__sidebar-usage-val--accent">{formatUsd(spend?.cost ?? 0)}</span>
        </div>
        <div className="copilot__sidebar-usage-row">
          <span>Tokens</span>
          <span className="copilot__sidebar-usage-val">{formatCount(tokens)}</span>
        </div>
        <div className="copilot__sidebar-usage-row">
          <span>Requests</span>
          <span className="copilot__sidebar-usage-val">{formatCount(spend?.requestCount ?? 0)}</span>
        </div>
      </div>
    </div>
  );
}
