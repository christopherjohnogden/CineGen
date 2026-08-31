/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  decodeMediaPath,
  errorResponse,
  success,
  workspaceIdForRequest,
} from "../lib/server/common";
import { serveMedia, uploadMedia } from "../lib/server/media-store";
import { handleRpc } from "../lib/server/rpc-router";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  MEDIA: R2Bucket;
  CINEGEN_HIGGSFIELD_TOKEN_SECRET?: string;
  CINEGEN_TOPVIEW_TOKEN_SECRET?: string;
  CINEGEN_WORKSPACE_PROVIDER_SECRET?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/health") {
      return success({ status: "ready", version: 1 });
    }

    if (request.method === "GET" && url.pathname === "/api/events") {
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

    if (request.method === "POST" && url.pathname === "/api/uploads") {
      try {
        const workspaceId = workspaceIdForRequest(request);
        return success(await uploadMedia(request, env.MEDIA, workspaceId), { status: 201 });
      } catch (error) {
        return errorResponse(error);
      }
    }

    const rpcMatch = /^\/api\/rpc\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (request.method === "POST" && rpcMatch) {
      return handleRpc(request, { namespace: rpcMatch[1], method: rpcMatch[2] }, env);
    }

    if ((request.method === "GET" || request.method === "HEAD") && url.pathname.startsWith("/media/")) {
      try {
        const workspaceId = workspaceIdForRequest(request);
        const parts = url.pathname.slice("/media/".length).split("/");
        return await serveMedia(request, env.MEDIA, workspaceId, decodeMediaPath(parts));
      } catch (error) {
        return errorResponse(error);
      }
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
