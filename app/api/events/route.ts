import { errorResponse, workspaceIdForRequest } from "~/lib/server/common";

export async function GET(request: Request) {
  try {
    workspaceIdForRequest(request);
    return new Response("retry: 30000\n: CineGen cloud event bridge ready\n\n", {
      headers: {
        "Cache-Control": "no-cache, no-transform",
        "Content-Type": "text/event-stream; charset=utf-8",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
