import { env } from "cloudflare:workers";
import { workspaceIdForRequest } from "~/lib/server/common";
import { handleHiggsfieldCallback } from "~/lib/server/higgsfield-mcp";

export async function GET(request: Request) {
  return handleHiggsfieldCallback(request, env, workspaceIdForRequest(request));
}
