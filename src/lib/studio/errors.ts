/**
 * Errors reach a feed card by two routes — thrown out of executeFromNode, or
 * written to result.error inside it — and neither strips Electron's IPC
 * wrapper. The card is where they converge, so the cleanup lives here.
 */

const IPC_WRAPPER = /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i;

/** `Error invoking remote method 'topview:submit': Error: X` → `X`. */
export function cleanIpcError(message: string): string {
  return message.replace(IPC_WRAPPER, '').trim();
}

export type FeedErrorKind = 'auth' | 'other';

export interface FeedError {
  kind: FeedErrorKind;
  message: string;
}

/**
 * An auth failure fails before anything is submitted, so nothing was spent and
 * Retry can only fail the same way. It needs a route to Settings, not a retry.
 */
export function classifyFeedError(raw: string | undefined): FeedError {
  const message = cleanIpcError(raw ?? '') || 'Generation failed.';
  if (/connect your [a-z0-9 ]+ account in settings|connection expired\. connect it again/i.test(message)) {
    return { kind: 'auth', message };
  }
  return { kind: 'other', message };
}
