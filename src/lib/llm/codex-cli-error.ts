/** Codex json-jobs inherit ~/.codex/config.toml MCP servers and dump their
 *  fatals into stderr even when the real failure is a ChatGPT quota. Keep the
 *  user-facing error to the line that matters. */
export function compactCodexCliError(stderr: string, exitCode?: number | null): string {
  const text = stderr.replace(/\u001b\[[0-9;]*m/g, '').replace(/\r/g, '').trim();
  const usage = text.match(/You've hit your usage limit\.[^\n]*/i);
  if (usage) {
    return `${usage[0].trim()} Luna and Codex share your ChatGPT Codex quota — pick fal.ai in the LLM picker, or wait for the reset.`;
  }
  const cleaned = text
    .split('\n')
    .filter((line) => {
      const row = line.trim();
      if (!row) return false;
      if (/^Reading additional input from stdin/i.test(row)) return false;
      if (/codex_models_manager::cache/i.test(row)) return false;
      if (/rmcp::transport/i.test(row)) return false;
      if (/AuthRequiredError|AuthRequired\(/i.test(row)) return false;
      return true;
    })
    .join('\n')
    .trim();
  return cleaned || `Codex exited with code ${exitCode ?? 'unknown'}`;
}
