import { env } from "cloudflare:workers";
import { workspaceIdForRequest } from "~/lib/server/common";
import { handleTopviewCallback } from "~/lib/server/topview-mcp";

export async function GET(request: Request) {
  return handleTopviewCallback(request, env, workspaceIdForRequest(request));
}
