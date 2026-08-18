import { normalizeBrowserMediaReferences } from './rpc';

type EventCallback = (payload: unknown) => void;

const EVENT_STREAM_URL = '/api/events';

// EventSource only delivers custom event names to listeners registered for
// those exact names. Keep this list aligned with the subscriptions exposed by
// ElectronAPI, while also supporting generic `message` envelopes below.
const NAMED_EVENTS = [
  'export:progress',
  'llm:local-stream',
  'llm:claude-code-stream',
  'llm:codex-stream',
  'llm:gemini-stream',
  'media:job-progress',
  'media:job-complete',
  'media:job-error',
  'pm:open-project',
  'transcription:progress',
  'local-model:progress',
  'sync:batch-progress',
  'app:power-event',
] as const;

function parseEventData(raw: string): unknown {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class BrowserEventDispatcher {
  private readonly listeners = new Map<string, Set<EventCallback>>();
  private source: EventSource | undefined;

  subscribe<T>(eventName: string, callback: (payload: T) => void): () => void {
    let callbacks = this.listeners.get(eventName);
    if (!callbacks) {
      callbacks = new Set<EventCallback>();
      this.listeners.set(eventName, callbacks);
    }
    callbacks.add(callback as EventCallback);
    this.ensureConnected();

    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      const current = this.listeners.get(eventName);
      current?.delete(callback as EventCallback);
      if (current?.size === 0) this.listeners.delete(eventName);
      if (this.listeners.size === 0) this.disconnect();
    };
  }

  dispatch(eventName: string, payload: unknown): void {
    const callbacks = this.listeners.get(eventName);
    if (!callbacks) return;
    const normalizedPayload = normalizeBrowserMediaReferences(payload);

    // Copy first so a callback can safely unsubscribe while dispatching.
    for (const callback of [...callbacks]) {
      try {
        callback(normalizedPayload);
      } catch (error) {
        console.error(`[CineGen web] Error in ${eventName} event listener`, error);
      }
    }
  }

  private ensureConnected(): void {
    if (this.source || typeof EventSource === 'undefined') return;

    const source = new EventSource(EVENT_STREAM_URL, { withCredentials: true });
    this.source = source;

    source.onmessage = (event) => {
      const envelope = parseEventData(event.data);
      if (!isRecord(envelope)) return;

      const explicitName =
        (typeof envelope.event === 'string' && envelope.event) ||
        (typeof envelope.channel === 'string' && envelope.channel) ||
        (typeof envelope.topic === 'string' && envelope.topic) ||
        (typeof envelope.type === 'string' && envelope.type.includes(':') && envelope.type) ||
        undefined;
      if (!explicitName) return;

      const payload = 'data' in envelope
        ? envelope.data
        : 'payload' in envelope
          ? envelope.payload
          : envelope;
      this.dispatch(explicitName, payload);
    };

    for (const eventName of NAMED_EVENTS) {
      source.addEventListener(eventName, (event) => {
        this.dispatch(eventName, parseEventData((event as MessageEvent<string>).data));
      });
    }

    // EventSource automatically reconnects. Avoid throwing from `onerror`,
    // since a transient backend restart should not tear down the React app.
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED && this.source === source) {
        this.source = undefined;
      }
    };
  }

  private disconnect(): void {
    this.source?.close();
    this.source = undefined;
  }
}

const EVENT_DISPATCHER_KEY = Symbol.for('cinegen.web.event-dispatcher');
type EventDispatcherGlobal = typeof globalThis & {
  [EVENT_DISPATCHER_KEY]?: BrowserEventDispatcher;
};

const sharedGlobal = globalThis as EventDispatcherGlobal;

export const browserEvents = sharedGlobal[EVENT_DISPATCHER_KEY]
  ?? (sharedGlobal[EVENT_DISPATCHER_KEY] = new BrowserEventDispatcher());
