import { env } from "cloudflare:workers";
import { handleRpc } from "~/lib/server/rpc-router";

export async function POST(
  request: Request,
  context: { params: Promise<{ namespace: string; method: string }> },
) {
  return handleRpc(request, await context.params, env);
}
