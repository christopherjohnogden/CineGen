import { createEngineClient as createMockEngineClient } from './mockEngine'
import type {
  EngineClient,
  EngineCommand,
  EngineCommandResult,
  EngineEvent,
  EngineEventListener,
} from '../types/engine'

type TauriInvoke = (command: string, args?: unknown) => Promise<unknown>
type TauriUnlisten = () => void

declare global {
  interface Window {
    __TAURI__?: {
      core?: {
        invoke?: TauriInvoke
      }
      event?: {
        listen?: (
          eventName: string,
          callback: (event: { payload: EngineEvent }) => void,
        ) => Promise<TauriUnlisten>
      }
    }
  }
}

class TauriEngineClient implements EngineClient {
  private readonly invokeFn: TauriInvoke
  private readonly fallback: EngineClient
  private readonly listenFn?: (
    eventName: string,
    callback: (event: { payload: EngineEvent }) => void,
  ) => Promise<TauriUnlisten>

  constructor(
    invokeFn: TauriInvoke,
    fallback: EngineClient,
    listenFn?: (
      eventName: string,
      callback: (event: { payload: EngineEvent }) => void,
    ) => Promise<TauriUnlisten>,
  ) {
    this.invokeFn = invokeFn
    this.fallback = fallback
    this.listenFn = listenFn
  }

  async invoke(command: EngineCommand): Promise<EngineCommandResult> {
    try {
      const value = (await this.invokeFn('engine_invoke', {
        command,
      })) as EngineCommandResult

      if (typeof value === 'object' && value !== null && 'ok' in value && value.ok) {
        return value
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tauri invoke failed'
      if (!message.includes('engine_invoke')) {
        return {
          ok: false,
          error: message,
        }
      }
    }

    return this.fallback.invoke(command)
  }

  subscribe(listener: EngineEventListener): () => void {
    const unsubscribeFallback = this.fallback.subscribe(listener)
    if (!this.listenFn) {
      return unsubscribeFallback
    }

    let disposed = false
    let unlisten: TauriUnlisten | null = null

    void this.listenFn('engine_event', (event) => {
      if (!disposed) {
        listener(event.payload)
      }
    }).then((fn) => {
      unlisten = fn
      if (disposed && unlisten) {
        unlisten()
      }
    })

    return () => {
      disposed = true
      if (unlisten) {
        unlisten()
      }
      unsubscribeFallback()
    }
  }
}

export function createEngineClient(projectId: string): EngineClient {
  const fallback = createMockEngineClient(projectId)
  const tauriInvoke = window.__TAURI__?.core?.invoke
  if (tauriInvoke) {
    return new TauriEngineClient(tauriInvoke, fallback, window.__TAURI__?.event?.listen)
  }

  return fallback
}
