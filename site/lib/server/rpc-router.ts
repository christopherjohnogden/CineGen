import {
  SiteHttpError,
  errorResponse,
  requireRecord,
  success,
  workspaceIdForRequest,
} from "./common";
import {
  deleteProjectMedia,
  importMedia,
  persistRemoteMedia,
} from "./media-store";
import { createElementsLibraryStore } from "./elements-library-store";
import { createHiggsfieldMcp } from "./higgsfield-mcp";
import { createProjectStore } from "./project-store";
import { hostedChat, hostedOpenAiChat } from "./providers";
import { createRunpodLtx25 } from "./runpod-ltx25";
import { createTopviewMcp } from "./topview-mcp";
import { createWorkspaceProviderVault } from "./workspace-provider-vault";

type RouteParams = { namespace: string; method: string };
type RuntimeEnv = {
  DB: D1Database;
  MEDIA: R2Bucket;
  CINEGEN_HIGGSFIELD_TOKEN_SECRET?: string;
  CINEGEN_TOPVIEW_TOKEN_SECRET?: string;
  CINEGEN_WORKSPACE_PROVIDER_SECRET?: string;
};

function unavailable(capability: string): never {
  throw new SiteHttpError(
    422,
    `${capability} needs the CineGen desktop app or a separate compute server.`,
    "CAPABILITY_UNAVAILABLE",
  );
}

export async function handleRpc(
  request: Request,
  params: RouteParams,
  runtimeEnv: RuntimeEnv,
): Promise<Response> {
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 16 * 1024 * 1024) {
      throw new SiteHttpError(413, "Project update is too large.", "BODY_TOO_LARGE");
    }
    const workspaceId = workspaceIdForRequest(request);
    const body = requireRecord(await request.json(), "RPC request");
    const args = Array.isArray(body.args) ? body.args : [];
    const store = createProjectStore(runtimeEnv.DB, workspaceId);
    const elementsLibrary = createElementsLibraryStore(runtimeEnv.DB, workspaceId);
    const higgsfield = createHiggsfieldMcp(runtimeEnv, workspaceId, new URL(request.url).origin);
    const runpodLtx25 = createRunpodLtx25(runtimeEnv, workspaceId, new URL(request.url).origin);
    const topview = createTopviewMcp(runtimeEnv, workspaceId, new URL(request.url).origin);
    const providerVault = createWorkspaceProviderVault(runtimeEnv, workspaceId);
    const operation = `${params.namespace}.${params.method}`;
    let result: unknown;

    const withSharedSecret = async (
      value: unknown,
      field: string,
      provider: "fal" | "openai" | "kie" | "runpod" | "huggingface",
    ): Promise<Record<string, unknown>> => {
      const input = requireRecord(value ?? {}, `${provider} parameters`);
      return { ...input, [field]: await providerVault.resolve(provider, input[field]) };
    };

    const withRunpodSecrets = async (value: unknown, includeHuggingFace = false): Promise<Record<string, unknown>> => {
      const input = await withSharedSecret(value, "runpodKey", "runpod");
      if (!includeHuggingFace) return input;
      return { ...input, huggingFaceToken: await providerVault.resolve("huggingface", input.huggingFaceToken) };
    };

    switch (operation) {
      case "project.list":
        result = await store.list();
        break;
      case "project.create":
        result = store.legacySnapshot(await store.create(args[0]));
        break;
      case "project.load":
        result = store.legacySnapshot(await store.load(args[0]));
        break;
      case "project.save": {
        const current = await store.load(args[0]);
        const updates = requireRecord(args[1] ?? {}, "Project update");
        result = store.legacySnapshot(await store.save(args[0], {
          ...current,
          ...updates,
          project: { ...current.project, ...requireRecord(updates.project ?? {}, "Project metadata") },
        }));
        break;
      }
      case "project.delete":
      case "db.deleteProject": {
        const id = await store.delete(args[0]);
        await deleteProjectMedia(runtimeEnv.MEDIA, workspaceId, id);
        result = undefined;
        break;
      }
      case "db.createProject":
        result = await store.create(args[0]);
        break;
      case "db.loadProject":
        result = await store.load(args[0]);
        break;
      case "db.saveProject":
        await store.save(args[0], args[1]);
        result = undefined;
        break;
      case "db.closeProject":
        result = undefined;
        break;
      case "db.updateProject":
        await store.patchProject(args[0], args[1]);
        result = undefined;
        break;
      case "db.insertAsset":
        result = await store.insertAsset(args[0]);
        break;
      case "db.updateAsset":
        await store.updateAsset(args[0], args[1], args[2]);
        result = undefined;
        break;
      case "db.deleteAsset":
        await store.deleteAsset(args[0], args[1]);
        result = undefined;
        break;
      case "media.import":
        result = await importMedia(args[0], runtimeEnv.MEDIA, workspaceId, (id) => store.load(id));
        break;
      case "media.queueProcessing": {
        const job = requireRecord(args[0], "Media processing parameters");
        result = {
          browserReady: true,
          assetId: job.assetId,
          inputPath: job.inputPath,
          includeThumbnail: job.includeThumbnail,
          includeWaveform: job.includeWaveform,
          includeFilmstrip: job.includeFilmstrip,
          needsProxy: job.needsProxy,
        };
        break;
      }
      case "media.cancelJob":
        result = undefined;
        break;
      case "elements.loadLibrary":
        result = await elementsLibrary.load(args[0]);
        break;
      case "elements.saveLibrary":
        result = await elementsLibrary.save(args[0]);
        break;
      case "media.persistGeneratedAsset":
      case "media.downloadRemote":
        result = await persistRemoteMedia(args[0], runtimeEnv.MEDIA, workspaceId, (id) => store.load(id));
        break;
      case "llm.chat":
        result = await hostedChat(await withSharedSecret(args[0], "apiKey", "fal"));
        break;
      case "llm.openaiChat":
        result = await hostedOpenAiChat(await withSharedSecret(args[0], "apiKey", "openai"));
        break;
      case "providers.status":
        result = await providerVault.status();
        break;
      case "providers.save":
        result = await providerVault.save(args[0]);
        break;
      case "providers.remove":
        result = await providerVault.remove(args[0]);
        break;
      case "llm.localModels":
        result = [];
        break;
      case "llm.cliDetect":
        result = {
          providers: [
            { id: "claude-code", installed: false },
            { id: "codex", installed: false },
            { id: "gemini", installed: false },
          ],
        };
        break;
      case "llm.claudeCodeDetect":
        result = { installed: false };
        break;
      case "llm.claudeCodeCancel":
      case "llm.codexCancel":
      case "llm.geminiCancel":
        result = undefined;
        break;
      case "higgsfield.accountStatus":
        result = await higgsfield.accountStatus();
        break;
      case "topview.accountStatus":
        result = await topview.accountStatus();
        break;
      case "artlist.accountStatus":
        result = {
          connected: false,
          configured: false,
          setupRequired: true,
          setupMessage: "Artlist currently limits its generation MCP to approved clients. CineGen can connect here after Artlist issues us web access.",
        };
        break;
      case "sam3.getPort":
        result = { port: 0, running: false, baseUrl: null };
        break;
      case "localModel.get":
      case "localModel.readTranscript":
      case "transcription.get":
        result = null;
        break;
      case "pm.openProject":
      case "pm.open":
        result = { ok: true };
        break;
      case "workflow.run":
      case "workflow.pollJob":
      case "pod.start":
      case "pod.stop":
      case "pod.status":
        return unavailable("Hosted generation workflows");
      case "pod.setupLtx25":
        result = await runpodLtx25.setup(await withRunpodSecrets(args[0], true));
        break;
      case "pod.statusLtx25":
        result = await runpodLtx25.status(await withRunpodSecrets(args[0]));
        break;
      case "pod.terminateLtx25":
        result = await runpodLtx25.terminate(await withRunpodSecrets(args[0]));
        break;
      case "pod.generateLtx25":
        result = await runpodLtx25.generate(args[0]);
        break;
      case "pod.generateSessionImage":
        result = await runpodLtx25.generateSessionImage(args[0]);
        break;
      case "export.start":
      case "export.poll":
      case "export.cancel":
        return unavailable("Server-side video export");
      case "media.submitJob":
      case "media.extractFrame":
      case "media.writeTempImage":
      case "media.extractClip":
        return unavailable("FFmpeg media processing");
      case "llm.localChat":
      case "llm.runCutWorkflow":
      case "llm.claudeCodeChat":
      case "llm.codexChat":
      case "llm.geminiChat":
        return unavailable("Computer-installed AI CLIs");
      case "higgsfield.authLogin":
        result = await higgsfield.authLogin(args[0]);
        break;
      case "higgsfield.authLogout":
        await higgsfield.authLogout();
        result = undefined;
        break;
      case "higgsfield.quickEdit":
        result = await higgsfield.quickEdit(args[0]);
        break;
      case "higgsfield.generate":
        result = await higgsfield.generate(args[0]);
        break;
      case "higgsfield.generateList":
        result = await higgsfield.generateList();
        break;
      case "topview.authLogin":
        result = await topview.authLogin(args[0]);
        break;
      case "topview.authLogout":
        await topview.authLogout();
        result = undefined;
        break;
      case "topview.generate":
        result = await topview.generate(args[0]);
        break;
      case "artlist.authLogin":
      case "artlist.authLogout":
      case "artlist.generate":
        return unavailable("Artlist web connection");
      case "sam3.start":
      case "sam3.stop":
      case "localModel.run":
      case "sync.computeOffset":
      case "sync.batchMatch":
      case "transcription.start":
        return unavailable("Local model and media analysis tools");
      case "elements.uploadTranscriptionSource":
      case "elements.uploadMediaSource":
      case "music.generatePrompt":
      case "vision.indexAsset":
      case "vision.detectObjects":
      case "acoustic.analyzeAsset":
      case "copilot.analyzeVisualRefs":
        return unavailable("Hosted media analysis");
      default:
        throw new SiteHttpError(404, `Unknown CineGen operation: ${operation}`, "UNKNOWN_OPERATION");
    }

    return success(result);
  } catch (error) {
    return errorResponse(error);
  }
}
