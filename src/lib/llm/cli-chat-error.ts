/** Electron wraps IPC errors, and CLI failures can contain another JSON error.
 * Keep the human-readable cause without exposing transport envelopes in chat. */
export function cliChatErrorMessage(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error || 'Assistant failed.');
  for (let depth = 0; depth < 6; depth++) {
    message = message.replace(/^Error invoking remote method '[^']+':\s*/i, '')
      .replace(/^Error:\s*/i, '').trim();
    try {
      const value = JSON.parse(message) as unknown;
      if (typeof value === 'string') { message = value; continue; }
      if (value && typeof value === 'object') {
        const row = value as { error?: { message?: string } | string; message?: string };
        const detail = typeof row.error === 'string' ? row.error : row.error?.message ?? row.message;
        if (typeof detail === 'string') { message = detail; continue; }
      }
    } catch { /* Already plain text. */ }
    break;
  }
  if (/model is not supported when using Codex with a ChatGPT account/i.test(message)) {
    return 'That model is unavailable with your ChatGPT account. Choose Codex default and try again.';
  }
  return message || 'Assistant failed. Please try again.';
}
