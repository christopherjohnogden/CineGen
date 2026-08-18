import { env } from "cloudflare:workers";
import { errorResponse, success, workspaceIdForRequest } from "~/lib/server/common";
import { uploadMedia } from "~/lib/server/media-store";

export async function POST(request: Request) {
  try {
    const workspaceId = workspaceIdForRequest(request);
    const result = await uploadMedia(request, env.MEDIA, workspaceId);
    return success(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
