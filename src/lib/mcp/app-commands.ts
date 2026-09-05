/** App panels register real UI operations here; no arbitrary IPC or code execution. */
type Command = (args: Record<string, unknown>) => Promise<unknown> | unknown;
const commands = new Map<string, Command>();
export function registerMcpCommands(entries: Record<string, Command>): () => void {
  for (const [name, command] of Object.entries(entries)) commands.set(name, command);
  return () => {
    for (const [name, command] of Object.entries(entries)) {
      if (commands.get(name) === command) commands.delete(name);
    }
  };
}
export async function invokeMcpCommand(name: string, args: Record<string, unknown>): Promise<unknown> {
  // Navigation may have just mounted the destination panel. Never silently drop a command.
  const deadline = Date.now() + 5000;
  while (!commands.has(name) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const command = commands.get(name);
  if (!command) throw new Error(`The ${name} controls are not available. Open the corresponding app tab and retry.`);
  return command(args);
}
