/** Let Codex choose its account-compatible default. Also migrate the old
 * CineGen default sent by saved chats or an older renderer. Explicit model
 * choices (including Luna) remain explicit. */
export function codexModelOverride(model?: string): string | undefined {
  const value = model?.trim();
  return !value || value === 'auto' || value === 'gpt-5.3-codex' ? undefined : value;
}
