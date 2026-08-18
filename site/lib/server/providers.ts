import { SiteHttpError, requireRecord } from "./common";

const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;

async function readProviderJson(response: Response): Promise<unknown> {
  const text = await response.text();
  let payload: unknown = text;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    // Keep the bounded provider text for the error below.
  }
  if (!response.ok) {
    const record = payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {};
    const message = [record.message, record.error, record.detail]
      .find((entry) => typeof entry === "string") as string | undefined;
    throw new SiteHttpError(
      502,
      (message || `Provider request failed (${response.status}).`).slice(0, 2_000),
      "PROVIDER_ERROR",
    );
  }
  return payload;
}

async function falSubscribe(model: string, input: unknown, apiKey: string) {
  if (!SAFE_MODEL.test(model)) {
    throw new SiteHttpError(400, "Invalid hosted model.", "INVALID_INPUT");
  }
  const headers = {
    Accept: "application/json",
    Authorization: `Key ${apiKey}`,
    "Content-Type": "application/json",
  };
  const submitted = await readProviderJson(await fetch(`https://queue.fal.run/${model}`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  }));
  const submittedRecord = submitted && typeof submitted === "object" && !Array.isArray(submitted)
    ? submitted as Record<string, unknown>
    : {};
  const requestId = submittedRecord.request_id;
  if (typeof requestId !== "string") return submitted;
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(requestId)) {
    throw new SiteHttpError(502, "Provider returned an invalid job ID.", "PROVIDER_BAD_RESPONSE");
  }
  const parts = model.split("/");
  const queueIdentity = parts.slice(0, ["workflows", "comfy"].includes(parts[0]) ? 3 : 2).join("/");
  const requestBase = `https://queue.fal.run/${queueIdentity}/requests/${encodeURIComponent(requestId)}`;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 500));
    const statusValue = await readProviderJson(await fetch(`${requestBase}/status?logs=0`, { headers }));
    const statusRecord = statusValue && typeof statusValue === "object" && !Array.isArray(statusValue)
      ? statusValue as Record<string, unknown>
      : {};
    const status = typeof statusRecord.status === "string" ? statusRecord.status.toUpperCase() : "";
    if (status === "COMPLETED") return readProviderJson(await fetch(requestBase, { headers }));
    if (status === "FAILED" || status === "CANCELLED") {
      throw new SiteHttpError(502, `Provider job ${status.toLowerCase()}.`, "PROVIDER_ERROR");
    }
    if (!status || !["IN_QUEUE", "IN_PROGRESS"].includes(status)) {
      throw new SiteHttpError(502, "Provider returned an unknown job status.", "PROVIDER_BAD_RESPONSE");
    }
  }
  throw new SiteHttpError(504, "Hosted chat timed out.", "PROVIDER_TIMEOUT");
}

export async function hostedChat(value: unknown) {
  const params = requireRecord(value, "Chat parameters");
  const apiKey = typeof params.apiKey === "string" ? params.apiKey.trim() : "";
  if (!apiKey || apiKey.length > 1_000) {
    throw new SiteHttpError(400, "A fal.ai API key is required.", "MISSING_API_KEY");
  }
  if (!Array.isArray(params.messages) || params.messages.length === 0 || params.messages.length > 200) {
    throw new SiteHttpError(400, "Chat requires 1-200 messages.", "INVALID_INPUT");
  }
  const messages = params.messages.map((entry, index) => {
    const message = requireRecord(entry, `Chat message ${index + 1}`);
    const role = message.role === "assistant" ? "Assistant" : message.role === "system" ? "System" : "User";
    const content = typeof message.content === "string" ? message.content.trim() : "";
    if (content.length > 250_000) {
      throw new SiteHttpError(413, "A chat message is too long.", "INVALID_INPUT");
    }
    return `${role}:\n${content}`;
  });
  const model = typeof params.model === "string" && params.model.trim()
    ? params.model.trim()
    : "anthropic/claude-sonnet-4.6";
  const result = await falSubscribe("openrouter/router", {
    model,
    prompt: `${messages.join("\n\n")}\n\nAssistant:\n`,
    max_tokens: typeof params.maxTokens === "number" ? Math.max(1, Math.min(128_000, Math.floor(params.maxTokens))) : 1_600,
    ...(typeof params.systemPrompt === "string" && params.systemPrompt.trim()
      ? { system_prompt: params.systemPrompt.trim() }
      : {}),
    ...(typeof params.temperature === "number"
      ? { temperature: Math.max(0, Math.min(2, params.temperature)) }
      : {}),
  }, apiKey);
  const data = result && typeof result === "object" && !Array.isArray(result) && "data" in result
    ? (result as Record<string, unknown>).data
    : result;
  const record = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {};
  const message = typeof record.output === "string"
    ? record.output
    : typeof record.text === "string"
      ? record.text
      : "";
  return { message: message.trim(), ...(record.usage ? { usage: record.usage } : {}) };
}
