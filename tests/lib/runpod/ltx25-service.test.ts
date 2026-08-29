import { describe, expect, it, vi } from 'vitest';
import { inflateSync } from 'node:zlib';
import {
  DEFAULT_LTX25_GPU_PROFILE,
  getRunpodLtx25Status,
  LTX25_GPU_PROFILES,
  LTX25_WORKER_IMAGE,
  runRunpodLtx25Job,
  runRunpodSessionImageJob,
  setupRunpodLtx25,
} from '@/lib/runpod/ltx25-service';

const RUNPOD_GRAPHQL_URL = 'https://api.runpod.io/graphql';
const RUNPOD_PODS_URL = 'https://rest.runpod.io/v1/pods';
const RUNPOD_POD_LOGS_URL = 'https://api.runpod.io/v2/pods/pod-123/logs';
const EXPECTED_LTX25_IMAGE = 'notrius/ltx-2.5-serverless:cu130@sha256:73d1621ef915ae6a149f2a32f6c317dfc89f12075ed4b3abd7df707420267205';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestBody(init?: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

function logResponse(lines: Array<{ source: 'system' | 'container'; line: string }>): Response {
  const body = lines.map((entry, index) => [
    `id: 2026-08-26T12:00:0${index}Z`,
    `data: ${JSON.stringify({ ...entry, ts: `2026-08-26T12:00:0${index}Z` })}`,
    '',
  ].join('\n')).join('\n');
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('shared RunPod LTX-2.5 service', () => {
  it('creates a secure, temporary Pod whose gateway and credentials are protected', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let secretNumber = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.startsWith(RUNPOD_GRAPHQL_URL)) {
        secretNumber += 1;
        return jsonResponse({
          data: { secretCreate: { id: `secret-${secretNumber}`, name: `secret-${secretNumber}` } },
        });
      }
      if (url === RUNPOD_PODS_URL) {
        return jsonResponse({
          id: 'pod-123',
          desiredStatus: 'RUNNING',
          adjustedCostPerHr: 1.25,
          gpu: { displayName: 'NVIDIA RTX PRO 6000 Blackwell Server Edition' },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as unknown as typeof fetch;

    const result = await setupRunpodLtx25({
      runpodKey: 'rp_test_key',
      huggingFaceToken: 'hf_testToken123',
    }, fetchImpl);

    const podCall = calls.find(({ url }) => url === RUNPOD_PODS_URL);
    expect(podCall).toBeDefined();
    expect(podCall?.init?.headers).toMatchObject({
      Authorization: 'Bearer rp_test_key',
      'Content-Type': 'application/json',
    });
    const podBody = requestBody(podCall?.init);
    expect(LTX25_WORKER_IMAGE).toBe(EXPECTED_LTX25_IMAGE);
    expect(podBody).toMatchObject({
      cloudType: 'SECURE',
      computeType: 'GPU',
      imageName: LTX25_WORKER_IMAGE,
      gpuCount: 1,
      containerDiskInGb: 120,
      volumeInGb: 0,
      ports: ['8000/http'],
      supportPublicIp: true,
      interruptible: false,
      dockerEntrypoint: [],
      gpuTypePriority: 'custom',
      minRAMPerGPU: 64,
      minVCPUPerGPU: 8,
    });
    expect(podBody.gpuTypeIds).toEqual(expect.arrayContaining([
      'NVIDIA RTX PRO 6000 Blackwell Server Edition',
    ]));
    expect(podBody.env).toMatchObject({
      RUN_MODE: 'local-api',
      PERSIST_WORKSPACE: 'false',
      CINEGEN_GPU_PROFILE: 'balanced',
      HUGGINGFACE_ACCESS_TOKEN: expect.stringMatching(/^\{\{ RUNPOD_SECRET_cinegen_ltx25_hf_/),
      CINEGEN_POD_TOKEN: expect.stringMatching(/^\{\{ RUNPOD_SECRET_cinegen_ltx25_session_/),
    });

    const startCommand = (podBody.dockerStartCmd as string[])[2];
    expect(startCommand).toContain('self.headers.get("Authorization") == "Bearer " + TOKEN');
    expect(startCommand).toContain('COMFY = "http://127.0.0.1:8188"');
    expect(startCommand).toContain('json_request(COMFY + "/prompt", {"prompt": workflow}');
    expect(startCommand).toContain('history_error(history)');
    expect(startCommand).not.toContain('base64.b64encode(path.read_bytes())');
    expect(startCommand).toContain('ARTIFACT_CHUNK_BYTES = 1024 * 1024');
    expect(startCommand).toContain('ARTIFACT_TTL_SECONDS = 2 * 60 * 60');
    expect(startCommand).toContain('store_artifact(job_id, path, media_type)');
    expect(startCommand).toContain('"apiVersion": 2');
    expect(startCommand).toContain('"artifactChunks": True');
    expect(startCommand).toContain('"idempotentSubmissions": True');
    expect(startCommand).toContain('requested_job_id = job_input.get("cinegen_job_id")');
    expect(startCommand).toContain('existing = jobs.get(job_id)');
    expect(startCommand).toContain('if created:');
    expect(startCommand).toContain('KEEP_MODELS_WARM = GPU_PROFILE == "performance" and GPU_MEMORY_MIB >= 120 * 1024');
    expect(startCommand).toContain('last_model_family != task and not KEEP_MODELS_WARM');
    expect(startCommand).toContain('parsed.path.startswith("/artifact/")');
    expect(startCommand).toContain('def do_DELETE(self):');
    expect(startCommand).toContain('threading.Thread(target=cleanup_loop, daemon=True).start()');
    expect(startCommand).not.toContain('TARGET + "/runsync"');
    expect(startCommand).toContain('cinegen_duration_sec');
    expect(startCommand).toContain('"durationSec": duration_sec');
    expect(startCommand).toContain('result["finished_at"] = time.time()');
    expect(startCommand).not.toContain('hf_testToken123');
    expect(startCommand).not.toContain('rp_test_key');
    expect(JSON.stringify(podBody)).not.toContain('hf_testToken123');
    expect(JSON.stringify(podBody)).not.toContain('rp_test_key');

    expect(result).toMatchObject({
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      secretIds: ['secret-1', 'secret-2'],
      status: 'downloading',
      gpuProfile: 'balanced',
      costPerHr: 1.25,
    });
    expect(result.podAuthToken).toMatch(/^[A-Fa-f0-9]{64}$/);
    expect(DEFAULT_LTX25_GPU_PROFILE).toBe('balanced');
  });

  it.each([
    ['economy', ['NVIDIA A40', 'NVIDIA RTX A6000', 'NVIDIA L40', 'NVIDIA L40S', 'NVIDIA RTX 6000 Ada Generation'], 120, 48, 8],
    ['balanced', ['NVIDIA RTX PRO 6000 Blackwell Server Edition', 'NVIDIA RTX PRO 6000 Blackwell Workstation Edition', 'NVIDIA RTX PRO 6000 Blackwell Max-Q Workstation Edition'], 120, 64, 8],
    ['performance', ['NVIDIA B200', 'NVIDIA H200', 'NVIDIA H200 NVL', 'NVIDIA H100 80GB HBM3', 'NVIDIA H100 NVL'], 160, 96, 16],
  ] as const)('maps the %s profile to its bounded GPU and resource priorities', async (
    gpuProfile,
    gpuTypeIds,
    containerDiskInGb,
    minRAMPerGPU,
    minVCPUPerGPU,
  ) => {
    let secretNumber = 0;
    let podBody: Record<string, unknown> | undefined;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(RUNPOD_GRAPHQL_URL)) {
        secretNumber += 1;
        return jsonResponse({
          data: { secretCreate: { id: `secret-${secretNumber}`, name: `secret-${secretNumber}` } },
        });
      }
      if (url === RUNPOD_PODS_URL) {
        podBody = requestBody(init);
        return jsonResponse({ id: 'pod-123', desiredStatus: 'RUNNING' });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as unknown as typeof fetch;

    const result = await setupRunpodLtx25({
      runpodKey: 'rp_test_key',
      huggingFaceToken: 'hf_testToken123',
      gpuProfile,
    }, fetchImpl);

    expect(result.gpuProfile).toBe(gpuProfile);
    expect(podBody).toMatchObject({
      gpuTypeIds: [...gpuTypeIds],
      gpuTypePriority: 'custom',
      containerDiskInGb,
      minRAMPerGPU,
      minVCPUPerGPU,
    });
    expect(LTX25_GPU_PROFILES[gpuProfile]).toMatchObject({
      gpuTypeIds,
      containerDiskInGb,
      minRAMPerGPU,
      minVCPUPerGPU,
    });
  });

  it('rejects an unknown GPU profile before creating secrets or a Pod', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await expect(setupRunpodLtx25({
      runpodKey: 'rp_test_key',
      huggingFaceToken: 'hf_testToken123',
      gpuProfile: 'unbounded' as never,
    }, fetchImpl)).rejects.toMatchObject({
      code: 'INVALID_GPU_PROFILE',
      statusCode: 422,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('removes both temporary secrets when Pod creation fails', async () => {
    const queries: string[] = [];
    let created = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(RUNPOD_GRAPHQL_URL)) {
        const query = String(requestBody(init).query);
        queries.push(query);
        if (query.includes('secretCreate')) {
          created += 1;
          return jsonResponse({ data: { secretCreate: { id: `secret-${created}`, name: `secret-${created}` } } });
        }
        if (query.includes('secretDelete')) return jsonResponse({ data: { secretDelete: true } });
      }
      if (url === RUNPOD_PODS_URL) return jsonResponse({ error: 'No secure GPU is currently available.' }, 503);
      throw new Error(`Unexpected request: ${url}`);
    }) as unknown as typeof fetch;

    await expect(setupRunpodLtx25({
      runpodKey: 'rp_test_key',
      huggingFaceToken: 'hf_testToken123',
    }, fetchImpl)).rejects.toThrow('No secure GPU is currently available.');

    expect(queries.filter((query) => query.includes('secretDelete'))).toEqual(expect.arrayContaining([
      expect.stringContaining('secret-1'),
      expect.stringContaining('secret-2'),
    ]));
    expect(queries.filter((query) => query.includes('secretDelete'))).toHaveLength(2);
  });

  it('deletes a failed Pod and its temporary secrets after a fatal image-pull log', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const deletedSecrets: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === `${RUNPOD_PODS_URL}/pod-123` && init?.method !== 'DELETE') {
        return jsonResponse({
          id: 'pod-123',
          desiredStatus: 'RUNNING',
          adjustedCostPerHr: 1.25,
          gpu: { displayName: 'NVIDIA RTX PRO 6000 Blackwell Server Edition' },
        });
      }
      if (url === 'https://pod-123-8000.proxy.runpod.net/health') {
        return jsonResponse({ ready: false }, 503);
      }
      if (url.startsWith(RUNPOD_POD_LOGS_URL)) {
        return logResponse([
          { source: 'system', line: 'Failed to get Hub registry auth. Is this a template you have access to?' },
          { source: 'system', line: 'No such image: registry.runpod.net/vavo-ltx2-5-serverless-main-dockerfile:26a9e5b7b' },
        ]);
      }
      if (url === `${RUNPOD_PODS_URL}/pod-123` && init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }
      if (url.startsWith(RUNPOD_GRAPHQL_URL)) {
        const query = String(requestBody(init).query);
        const match = /secretDelete\(id: "([^"]+)"\)/.exec(query);
        if (match) deletedSecrets.push(match[1]);
        return jsonResponse({ data: { secretDelete: true } });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as unknown as typeof fetch;

    const result = await getRunpodLtx25Status({
      runpodKey: 'rp_test_key',
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'pod-session-token',
      secretIds: ['secret-1', 'secret-2'],
    }, fetchImpl);

    expect(result).toMatchObject({
      status: 'error',
      phase: 'startup-failed-cleaned',
      costPerHr: null,
    });
    expect(result.message).toContain('deleted the failed Pod');
    expect(result.message).toContain('billing stopped');
    expect(deletedSecrets).toEqual(['secret-1', 'secret-2']);
    expect(calls.find(({ url }) => url.startsWith(RUNPOD_POD_LOGS_URL))?.init?.headers).toMatchObject({
      Authorization: 'Bearer rp_test_key',
      Accept: 'text/event-stream',
    });
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ url: `${RUNPOD_PODS_URL}/pod-123`, init: expect.objectContaining({ method: 'DELETE' }) }),
    ]));
  });

  it('does not delete a Pod for ordinary image download and model initialization logs', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === `${RUNPOD_PODS_URL}/pod-123`) {
        return jsonResponse({ id: 'pod-123', desiredStatus: 'RUNNING', adjustedCostPerHr: 1.25 });
      }
      if (url === 'https://pod-123-8000.proxy.runpod.net/health') {
        return jsonResponse({ ready: false }, 503);
      }
      if (url.startsWith(RUNPOD_POD_LOGS_URL)) {
        return logResponse([
          { source: 'system', line: 'create container: still fetching image' },
          { source: 'system', line: 'still fetching image notrius/ltx-2.5-serverless:cu130 (46%)' },
          { source: 'container', line: 'Downloading model weights: 37 GB / 66 GB' },
          { source: 'container', line: 'Initializing CUDA kernels and loading text encoder' },
        ]);
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as unknown as typeof fetch;

    const result = await getRunpodLtx25Status({
      runpodKey: 'rp_test_key',
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'pod-session-token',
      secretIds: ['secret-1', 'secret-2'],
    }, fetchImpl);

    expect(result).toMatchObject({
      status: 'downloading',
      phase: 'downloading',
      costPerHr: 1.25,
      message: 'Loading the models into the GPU…',
    });
    expect(result.message).not.toContain('CUDA kernels');
    expect(calls.some(({ init }) => init?.method === 'DELETE')).toBe(false);
    expect(calls.some(({ url }) => url.startsWith(RUNPOD_GRAPHQL_URL))).toBe(false);
  });

  it('uses structured 503 health details as safe image-model download progress', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `${RUNPOD_PODS_URL}/pod-123`) {
        return jsonResponse({ id: 'pod-123', desiredStatus: 'RUNNING', adjustedCostPerHr: 1.25 });
      }
      if (url.endsWith('/health')) {
        return jsonResponse({
          ready: false,
          phase: 'downloading-image-models',
          missingModels: ['qwen-image-edit'],
          message: 'do not copy raw provider detail',
        }, 503);
      }
      if (url.startsWith(RUNPOD_POD_LOGS_URL)) return logResponse([]);
      throw new Error(`Unexpected request: ${url}`);
    }) as unknown as typeof fetch;

    const result = await getRunpodLtx25Status({
      runpodKey: 'rp_test_key',
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'pod-session-token',
    }, fetchImpl);

    expect(result).toMatchObject({
      status: 'downloading',
      phase: 'downloading',
      message: 'Downloading Qwen Image Edit for this temporary session…',
    });
    expect(result.message).not.toContain('provider detail');
  });

  it.each([502, 504])('surfaces a private-gateway HTTP %s without treating it as silent downloading', async (status) => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === `${RUNPOD_PODS_URL}/pod-123`) {
        return jsonResponse({ id: 'pod-123', desiredStatus: 'RUNNING', adjustedCostPerHr: 1.25 });
      }
      if (url.endsWith('/health')) {
        return jsonResponse({ error: 'upstream detail must not leak', phase: 'loading-ltx' }, status);
      }
      if (url.startsWith(RUNPOD_POD_LOGS_URL)) return logResponse([]);
      throw new Error(`Unexpected request: ${url}`);
    }) as unknown as typeof fetch;

    const result = await getRunpodLtx25Status({
      runpodKey: 'rp_test_key',
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'pod-session-token',
    }, fetchImpl);

    expect(result).toMatchObject({ status: 'downloading', phase: 'downloading' });
    expect(result.message).toContain(`returned ${status}`);
    expect(result.message).not.toContain('upstream detail');
  });

  it('bounds the health response body and reports a gateway timeout instead of hanging', async () => {
    vi.useFakeTimers();
    let healthSignal: AbortSignal | undefined;
    try {
      const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === `${RUNPOD_PODS_URL}/pod-123`) {
          return jsonResponse({ id: 'pod-123', desiredStatus: 'RUNNING', adjustedCostPerHr: 1.25 });
        }
        if (url.endsWith('/health')) {
          healthSignal = init?.signal ?? undefined;
          return new Response(new ReadableStream<Uint8Array>({ start() {} }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.startsWith(RUNPOD_POD_LOGS_URL)) return logResponse([]);
        throw new Error(`Unexpected request: ${url}`);
      }) as unknown as typeof fetch;

      const pending = getRunpodLtx25Status({
        runpodKey: 'rp_test_key',
        podId: 'pod-123',
        podUrl: 'https://pod-123-8000.proxy.runpod.net',
        podAuthToken: 'pod-session-token',
      }, fetchImpl);
      await vi.advanceTimersByTimeAsync(6_500);
      const result = await pending;

      expect(healthSignal?.aborted).toBe(true);
      expect(result).toMatchObject({ status: 'downloading', phase: 'downloading' });
      expect(result.message).toContain('did not answer within 7 seconds');
    }
    finally {
      vi.useRealTimers();
    }
  });

  it('bounds RunPod REST response bodies instead of waiting forever', async () => {
    vi.useFakeTimers();
    let restSignal: AbortSignal | undefined;
    try {
      const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        restSignal = init?.signal ?? undefined;
        return new Response(new ReadableStream<Uint8Array>({ start() {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as unknown as typeof fetch;

      const pending = getRunpodLtx25Status({
        runpodKey: 'rp_test_key',
        podId: 'pod-123',
        podUrl: 'https://pod-123-8000.proxy.runpod.net',
        podAuthToken: 'pod-session-token',
      }, fetchImpl);
      const assertion = expect(pending).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT', statusCode: 504 });
      await vi.advanceTimersByTimeAsync(15_000);
      await assertion;
      expect(restSignal?.aborted).toBe(true);
    }
    finally {
      vi.useRealTimers();
    }
  });

  it('reports a Pod authentication mismatch explicitly', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === `${RUNPOD_PODS_URL}/pod-123`) {
        return jsonResponse({ id: 'pod-123', desiredStatus: 'RUNNING', adjustedCostPerHr: 1.25 });
      }
      if (url.endsWith('/health')) return jsonResponse({ error: 'Unauthorized' }, 401);
      throw new Error(`Unexpected request: ${url}`);
    }) as unknown as typeof fetch;

    const result = await getRunpodLtx25Status({
      runpodKey: 'rp_test_key',
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'wrong-session-token',
    }, fetchImpl);

    expect(result).toMatchObject({ status: 'error', phase: 'error', costPerHr: 1.25 });
    expect(result.message).toContain('could not authenticate');
    expect(calls.some(({ url }) => url.startsWith(RUNPOD_POD_LOGS_URL))).toBe(false);
    expect(calls.some(({ init }) => init?.method === 'DELETE')).toBe(false);
  });

  it.each([
    ['huggingface-access', 'huggingface_hub.errors.GatedRepoError: Cannot access gated repo'],
    ['huggingface-access', 'GatedRepoError: Unauthorized while accessing the restricted repository on huggingface.co'],
    ['huggingface-access', '401 Client Error: Unauthorized for url: https://huggingface.co/Lightricks/LTX-2.5'],
    ['disk-full', 'OSError: [Errno 28] No space left on device'],
    ['gpu-memory', 'torch.OutOfMemoryError: CUDA out of memory'],
    ['cuda-startup', 'GPU is not available. PyTorch CUDA init failed'],
    ['comfy-startup', 'worker-comfyui: ComfyUI model discovery failed after 120s'],
    ['session-api-startup', 'handler failed to start: address already in use'],
  ])('surfaces the %s application bootstrap failure without deleting the Pod', async (kind, fatalLine) => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === `${RUNPOD_PODS_URL}/pod-123`) {
        return jsonResponse({ id: 'pod-123', desiredStatus: 'RUNNING', adjustedCostPerHr: 1.25 });
      }
      if (url.endsWith('/health')) return jsonResponse({ ready: false, phase: 'loading-ltx' }, 503);
      if (url.startsWith(RUNPOD_POD_LOGS_URL)) {
        return logResponse([{ source: 'container', line: fatalLine }]);
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as unknown as typeof fetch;

    const result = await getRunpodLtx25Status({
      runpodKey: 'rp_test_key',
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'pod-session-token',
      secretIds: ['secret-1', 'secret-2'],
    }, fetchImpl);

    expect(result).toMatchObject({
      status: 'error',
      phase: 'error',
      startupFailure: kind,
      costPerHr: 1.25,
    });
    expect(result.message).toContain('billing');
    expect(result.message).not.toContain(fatalLine);
    expect(calls.some(({ init }) => init?.method === 'DELETE')).toBe(false);
    expect(calls.some(({ url }) => url.startsWith(RUNPOD_GRAPHQL_URL))).toBe(false);
  });

  it('marks a running legacy gateway as needing a session update without deleting it', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === `${RUNPOD_PODS_URL}/pod-123`) {
        return jsonResponse({
          id: 'pod-123',
          desiredStatus: 'RUNNING',
          adjustedCostPerHr: 1.25,
          gpu: { displayName: 'NVIDIA RTX PRO 6000 Blackwell Server Edition' },
        });
      }
      if (url === 'https://pod-123-8000.proxy.runpod.net/health') {
        return jsonResponse({ ready: true });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as unknown as typeof fetch;

    const result = await getRunpodLtx25Status({
      runpodKey: 'rp_test_key',
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'pod-session-token',
      secretIds: ['secret-1', 'secret-2'],
    }, fetchImpl);

    expect(result).toMatchObject({
      status: 'error',
      phase: 'error',
      costPerHr: 1.25,
    });
    expect(result.message).toContain('reliable video-transfer update');
    expect(result.message).toContain('keeps billing');
    expect(calls.some(({ init }) => init?.method === 'DELETE')).toBe(false);
    expect(calls.some(({ url }) => url.startsWith(RUNPOD_POD_LOGS_URL))).toBe(false);
  });

  it.each([
    'Failed to get Hub registry auth. Is this a template you have access to?',
    'No such image: registry.runpod.net/vavo-ltx2-5-serverless-main-dockerfile:26a9e5b7b',
    'error creating container',
  ])('cleans up when RunPod reports the fatal startup line: %s', async (fatalLine) => {
    let deleted = false;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `${RUNPOD_PODS_URL}/pod-123` && init?.method !== 'DELETE') {
        return jsonResponse({ id: 'pod-123', desiredStatus: 'RUNNING', adjustedCostPerHr: 1.25 });
      }
      if (url === 'https://pod-123-8000.proxy.runpod.net/health') {
        return jsonResponse({ ready: false }, 503);
      }
      if (url.startsWith(RUNPOD_POD_LOGS_URL)) {
        return logResponse([{ source: 'system', line: fatalLine }]);
      }
      if (url === `${RUNPOD_PODS_URL}/pod-123` && init?.method === 'DELETE') {
        deleted = true;
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as unknown as typeof fetch;

    const result = await getRunpodLtx25Status({
      runpodKey: 'rp_test_key',
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'pod-session-token',
      secretIds: [],
    }, fetchImpl);

    expect(result.phase).toBe('startup-failed-cleaned');
    expect(deleted).toBe(true);
  });

  it('waits for RunPod to replay the first log line before applying the quiet window', async () => {
    let deleted = false;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `${RUNPOD_PODS_URL}/pod-123` && init?.method !== 'DELETE') {
        return jsonResponse({ id: 'pod-123', desiredStatus: 'RUNNING', adjustedCostPerHr: 1.25 });
      }
      if (url === 'https://pod-123-8000.proxy.runpod.net/health') {
        return jsonResponse({ ready: false }, 503);
      }
      if (url.startsWith(RUNPOD_POD_LOGS_URL)) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            setTimeout(() => {
              controller.enqueue(new TextEncoder().encode([
                'data: {"source":"system","line":"Failed to get Hub registry auth. Is this a template you have access to?"}',
                '',
                '',
              ].join('\n')));
              controller.close();
            }, 250);
          },
        });
        return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      if (url === `${RUNPOD_PODS_URL}/pod-123` && init?.method === 'DELETE') {
        deleted = true;
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as unknown as typeof fetch;

    const result = await getRunpodLtx25Status({
      runpodKey: 'rp_test_key',
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'pod-session-token',
      secretIds: [],
    }, fetchImpl);

    expect(result.phase).toBe('startup-failed-cleaned');
    expect(deleted).toBe(true);
  });

  it('passes the requested duration through submission and completed job output', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/health')) {
        return jsonResponse({
          ready: true,
          apiVersion: 2,
          capabilities: { artifactChunks: true },
        });
      }
      if (url.endsWith('/run')) return jsonResponse({ id: 'job-456', status: 'IN_QUEUE' }, 202);
      if (url.endsWith('/status/job-456')) {
        return jsonResponse({
          id: 'job-456',
          status: 'COMPLETED',
          durationSec: 12,
          finished_at: 123456,
          output: {
            status: 'success',
            output: {
              videos: [{
                type: 'url',
                data: 'https://cdn.example/result.mp4',
                media_type: 'video/mp4',
              }],
            },
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as unknown as typeof fetch;
    const session = {
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'pod-session-token',
    };

    const submitted = await runRunpodLtx25Job({
      ...session,
      input: {
        prompt: 'A locked cinematic close-up',
        durationSec: 12,
        aspectRatio: '16:9',
        resolution: '720p',
      },
    }, fetchImpl);
    const runCall = calls.find(({ url }) => url.endsWith('/run'));
    const runBody = requestBody(runCall?.init) as {
      input: {
        cinegen_job_id: string;
        cinegen_duration_sec: number;
        workflow: Record<string, { inputs: Record<string, unknown> }>;
        images: Array<{ name: string; image: string }>;
      };
    };
    expect(runCall?.init?.headers).toMatchObject({ Authorization: 'Bearer pod-session-token' });
    expect(runBody.input.cinegen_job_id).toMatch(/^[a-f0-9]{32}$/);
    expect(runCall?.init?.headers).toMatchObject({ 'Idempotency-Key': runBody.input.cinegen_job_id });
    expect(runBody.input.cinegen_duration_sec).toBe(12);
    expect(runBody.input.workflow['398:362'].inputs.value).toBe(12);
    expect(runBody.input.workflow['398:363'].inputs.value).toBe(true);
    const placeholder = Buffer.from(runBody.input.images[0].image.split(',', 2)[1], 'base64');
    expect(placeholder.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(placeholder.readUInt32BE(16)).toBe(64);
    expect(placeholder.readUInt32BE(20)).toBe(64);
    expect(placeholder[25]).toBe(2); // PNG truecolor RGB, not the old 1x1 grayscale frame.
    const compressed: Buffer[] = [];
    for (let offset = 8; offset + 12 <= placeholder.length;) {
      const length = placeholder.readUInt32BE(offset);
      const type = placeholder.subarray(offset + 4, offset + 8).toString('ascii');
      if (type === 'IDAT') compressed.push(placeholder.subarray(offset + 8, offset + 8 + length));
      offset += 12 + length;
    }
    const pixels = inflateSync(Buffer.concat(compressed));
    expect(pixels).toHaveLength((64 * 3 + 1) * 64);
    for (let row = 0; row < 64; row += 1) expect(pixels[row * (64 * 3 + 1)]).toBeLessThanOrEqual(4);
    expect(submitted).toMatchObject({ jobId: 'job-456', status: 'queued' });

    const completed = await runRunpodLtx25Job({ ...session, jobId: 'job-456' }, fetchImpl);
    expect(completed).toEqual({
      jobId: 'job-456',
      status: 'completed',
      phase: 'ready',
      output: {
        url: 'https://cdn.example/result.mp4',
        durationSec: 12,
        model: 'LTX-2.5',
      },
    });
  });

  it.each([
    ['16:9', 1920, 1080],
    ['9:16', 1080, 1920],
    ['1:1', 1080, 1080],
  ])('maps a Director 1080p %s request to the LTX workflow dimensions', async (aspectRatio, width, height) => {
    let submittedBody: Record<string, unknown> | undefined;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/health')) {
        return jsonResponse({ ready: true, apiVersion: 2, capabilities: { artifactChunks: true } });
      }
      submittedBody = requestBody(init);
      return jsonResponse({ id: 'job-1080', status: 'IN_QUEUE' }, 202);
    }) as unknown as typeof fetch;

    await runRunpodLtx25Job({
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'pod-session-token',
      input: {
        prompt: 'A cinematic frame rendered at the selected output size.',
        aspectRatio,
        resolution: '1080p',
      },
    }, fetchImpl);

    const workflow = (submittedBody?.input as {
      workflow: Record<string, { inputs: Record<string, unknown> }>;
    }).workflow;
    expect(workflow['398:372'].inputs.value).toBe(width);
    expect(workflow['398:360'].inputs.value).toBe(height);
  });

  it.each([
    ['16:9', 864, 480],
    ['9:16', 480, 864],
    ['1:1', 480, 480],
  ])('maps a Director 480p %s request to model-safe LTX workflow dimensions', async (aspectRatio, width, height) => {
    let submittedBody: Record<string, unknown> | undefined;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/health')) {
        return jsonResponse({ ready: true, apiVersion: 2, capabilities: { artifactChunks: true } });
      }
      submittedBody = requestBody(init);
      return jsonResponse({ id: 'job-480', status: 'IN_QUEUE' }, 202);
    }) as unknown as typeof fetch;

    await runRunpodLtx25Job({
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'pod-session-token',
      input: {
        prompt: 'A cinematic frame rendered quickly at the selected output size.',
        aspectRatio,
        resolution: '480p',
      },
    }, fetchImpl);

    const workflow = (submittedBody?.input as {
      workflow: Record<string, { inputs: Record<string, unknown> }>;
    }).workflow;
    expect(workflow['398:372'].inputs.value).toBe(width);
    expect(workflow['398:360'].inputs.value).toBe(height);
  });

  it('allows a generation upload acknowledgement to take longer than the short status deadline', async () => {
    vi.useFakeTimers();
    let submissionSignal: AbortSignal | undefined;
    let submittedJobId = '';
    try {
      const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/health')) {
          return jsonResponse({
            ready: true,
            apiVersion: 2,
            capabilities: { artifactChunks: true, idempotentSubmissions: true },
          });
        }
        if (url.endsWith('/run')) {
          submissionSignal = init?.signal ?? undefined;
          const body = requestBody(init) as { input: { cinegen_job_id: string } };
          submittedJobId = body.input.cinegen_job_id;
          return await new Promise<Response>((resolve) => {
            setTimeout(() => resolve(jsonResponse({ id: submittedJobId, status: 'IN_QUEUE' }, 202)), 20_000);
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      }) as unknown as typeof fetch;

      const pending = runRunpodLtx25Job({
        podId: 'pod-123',
        podUrl: 'https://pod-123-8000.proxy.runpod.net',
        podAuthToken: 'pod-session-token',
        input: { prompt: 'A long-upload Spaces frame', durationSec: 5 },
      }, fetchImpl);
      await vi.advanceTimersByTimeAsync(20_000);
      const result = await pending;

      expect(submittedJobId).toMatch(/^[a-f0-9]{32}$/);
      expect(submissionSignal?.aborted).toBe(false);
      expect(result).toMatchObject({ jobId: submittedJobId, status: 'queued' });
    }
    finally {
      vi.useRealTimers();
    }
  });

  it('recovers an idempotent job when its submission acknowledgement times out', async () => {
    vi.useFakeTimers();
    let submissionSignal: AbortSignal | undefined;
    let submittedJobId = '';
    let submissions = 0;
    try {
      const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/health')) {
          return jsonResponse({
            ready: true,
            apiVersion: 2,
            capabilities: { artifactChunks: true, idempotentSubmissions: true },
          });
        }
        if (url.endsWith('/run')) {
          submissions += 1;
          submissionSignal = init?.signal ?? undefined;
          submittedJobId = (requestBody(init) as { input: { cinegen_job_id: string } }).input.cinegen_job_id;
          return new Response(new ReadableStream<Uint8Array>({ start() {} }), {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (submittedJobId && url.endsWith(`/status/${submittedJobId}`)) {
          return jsonResponse({ id: submittedJobId, status: 'IN_QUEUE', task: 'ltx-2.5' });
        }
        throw new Error(`Unexpected request: ${url}`);
      }) as unknown as typeof fetch;

      const pending = runRunpodLtx25Job({
        podId: 'pod-123',
        podUrl: 'https://pod-123-8000.proxy.runpod.net',
        podAuthToken: 'pod-session-token',
        input: { prompt: 'Recover this exact paid render', durationSec: 5 },
      }, fetchImpl);
      await vi.advanceTimersByTimeAsync(120_000);
      const result = await pending;

      expect(submissionSignal?.aborted).toBe(true);
      expect(submissions).toBe(1);
      expect(result).toMatchObject({ jobId: submittedJobId, status: 'queued' });
    }
    finally {
      vi.useRealTimers();
    }
  });

  it('retries a timed-out idempotent submission with the same client job ID after a 404 probe', async () => {
    vi.useFakeTimers();
    const submittedJobIds: string[] = [];
    try {
      const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/health')) {
          return jsonResponse({
            ready: true,
            apiVersion: 2,
            capabilities: { artifactChunks: true, idempotentSubmissions: true },
          });
        }
        if (url.endsWith('/run')) {
          const jobId = (requestBody(init) as { input: { cinegen_job_id: string } }).input.cinegen_job_id;
          submittedJobIds.push(jobId);
          if (submittedJobIds.length === 1) {
            return new Response(new ReadableStream<Uint8Array>({ start() {} }), {
              status: 202,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return jsonResponse({ id: jobId, status: 'IN_QUEUE' }, 202);
        }
        if (submittedJobIds[0] && url.endsWith(`/status/${submittedJobIds[0]}`)) {
          return jsonResponse({ error: 'Job not found' }, 404);
        }
        throw new Error(`Unexpected request: ${url}`);
      }) as unknown as typeof fetch;

      const pending = runRunpodLtx25Job({
        podId: 'pod-123',
        podUrl: 'https://pod-123-8000.proxy.runpod.net',
        podAuthToken: 'pod-session-token',
        input: { prompt: 'Retry safely with one identity', durationSec: 5 },
      }, fetchImpl);
      await vi.advanceTimersByTimeAsync(120_000);
      const result = await pending;

      expect(submittedJobIds).toHaveLength(2);
      expect(submittedJobIds[0]).toMatch(/^[a-f0-9]{32}$/);
      expect(submittedJobIds[1]).toBe(submittedJobIds[0]);
      expect(result).toMatchObject({ jobId: submittedJobIds[0], status: 'queued' });
    }
    finally {
      vi.useRealTimers();
    }
  });

  it('blocks a new paid render when the active Pod still uses the legacy inline-video gateway', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/health')) return jsonResponse({ ready: true });
      if (url.endsWith('/run')) return jsonResponse({ id: 'must-not-submit' }, 202);
      throw new Error(`Unexpected request: ${url}`);
    }) as unknown as typeof fetch;

    await expect(runRunpodLtx25Job({
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'pod-session-token',
      input: {
        prompt: 'Do not charge for a render that cannot transfer reliably.',
        durationSec: 5,
      },
    }, fetchImpl)).rejects.toMatchObject({
      code: 'SESSION_UPDATE_REQUIRED',
      statusCode: 409,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://pod-123-8000.proxy.runpod.net/health');
    expect(calls[0].init?.headers).toMatchObject({ Authorization: 'Bearer pod-session-token' });
  });

  it('downloads a completed gateway-v2 artifact in authenticated bounded chunks and cleans it up', async () => {
    const chunkBytes = 1024 * 1024;
    const video = Buffer.alloc(chunkBytes * 2 + 13, 0x5a);
    video.write('ftyp', 4, 'ascii');
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let activeChunkRequests = 0;
    let maxActiveChunkRequests = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/status/job-456')) {
        return jsonResponse({
          id: 'job-456',
          status: 'COMPLETED',
          durationSec: 11,
          output: {
            status: 'success',
            output: {
              artifact: {
                id: 'artifact-456',
                byteSize: video.byteLength,
                mediaType: 'video/mp4',
                chunkSize: chunkBytes,
                expiresAt: 123456,
              },
            },
          },
        });
      }
      const endpoint = new URL(url);
      if (endpoint.pathname === '/artifact/artifact-456' && init?.method !== 'DELETE') {
        activeChunkRequests += 1;
        maxActiveChunkRequests = Math.max(maxActiveChunkRequests, activeChunkRequests);
        await new Promise((resolve) => setTimeout(resolve, 0));
        const offset = Number(endpoint.searchParams.get('offset'));
        const length = Number(endpoint.searchParams.get('length'));
        const data = video.subarray(offset, offset + length);
        const response = jsonResponse({
          id: 'artifact-456',
          offset,
          byteSize: video.byteLength,
          mediaType: 'video/mp4',
          data: data.toString('base64'),
        });
        activeChunkRequests -= 1;
        return response;
      }
      if (endpoint.pathname === '/artifact/artifact-456' && init?.method === 'DELETE') {
        return jsonResponse({ ok: true });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as unknown as typeof fetch;

    const result = await runRunpodLtx25Job({
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'pod-session-token',
      jobId: 'job-456',
    }, fetchImpl);

    expect(result).toMatchObject({
      jobId: 'job-456',
      status: 'completed',
      phase: 'ready',
      output: { mediaType: 'video/mp4', durationSec: 11, model: 'LTX-2.5' },
    });
    expect(Buffer.from(result.output?.data ?? '', 'base64')).toEqual(video);
    expect(maxActiveChunkRequests).toBeGreaterThan(1);
    const chunkCalls = calls.filter(({ url, init }) => url.includes('/artifact/artifact-456?') && init?.method !== 'DELETE');
    expect(chunkCalls.map(({ url }) => {
      const endpoint = new URL(url);
      return [endpoint.searchParams.get('offset'), endpoint.searchParams.get('length')];
    })).toEqual([
      ['0', String(chunkBytes)],
      [String(chunkBytes), String(chunkBytes)],
      [String(chunkBytes * 2), '13'],
    ]);
    for (const call of calls.filter(({ url }) => url.includes('/artifact/artifact-456'))) {
      expect(call.init?.headers).toMatchObject({ Authorization: 'Bearer pod-session-token' });
    }
    expect(calls.at(-1)).toMatchObject({
      url: 'https://pod-123-8000.proxy.runpod.net/artifact/artifact-456',
      init: { method: 'DELETE' },
    });
  });

  it('preserves a gateway artifact for TTL cleanup when a chunk is inconsistent', async () => {
    const video = Buffer.alloc(32, 0x5a);
    video.write('ftyp', 4, 'ascii');
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/status/job-456')) {
        return jsonResponse({
          id: 'job-456',
          status: 'COMPLETED',
          output: { output: { artifact: { id: 'artifact-456', byteSize: video.byteLength, mediaType: 'video/mp4' } } },
        });
      }
      return jsonResponse({
        id: 'artifact-456',
        offset: 0,
        byteSize: video.byteLength,
        mediaType: 'video/mp4',
        data: video.subarray(0, video.byteLength - 1).toString('base64'),
      });
    }) as unknown as typeof fetch;

    await expect(runRunpodLtx25Job({
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'pod-session-token',
      jobId: 'job-456',
    }, fetchImpl)).resolves.toMatchObject({
      status: 'failed',
      error: 'LTX-2.5 returned an inconsistent video chunk.',
    });
    expect(calls.some(({ init }) => init?.method === 'DELETE')).toBe(false);
  });

  it('keeps image-to-video enabled when a real first-frame reference is present', async () => {
    let submittedBody: Record<string, unknown> | undefined;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/health')) {
        return jsonResponse({ ready: true, apiVersion: 2, capabilities: { artifactChunks: true } });
      }
      submittedBody = requestBody(init);
      return jsonResponse({ id: 'job-456', status: 'IN_QUEUE' }, 202);
    }) as unknown as typeof fetch;
    const firstFrame = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    await runRunpodLtx25Job({
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'pod-session-token',
      input: {
        prompt: 'The subject looks into camera.',
        referenceImages: [firstFrame],
      },
    }, fetchImpl);

    const workflow = (submittedBody?.input as {
      workflow: Record<string, { inputs: Record<string, unknown> }>;
      images: Array<{ image: string }>;
    }).workflow;
    expect(workflow['398:363'].inputs.value).toBe(false);
    expect((submittedBody?.input as { images: Array<{ image: string }> }).images[0].image).toBe(firstFrame);
  });

  it('honors the audio control in the submitted LTX-2.5 workflow', async () => {
    let submittedBody: Record<string, unknown> | undefined;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/health')) {
        return jsonResponse({ ready: true, apiVersion: 2, capabilities: { artifactChunks: true } });
      }
      submittedBody = requestBody(init);
      return jsonResponse({ id: 'job-456', status: 'IN_QUEUE' }, 202);
    }) as unknown as typeof fetch;

    await runRunpodLtx25Job({
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'pod-session-token',
      input: {
        prompt: 'Silent snow falls over an empty road.',
        generateAudio: false,
      },
    }, fetchImpl);

    const workflow = (submittedBody?.input as {
      workflow: Record<string, { inputs: Record<string, unknown> }>;
    }).workflow;
    expect(workflow['398:383'].inputs.value).toBe(false);
  });

  it('surfaces a nested worker error even when RunPod marks the request completed', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      id: 'job-456',
      status: 'COMPLETED',
      durationSec: 7,
      output: { status: 'ERROR', error: 'The model could not decode the first frame.' },
    })) as unknown as typeof fetch;

    await expect(runRunpodLtx25Job({
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'pod-session-token',
      jobId: 'job-456',
    }, fetchImpl)).resolves.toEqual({
      jobId: 'job-456',
      status: 'failed',
      phase: 'error',
      error: 'The model could not decode the first frame.',
    });
  });

  it('accepts the ComfyUI SaveVideo history shape where MP4 files are reported under images', async () => {
    const video = Buffer.from('tiny-video').toString('base64');
    const fetchImpl = vi.fn(async () => jsonResponse({
      id: 'job-456',
      status: 'COMPLETED',
      durationSec: 9,
      output: {
        result: {
          outputs: {
            75: {
              images: [{
                filename: 'LTX-2.5_i2v_00001_.mp4',
                subfolder: 'video',
                type: 'base64',
                data: video,
              }],
            },
          },
        },
      },
    })) as unknown as typeof fetch;

    await expect(runRunpodLtx25Job({
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'pod-session-token',
      jobId: 'job-456',
    }, fetchImpl)).resolves.toEqual({
      jobId: 'job-456',
      status: 'completed',
      phase: 'ready',
      output: {
        data: video,
        mediaType: 'video/mp4',
        durationSec: 9,
        model: 'LTX-2.5',
      },
    });
  });

  it('finds a nested video URL across worker response wrappers', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      id: 'job-456',
      status: 'COMPLETED',
      output: {
        result: {
          artifacts: [{
            filename: 'render.webm',
            mime_type: 'video/webm',
            download_url: 'https://cdn.example/render.webm',
          }],
        },
      },
    })) as unknown as typeof fetch;

    const result = await runRunpodLtx25Job({
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'pod-session-token',
      jobId: 'job-456',
    }, fetchImpl);

    expect(result.output?.url).toBe('https://cdn.example/render.webm');
  });

  it('does not mistake an image artifact for the generated video', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      id: 'job-456',
      status: 'COMPLETED',
      output: {
        status: 'success',
        output: {
          images: [{ filename: 'preview.png', type: 'base64', data: 'aW1hZ2U=' }],
        },
      },
    })) as unknown as typeof fetch;

    await expect(runRunpodLtx25Job({
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'pod-session-token',
      jobId: 'job-456',
    }, fetchImpl)).resolves.toMatchObject({
      status: 'failed',
      error: 'LTX-2.5 completed without returning a video.',
    });
  });

  it('surfaces the deepest provider failure instead of replacing it with a missing-output error', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      id: 'job-456',
      status: 'COMPLETED',
      output: {
        status: 'success',
        result: {
          status: 'failed',
          detail: 'SaveVideo could not mux the generated audio stream.',
        },
      },
    })) as unknown as typeof fetch;

    await expect(runRunpodLtx25Job({
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'pod-session-token',
      jobId: 'job-456',
    }, fetchImpl)).resolves.toMatchObject({
      status: 'failed',
      error: 'SaveVideo could not mux the generated audio stream.',
    });
  });

  it('rejects non-raster and malformed reference data before contacting the Pod', async () => {
    const fetchImpl = vi.fn();

    await expect(runRunpodLtx25Job({
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'pod-session-token',
      input: {
        prompt: 'A shot',
        referenceImages: ['data:image/svg+xml;base64,PHN2Zy8+'],
      },
    }, fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({
      code: 'INVALID_REFERENCE',
      statusCode: 422,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a caller-controlled gateway host before making a network request', async () => {
    const fetchImpl = vi.fn();

    await expect(runRunpodLtx25Job({
      podId: 'pod-123',
      podUrl: 'https://attacker.example',
      podAuthToken: 'pod-session-token',
      jobId: 'job-456',
    }, fetchImpl as unknown as typeof fetch)).rejects.toThrow('RunPod session URL is invalid.');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('provisions selected image models only on a new Pod with enough temporary disk', async () => {
    let secretNumber = 0;
    let podBody: Record<string, unknown> | undefined;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(RUNPOD_GRAPHQL_URL)) {
        secretNumber += 1;
        return jsonResponse({ data: { secretCreate: { id: `secret-${secretNumber}`, name: `secret-${secretNumber}` } } });
      }
      if (url === RUNPOD_PODS_URL) {
        podBody = requestBody(init);
        return jsonResponse({ id: 'pod-123', desiredStatus: 'RUNNING' });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as unknown as typeof fetch;

    const result = await setupRunpodLtx25({
      runpodKey: 'rp_test_key',
      huggingFaceToken: 'hf_testToken123',
      gpuProfile: 'economy',
      imageModels: ['sdxl', 'qwen-image-edit'],
    }, fetchImpl);

    expect(podBody).toMatchObject({
      containerDiskInGb: 200,
      volumeInGb: 0,
      env: { CINEGEN_IMAGE_MODELS: 'sdxl,qwen-image-edit', CINEGEN_GPU_PROFILE: 'economy' },
    });
    const startCommand = (podBody?.dockerStartCmd as string[])[2];
    expect(startCommand).toContain('stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors');
    expect(startCommand).toContain('qwen_image_edit_2511_int8_convrot.safetensors');
    expect(startCommand).toContain('qwen_2.5_vl_7b_fp8_scaled.safetensors');
    expect(startCommand).toContain('qwen_image_vae.safetensors');
    expect(startCommand).toContain('Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors');
    expect(startCommand).toContain('def health_snapshot():');
    expect(startCommand).toContain('"missingModels": missing_images');
    expect(startCommand.indexOf('ThreadingHTTPServer(("0.0.0.0", 8000), Gateway).serve_forever()'))
      .toBeLessThan(startCommand.indexOf('stabilityai/stable-diffusion-xl-base-1.0/resolve/main'));
    expect(startCommand).toContain('COMFY + "/free"');
    expect(result.imageModels).toEqual(['sdxl', 'qwen-image-edit']);
  });

  it('rejects unsupported optional image models before creating RunPod resources', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await expect(setupRunpodLtx25({
      runpodKey: 'rp_test_key',
      huggingFaceToken: 'hf_testToken123',
      imageModels: ['unknown-model' as never],
    }, fetchImpl)).rejects.toMatchObject({ code: 'INVALID_IMAGE_MODELS', statusCode: 422 });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('submits the server-owned SDXL text-to-image workflow to an installed session', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/health')) {
        return jsonResponse({
          ready: true,
          apiVersion: 2,
          installedModels: ['ltx-2.5', 'sdxl'],
          capabilities: { artifactChunks: true, imageArtifacts: true },
        });
      }
      if (url.endsWith('/run')) return jsonResponse({ id: 'image-job-1', status: 'IN_QUEUE' }, 202);
      throw new Error(`Unexpected request: ${url}`);
    }) as unknown as typeof fetch;

    const result = await runRunpodSessionImageJob({
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'pod-session-token',
      input: {
        model: 'sdxl',
        prompt: 'A cinematic desert observatory at blue hour',
        negativePrompt: 'text, watermark',
        width: 1216,
        height: 832,
        steps: 24,
        guidanceScale: 6.5,
        seed: 42,
      },
    }, fetchImpl);

    const runCall = calls.find(({ url }) => url.endsWith('/run'));
    const body = requestBody(runCall?.init) as {
      input: { cinegen_task: string; images: unknown[]; workflow: Record<string, { class_type: string; inputs: Record<string, unknown> }> };
    };
    expect(body.input.cinegen_task).toBe('sdxl');
    expect(body.input.images).toEqual([]);
    expect(body.input.workflow['1']).toMatchObject({
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' },
    });
    expect(body.input.workflow['4'].inputs).toMatchObject({ width: 1216, height: 832 });
    expect(body.input.workflow['5'].inputs).toMatchObject({ seed: 42, steps: 24, cfg: 6.5 });
    expect(result).toMatchObject({ jobId: 'image-job-1', status: 'queued' });
  });

  it('builds the exact four-step Qwen 2511 INT8 edit workflow with one to three references', async () => {
    let submitted: Record<string, unknown> | undefined;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/health')) {
        return jsonResponse({
          ready: true,
          apiVersion: 2,
          installedModels: ['ltx-2.5', 'qwen-image-edit'],
          capabilities: { artifactChunks: true, imageArtifacts: true },
        });
      }
      submitted = requestBody(init);
      return jsonResponse({ id: 'image-job-2', status: 'IN_QUEUE' }, 202);
    }) as unknown as typeof fetch;
    const reference = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    await runRunpodSessionImageJob({
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'pod-session-token',
      input: {
        model: 'qwen-image-edit',
        prompt: 'Put the subject in a charcoal wool coat while preserving identity.',
        seed: 99,
        referenceImages: [reference, reference, reference],
      },
    }, fetchImpl);

    const input = submitted?.input as {
      cinegen_task: string;
      cinegen_preserve_input_dimensions: boolean;
      images: Array<{ name: string }>;
      workflow: Record<string, { class_type: string; inputs: Record<string, unknown> }>;
    };
    expect(input.cinegen_task).toBe('qwen-image-edit');
    expect(input.cinegen_preserve_input_dimensions).toBe(false);
    expect(input.images.map(({ name }) => name)).toEqual([
      'cinegen-qwen-reference-1.png',
      'cinegen-qwen-reference-2.png',
      'cinegen-qwen-reference-3.png',
    ]);
    expect(input.workflow['1'].inputs.unet_name).toBe('qwen_image_edit_2511_int8_convrot.safetensors');
    expect(input.workflow['4'].inputs.lora_name).toBe('Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors');
    expect(input.workflow['5'].inputs).toMatchObject({
      clip_name: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
      type: 'qwen_image',
    });
    expect(input.workflow['18']).toMatchObject({
      class_type: 'FluxKontextImageScale',
      inputs: { image: ['7', 0] },
    });
    expect(input.workflow['10'].inputs).toMatchObject({ image1: ['18', 0], image2: ['8', 0], image3: ['9', 0] });
    expect(input.workflow['11'].inputs).toMatchObject({ image1: ['18', 0], image2: ['8', 0], image3: ['9', 0] });
    expect(input.workflow['14']).toMatchObject({
      class_type: 'VAEEncode',
      inputs: { pixels: ['18', 0], vae: ['6', 0] },
    });
    expect(input.workflow['15'].inputs).toMatchObject({ seed: 99, steps: 4, cfg: 1, sampler_name: 'euler', scheduler: 'simple' });
  });

  it('uses the expected image model while polling an older gateway that omits its task', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      id: 'legacy-qwen-job',
      status: 'IN_PROGRESS',
    })) as unknown as typeof fetch;

    const result = await runRunpodSessionImageJob({
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'pod-session-token',
      model: 'qwen-image-edit',
      jobId: 'legacy-qwen-job',
    }, fetchImpl);

    expect(result).toMatchObject({
      jobId: 'legacy-qwen-job',
      status: 'in_progress',
      message: expect.stringContaining('Qwen Image Edit'),
    });
  });

  it('rejects a valid but conflicting task returned for an image job', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      id: 'wrong-model-job',
      status: 'IN_PROGRESS',
      task: 'sdxl',
    })) as unknown as typeof fetch;

    await expect(runRunpodSessionImageJob({
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'pod-session-token',
      model: 'qwen-image-edit',
      jobId: 'wrong-model-job',
    }, fetchImpl)).resolves.toMatchObject({
      status: 'failed',
      error: expect.stringContaining('does not match'),
    });
  });

  it('downloads a completed PNG image through the authenticated artifact protocol', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex');
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/status/image-job-1')) {
        return jsonResponse({
          id: 'image-job-1',
          status: 'COMPLETED',
          task: 'sdxl',
          output: { output: { artifact: { id: 'image-artifact-1', byteSize: png.byteLength, mediaType: 'image/png' } } },
        });
      }
      const endpoint = new URL(url);
      if (endpoint.pathname === '/artifact/image-artifact-1' && init?.method !== 'DELETE') {
        return jsonResponse({
          id: 'image-artifact-1',
          offset: 0,
          byteSize: png.byteLength,
          mediaType: 'image/png',
          data: png.toString('base64'),
        });
      }
      if (endpoint.pathname === '/artifact/image-artifact-1' && init?.method === 'DELETE') return jsonResponse({ ok: true });
      throw new Error(`Unexpected request: ${url}`);
    }) as unknown as typeof fetch;

    const result = await runRunpodSessionImageJob({
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'pod-session-token',
      jobId: 'image-job-1',
    }, fetchImpl);

    expect(result).toMatchObject({
      status: 'completed',
      output: { mediaType: 'image/png', model: 'SDXL' },
    });
    expect(Buffer.from(result.output?.data ?? '', 'base64')).toEqual(png);
    expect(calls.at(-1)).toMatchObject({ init: { method: 'DELETE' } });
  });

  it('refuses a paid image render when that model was not installed on the current Pod', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      ready: true,
      apiVersion: 2,
      installedModels: ['ltx-2.5'],
      capabilities: { artifactChunks: true, imageArtifacts: true },
    })) as unknown as typeof fetch;

    await expect(runRunpodSessionImageJob({
      podId: 'pod-123',
      podUrl: 'https://pod-123-8000.proxy.runpod.net',
      podAuthToken: 'pod-session-token',
      input: { model: 'sdxl', prompt: 'A quiet lake at dawn' },
    }, fetchImpl)).rejects.toMatchObject({ code: 'IMAGE_MODEL_NOT_INSTALLED', statusCode: 409 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
