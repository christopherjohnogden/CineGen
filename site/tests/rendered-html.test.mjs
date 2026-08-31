import assert from "node:assert/strict";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  return (await import(workerUrl.href)).default;
}

function testEnvironment(overrides = {}) {
  return {
    ASSETS: {
      fetch: async () => new Response("Not found", { status: 404 }),
    },
    ...overrides,
  };
}

class FakeD1Statement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql.replace(/\s+/g, " ").trim();
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async run() {
    if (/^INSERT INTO element_libraries/i.test(this.sql)) {
      const [workspaceId, libraryJson, updatedAt] = this.values;
      this.database.libraries.set(workspaceId, {
        library_json: libraryJson,
        updated_at: updatedAt,
      });
    }
    if (/^INSERT INTO provider_connections/i.test(this.sql)) {
      const [workspaceId, provider] = this.values;
      const [clientJson, pendingCiphertext, tokenCiphertext, updatedAt] = this.values.length === 4
        ? [null, null, this.values[2], this.values[3]]
        : this.values.slice(2);
      this.database.providerConnections.set(`${workspaceId}:${provider}`, {
        client_json: clientJson,
        pending_ciphertext: pendingCiphertext,
        token_ciphertext: tokenCiphertext,
        updated_at: updatedAt,
      });
    }
    if (/^DELETE FROM provider_connections/i.test(this.sql)) {
      this.database.providerConnections.delete(`${this.values[0]}:${this.values[1]}`);
    }
    return { meta: { changes: 1 } };
  }

  async first() {
    if (/SELECT library_json FROM element_libraries/i.test(this.sql)) {
      return this.database.libraries.get(this.values[0]) ?? null;
    }
    if (/SELECT client_json, pending_ciphertext, token_ciphertext FROM provider_connections/i.test(this.sql)) {
      return this.database.providerConnections.get(`${this.values[0]}:${this.values[1]}`) ?? null;
    }
    if (/SELECT token_ciphertext FROM provider_connections/i.test(this.sql)) {
      return this.database.providerConnections.get(`${this.values[0]}:${this.values[1]}`) ?? null;
    }
    return null;
  }

  async all() {
    if (/SELECT id, name, state_json FROM projects/i.test(this.sql)) {
      return { results: this.database.projects };
    }
    if (/SELECT provider, token_ciphertext, updated_at FROM provider_connections/i.test(this.sql)) {
      const [workspaceId, prefixPattern] = this.values;
      const prefix = String(prefixPattern).replace(/%$/, "");
      return {
        results: [...this.database.providerConnections.entries()]
          .filter(([key]) => key.startsWith(`${workspaceId}:${prefix}`))
          .map(([key, value]) => ({
            provider: key.slice(String(workspaceId).length + 1),
            token_ciphertext: value.token_ciphertext,
            updated_at: value.updated_at,
          })),
      };
    }
    return { results: [] };
  }
}

class FakeD1Database {
  constructor() {
    this.libraries = new Map();
    this.providerConnections = new Map();
    this.projects = [];
  }

  prepare(sql) {
    return new FakeD1Statement(this, sql);
  }
}

const executionContext = {
  waitUntil() {},
  passThroughOnException() {},
};

async function sealProviderToken(value, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(value)),
  ));
  return JSON.stringify({
    version: 1,
    iv: Buffer.from(iv).toString("base64"),
    data: Buffer.from(ciphertext).toString("base64"),
  });
}

test("server-renders the CineGen client boundary", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html", host: "localhost" },
    }),
    testEnvironment(),
    executionContext,
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>CineGen Cloud<\/title>/i);
  assert.match(html, /Loading CineGen/i);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/i);
});

test("sends anonymous hosted visitors through ChatGPT sign-in and preserves the project link", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("https://cinegen-cloud-studio.cogden.chatgpt.site/?project=cloud_demo&storage=db", {
      headers: {
        accept: "text/html",
        host: "cinegen-cloud-studio.cogden.chatgpt.site",
      },
      redirect: "manual",
    }),
    testEnvironment(),
    executionContext,
  );

  assert.equal(response.status, 307);
  assert.equal(
    response.headers.get("location"),
    "/signin-with-chatgpt?return_to=%2F%3Fproject%3Dcloud_demo%26storage%3Ddb",
  );
});

test("opens the hosted app when Sites supplies the signed-in ChatGPT identity", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("https://cinegen-cloud-studio.cogden.chatgpt.site/?project=cloud_demo&storage=db", {
      headers: {
        accept: "text/html",
        host: "cinegen-cloud-studio.cogden.chatgpt.site",
        "oai-authenticated-user-id": "site-user-1",
        "oai-authenticated-user-email": "director@example.com",
      },
    }),
    testEnvironment(),
    executionContext,
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.match(await response.text(), /Loading CineGen/i);
});

test("exposes a lightweight health route", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/health"),
    testEnvironment(),
    executionContext,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    result: { status: "ready", version: 1 },
  });
});

test("shares provider connections with the whole hosted workspace without returning secrets", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  const request = (method, args = []) => worker.fetch(
    new Request(`http://localhost/api/rpc/providers/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ args }),
    }),
    testEnvironment({ DB: database }),
    executionContext,
  );

  const savedResponse = await request("save", [{ provider: "fal", secret: "fal-team-secret" }]);
  assert.equal(savedResponse.status, 200);
  const saved = await savedResponse.json();
  assert.equal(saved.result.scope, "workspace");
  assert.equal(saved.result.providers.find((provider) => provider.id === "fal").connected, true);
  assert.doesNotMatch(JSON.stringify(saved), /fal-team-secret/);

  const statusResponse = await request("status");
  const status = await statusResponse.json();
  assert.equal(status.result.providers.find((provider) => provider.id === "fal").connected, true);
  assert.doesNotMatch(JSON.stringify(status), /ciphertext|fal-team-secret/i);

  const originalFetch = globalThis.fetch;
  const providerAuthorizations = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    providerAuthorizations.push(new Headers(init.headers).get("authorization"));
    if (url === "https://queue.fal.run/openrouter/router") return Response.json({ request_id: "team-chat-1" });
    if (url.endsWith("/status?logs=0")) return Response.json({ status: "COMPLETED" });
    if (url.endsWith("/requests/team-chat-1")) return Response.json({ data: { output: "Team provider works" } });
    throw new Error(`Unexpected provider URL: ${url}`);
  };
  try {
    const chatResponse = await worker.fetch(
      new Request("http://localhost/api/rpc/llm/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ args: [{
          apiKey: "__CINEGEN_TEAM_PROVIDER__",
          messages: [{ role: "user", content: "Hello" }],
        }] }),
      }),
      testEnvironment({ DB: database }),
      executionContext,
    );
    assert.equal(chatResponse.status, 200);
    assert.equal((await chatResponse.json()).result.message, "Team provider works");
    assert.ok(providerAuthorizations.every((value) => value === "Key fal-team-secret"));
  } finally {
    globalThis.fetch = originalFetch;
  }

  const removedResponse = await request("remove", [{ provider: "fal" }]);
  const removed = await removedResponse.json();
  assert.equal(removed.result.providers.find((provider) => provider.id === "fal").connected, false);
});

test("loads and persists the hosted Elements library", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  const request = (method, args) => worker.fetch(
    new Request(`http://localhost/api/rpc/elements/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ args }),
    }),
    testEnvironment({ DB: database }),
    executionContext,
  );

  const loadedResponse = await request("loadLibrary", [{
    projectId: "cloud_test_project",
    projectName: "Test Project",
  }]);
  assert.equal(loadedResponse.status, 200);
  const loaded = await loadedResponse.json();
  assert.equal(loaded.result.version, 1);
  assert.equal(loaded.result.folders[0].sourceProjectId, "cloud_test_project");

  const nextLibrary = {
    ...loaded.result,
    elements: [{
      id: "element-1",
      name: "Hero",
      type: "character",
      description: "Lead character",
      images: [],
      createdAt: "2026-08-26T00:00:00.000Z",
      updatedAt: "2026-08-26T00:00:00.000Z",
      folderId: loaded.result.folders[0].id,
    }],
  };
  const savedResponse = await request("saveLibrary", [nextLibrary]);
  assert.equal(savedResponse.status, 200);
  const saved = await savedResponse.json();
  assert.equal(saved.result.elements[0].name, "Hero");

  const reloadedResponse = await request("loadLibrary", [{
    projectId: "cloud_test_project",
    projectName: "Test Project",
  }]);
  const reloaded = await reloadedResponse.json();
  assert.equal(reloaded.result.elements[0].id, "element-1");
});

test("starts Topview sign-in and completes its asynchronous MCP generation flow", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  const toolCalls = [];
  const uploadedBodies = [];
  let topviewUploadCount = 0;
  let failNextAcceleratedUpload = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://www.topview.ai/mcp_oauth/oauth/register") {
      const registration = JSON.parse(String(init.body));
      assert.deepEqual(registration.redirect_uris, ["http://localhost/api/topview/oauth/callback"]);
      assert.equal(registration.scope, "openid email mcp:tools");
      return Response.json({
        client_id: "topview-test-client",
        client_secret: "topview-test-secret",
        token_endpoint_auth_method: "client_secret_post",
      });
    }
    if (url === "https://mcp.topview.ai/mcp") {
      const message = JSON.parse(String(init.body));
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer topview-access-token");
      if (message.method === "initialize") {
        return Response.json({ jsonrpc: "2.0", id: message.id, result: {} }, {
          headers: { "mcp-session-id": "topview-test-session" },
        });
      }
      if (message.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (message.method === "tools/list") {
        const tool = (name) => ({
          name,
          inputSchema: { type: "object", properties: { req: { type: "object" } } },
        });
        return Response.json({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            tools: [
              tool("topview_list_boards"),
              tool("topview_get_credit"),
              tool("topview_get_generation_config"),
              tool("ta_upload_credential"),
              tool("ta_upload_check_file"),
              tool("topview_generate_image"),
              tool("topview_generate_video"),
              tool("topview_query_task"),
            ],
          },
        });
      }
      if (message.method === "tools/call") {
        const { name, arguments: argumentsValue } = message.params;
        toolCalls.push({ name, arguments: argumentsValue });
        let payload;
        if (name === "topview_list_boards") {
          payload = { code: "200", result: { boards: [{ boardId: "board-1", name: "My First Board", isSystemDefault: true }] } };
        } else if (name === "topview_get_credit") {
          payload = { code: "200", result: { remainCredit: 69.53 } };
        } else if (name === "ta_upload_credential") {
          topviewUploadCount += 1;
          const accelerated = argumentsValue.req.needAccelerateUrl === true;
          payload = {
            code: "200",
            result: {
              fileId: `topview-file-${topviewUploadCount}`,
              uploadUrl: `https://uploads.example.com/${accelerated ? "accelerated-" : "standard-"}topview-file-${topviewUploadCount}`,
            },
          };
        } else if (name === "ta_upload_check_file") {
          payload = { code: "200", result: true };
        } else if (name === "topview_get_generation_config") {
          payload = argumentsValue.req.type === "image"
            ? {
              code: "200",
              result: {
                models: [{
                  displayName: "GPT Image 2",
                  submitModel: "gpt-image-2",
                  preferred: true,
                  defaultSubmitParameters: { aspectRatio: "1:1", resolution: "2K" },
                  requiredSubmitFields: ["model", "prompt", "aspectRatio", "resolution"],
                  submitParameterOptions: {
                    aspectRatio: ["1:1", "16:9"],
                    resolution: ["1K", "2K", "4K"],
                    generateCount: [1, 2, 3, 4],
                  },
                }],
              },
            }
            : {
              code: "200",
              result: {
                modelSelectionPolicy: { preferredSubmitModel: "standard-v2" },
                models: [{
                  displayName: "Standard",
                  submitModel: "standard-v2",
                  preferred: true,
                  defaultSubmitParameters: {
                    aspectRatio: "16:9",
                    resolution: 720,
                    duration: 5,
                    sound: "on",
                  },
                  nativeAudio: true,
                  requiredSubmitFields: ["model", "prompt", "duration", "resolution"],
                  submitParameterOptions: {
                    aspectRatio: ["16:9", "9:16"],
                    resolution: [480, 720],
                    duration: [5, 10, 15],
                    sound: ["on", "off"],
                  },
                }],
              },
            };
        } else if (name === "topview_generate_image") {
          payload = { code: "200", result: { taskId: "topview-image-task-1", status: "init" } };
        } else if (name === "topview_generate_video") {
          payload = { code: "200", result: { taskId: "topview-task-1", status: "init" } };
        } else if (name === "topview_query_task") {
          payload = argumentsValue.req.taskId === "topview-image-task-1"
            ? {
              code: "200",
              result: {
                taskId: "topview-image-task-1",
                status: "success",
                images: [{ status: "success", filePath: "https://cdn.example.com/topview-image-task-1.png" }],
              },
            }
            : {
              code: "200",
              result: {
                taskId: "topview-task-1",
                status: "success",
                boardTaskId: "board-task-1",
                originVideo: {
                  type: "video",
                  format: "mp4",
                  url: "https://api.topview.ai/s/3LHi5jFg",
                  coverUrl: "https://api.topview.ai/s/7PgToOSB",
                },
              },
            };
        } else {
          throw new Error(`Unexpected Topview tool call: ${name}`);
        }
        return Response.json({
          jsonrpc: "2.0",
          id: message.id,
          result: { content: [{ type: "text", text: JSON.stringify(payload) }] },
        });
      }
    }
    if (url === "https://cdn.example.com/topview-image-task-1.png") {
      return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }
    if (/^https:\/\/uploads\.example\.com\/(?:accelerated-|standard-)topview-file-\d+$/.test(url)) {
      assert.equal(init.method, "PUT");
      assert.equal(new Headers(init.headers).get("content-type"), "image/png");
      if (url.includes("/accelerated-") && failNextAcceleratedUpload) {
        failNextAcceleratedUpload = false;
        throw new TypeError("Simulated accelerated upload edge failure");
      }
      uploadedBodies.push(new Uint8Array(await new Response(init.body).arrayBuffer()));
      return new Response(null, { status: 200 });
    }
    throw new Error(`Unexpected external request: ${url}`);
  };

  const environment = testEnvironment({
    DB: database,
    MEDIA: {
      get: async (key) => key === "workspaces/cinegen-local-v1/projects/test/reference.png"
        ? {
          size: 4,
          httpMetadata: { contentType: "image/png" },
          arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
        }
        : null,
    },
  });
  const rpc = (method, args = []) => worker.fetch(
    new Request(`http://localhost/api/rpc/topview/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ args }),
    }),
    environment,
    executionContext,
  );

  try {
    const disconnectedResponse = await rpc("accountStatus");
    assert.equal(disconnectedResponse.status, 200);
    assert.deepEqual((await disconnectedResponse.json()).result, { connected: false, configured: true });

    const loginResponse = await rpc("authLogin", ["http://localhost"]);
    assert.equal(loginResponse.status, 200);
    const login = (await loginResponse.json()).result;
    const authorization = new URL(login.authorizationUrl);
    assert.equal(authorization.origin, "https://www.topview.ai");
    assert.equal(authorization.pathname, "/mcp_oauth/oauth/authorize");
    assert.equal(authorization.searchParams.get("scope"), "openid email mcp:tools");
    assert.equal(authorization.searchParams.get("resource"), "https://mcp.topview.ai");
    assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");

    const connection = database.providerConnections.get("cinegen-local-v1:topview");
    assert.ok(connection.pending_ciphertext);
    assert.doesNotMatch(connection.pending_ciphertext, new RegExp(authorization.searchParams.get("state")));
    const importResponse = await rpc("importTeamConnection", [{
      client: {
        client_id: "topview-desktop-client",
        client_secret: "topview-desktop-secret",
        token_endpoint_auth_method: "client_secret_post",
        redirect_uri: "http://127.0.0.1:53682/oauth/callback",
      },
      token: {
        access_token: "topview-access-token",
        refresh_token: "topview-refresh-token",
        expires_at: Date.now() + 60 * 60 * 1000,
      },
    }]);
    assert.equal(importResponse.status, 200);
    assert.deepEqual((await importResponse.json()).result, {
      connected: true,
      configured: true,
      shared: true,
    });
    const importedConnection = database.providerConnections.get("cinegen-local-v1:topview");
    assert.equal(importedConnection.pending_ciphertext, null);
    assert.doesNotMatch(importedConnection.token_ciphertext, /topview-access-token|topview-refresh-token/);

    const sharedStatusResponse = await rpc("connectionStatus");
    assert.deepEqual((await sharedStatusResponse.json()).result, {
      connected: true,
      configured: true,
      authMode: "oauth",
    });

    const connectedResponse = await rpc("accountStatus");
    assert.deepEqual((await connectedResponse.json()).result, {
      connected: true,
      configured: true,
      authMode: "oauth",
      creditType: "mcp",
      credits: 69.53,
    });

    const submissionResponse = await rpc("submit", [{
      prompt: "A cinematic sunrise over a city",
      model: "Standard",
      durationSec: 10,
      aspectRatio: "9:16",
      resolution: 720,
      generateAudio: true,
    }]);
    assert.equal(submissionResponse.status, 200);
    const submission = (await submissionResponse.json()).result;
    assert.equal(submission.taskId, "topview-task-1");
    assert.equal(submission.taskType, "text_to_video");
    assert.equal(submission.boardId, "board-1");
    assert.equal(submission.status, "init");
    assert.equal(submission.pending, true);

    const generationResponse = await rpc("query", [submission]);
    assert.equal(generationResponse.status, 200);
    const generation = (await generationResponse.json()).result;
    assert.equal(generation.url, "https://api.topview.ai/s/3LHi5jFg");
    assert.deepEqual(generation.urls, ["https://api.topview.ai/s/3LHi5jFg"]);
    assert.equal(generation.mediaType, "video");
    assert.equal(generation.taskId, "topview-task-1");
    assert.equal(generation.model, "standard-v2");
    assert.equal(generation.durationSec, 10);
    assert.equal(generation.status, "success");
    assert.equal(generation.pending, false);
    assert.equal(generation.boardUrl, "https://www.topview.ai/board/board-1?boardResultId=board-task-1");

    const configCall = toolCalls.find((entry) => entry.name === "topview_get_generation_config");
    assert.deepEqual(configCall.arguments, { req: { type: "video", taskType: "text_to_video" } });
    const submitCall = toolCalls.find((entry) => entry.name === "topview_generate_video");
    assert.equal(submitCall.arguments.req.taskType, "text_to_video");
    assert.equal(submitCall.arguments.req.model, "standard-v2");
    assert.equal(submitCall.arguments.req.duration, 10);
    assert.equal(submitCall.arguments.req.aspectRatio, "9:16");
    assert.equal(submitCall.arguments.req.sound, "on");
    assert.equal(submitCall.arguments.req.generatingCount, 1);
    assert.equal(submitCall.arguments.req.boardId, "board-1");
    assert.match(submitCall.arguments.req.prompt, /^A cinematic sunrise over a city/);
    const queryCall = toolCalls.find((entry) => entry.name === "topview_query_task");
    assert.deepEqual(queryCall.arguments, {
      req: { taskType: "text_to_video", taskId: "topview-task-1", needCloudFrontUrl: true },
    });

    const omniResponse = await rpc("generate", [{
      prompt: "The actor walks through the room",
      outputType: "video",
      taskType: "omni_reference",
      model: "Standard",
      durationSec: 5,
      resolution: 720,
      medias: [{ value: "topview-file:identity-reference-1", role: "image" }],
    }]);
    assert.equal(omniResponse.status, 200);
    const omniSubmitCall = toolCalls.find((entry) => (
      entry.name === "topview_generate_video" && entry.arguments.req.taskType === "omni_reference"
    ));
    assert.deepEqual(omniSubmitCall.arguments.req.inputImages, [
      { fileId: "identity-reference-1", name: "Image1" },
    ]);
    assert.match(omniSubmitCall.arguments.req.prompt, /<<<Image1>>> is an authoritative visual identity and appearance reference\./);
    assert.match(omniSubmitCall.arguments.req.prompt, /The actor walks through the room/);

    const imageResponse = await rpc("generate", [{
      prompt: "Place the subject in a moonlit forest",
      outputType: "image",
      model: "GPT Image 2",
      aspectRatio: "16:9",
      resolution: "2K",
      medias: [{ value: "/media/projects/test/reference.png", role: "image" }],
    }]);
    assert.equal(imageResponse.status, 200);
    const image = (await imageResponse.json()).result;
    assert.equal(image.url, "https://cdn.example.com/topview-image-task-1.png");
    assert.equal(image.mediaType, "image");
    assert.equal(image.taskType, "image_edit");
    assert.equal(image.model, "gpt-image-2");
    assert.equal(image.referenceValue, "topview-file:topview-file-3");
    assert.equal(uploadedBodies.length, 2);
    assert.deepEqual([...uploadedBodies[0]], [137, 80, 78, 71]);
    assert.deepEqual([...uploadedBodies[1]], [137, 80, 78, 71, 13, 10, 26, 10]);

    const imageConfigCall = toolCalls.find((entry) => (
      entry.name === "topview_get_generation_config" && entry.arguments.req.type === "image"
    ));
    assert.deepEqual(imageConfigCall.arguments, { req: { type: "image", taskType: "image_edit" } });
    const credentialCalls = toolCalls.filter((entry) => entry.name === "ta_upload_credential");
    assert.deepEqual(credentialCalls.map((entry) => entry.arguments), [
      { req: { format: "png", needAccelerateUrl: true } },
      { req: { format: "png", needAccelerateUrl: false } },
      { req: { format: "png", needAccelerateUrl: true } },
    ]);
    const imageSubmitCall = toolCalls.find((entry) => entry.name === "topview_generate_image");
    assert.equal(imageSubmitCall.arguments.req.taskType, "image_edit");
    assert.deepEqual(imageSubmitCall.arguments.req.inputImageFileIds, ["topview-file-2"]);
    assert.equal(imageSubmitCall.arguments.req.model, "gpt-image-2");
    assert.equal(imageSubmitCall.arguments.req.aspectRatio, "16:9");
    assert.equal(imageSubmitCall.arguments.req.generateCount, 1);

    const logoutResponse = await rpc("authLogout");
    assert.equal(logoutResponse.status, 200);
    const loggedOutResponse = await rpc("accountStatus");
    assert.equal((await loggedOutResponse.json()).result.connected, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("requires the shared desktop MCP connection for hosted Topview", async () => {
  const worker = await loadWorker();
  const database = new FakeD1Database();
  const environment = testEnvironment({
    DB: database,
    MEDIA: {},
    CINEGEN_TOPVIEW_TOKEN_SECRET: "hosted-topview-test-secret",
  });
  const rpc = (method, args = []) => worker.fetch(
    new Request(`https://cinegen-cloud-studio.cogden.chatgpt.site/api/rpc/topview/${method}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "oai-authenticated-user-id": "owner-1",
      },
      body: JSON.stringify({ args }),
    }),
    environment,
    executionContext,
  );
  const loginResponse = await rpc("authLogin", ["https://cinegen-cloud-studio.cogden.chatgpt.site"]);
  assert.equal(loginResponse.status, 409);
  assert.deepEqual(await loginResponse.json(), {
    ok: false,
    error: {
      code: "TOPVIEW_TEAM_MCP_REQUIRED",
      message: "Topview MCP is shared from CineGen Desktop for this hosted workspace. On the owner's Mac, open Settings → Provider and choose Share MCP with team, then refresh this page.",
    },
  });
  assert.equal(database.providerConnections.size, 0);
});
