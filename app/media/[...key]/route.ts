import { env } from "cloudflare:workers";
import {
  decodeMediaPath,
  errorResponse,
  workspaceIdForRequest,
} from "~/lib/server/common";
import { serveMedia } from "~/lib/server/media-store";

async function handle(
  request: Request,
  context: { params: Promise<{ key: string[] }> },
) {
  try {
    const workspaceId = workspaceIdForRequest(request);
    const { key } = await context.params;
    return await serveMedia(request, env.MEDIA, workspaceId, decodeMediaPath(key));
  } catch (error) {
    return errorResponse(error);
  }
}

export const GET = handle;
export const HEAD = handle;
