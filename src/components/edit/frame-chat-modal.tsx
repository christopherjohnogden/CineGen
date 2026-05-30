import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { Asset } from '@/types/project';
import type { Clip } from '@/types/timeline';
import { clipEffectiveDuration } from '@/types/timeline';
import { routeQuickEdit } from '@/lib/higgsfield/quick-edit-intent';
import { getCutVisionModel } from '@/lib/utils/api-key';
import {
  detectFrameChatIntent, deserializeThread, frameChatStorageKey, serializeThread,
  type FrameChatMessage,
} from '@/lib/edit/frame-chat-thread';
import { toFileUrl } from '@/lib/utils/file-url';
import { subscribeCliCopilotStream } from '@/lib/llm/cli-copilot-client';
import { FrameCanvas, type FrameCanvasHandle } from './frame-canvas';

export interface FrameChatPlaceResult {
  sourceClipId: string;
  url: string;
  durationSec: number;
  label: string;
}

interface FrameChatModalProps {
  projectId: string;
  clip?: Clip;
  asset?: Asset;
  playheadSourceSec?: number;
  onPlaceResult: (result: FrameChatPlaceResult) => void;
  onClose: () => void;
}

async function writeTempImage(dataUrl: string): Promise<string> {
  const { outputPath } = await window.electronAPI.media.writeTempImage({ dataUrl });
  return outputPath;
}

// Prepended to the user's question when they drew on the frame. The red marks are a pointing
// gesture indicating what the question is about — they are NOT part of the scene.
const ANNOTATION_GUIDANCE = [
  'The attached frame has red markings I drew on it (a box, circle, arrow, freehand scribble, or text).',
  'These markings are NOT part of the scene — they are how I am pointing at the thing I am asking about.',
  'Treat whatever is inside/under/at the marking as the subject of my question.',
  'Do not mention, describe, or acknowledge the red markings themselves (never say "a red box", "a red arrow", etc.).',
  'Answer only about the real content of the image at the marked location.',
].join(' ');

export function FrameChatModal({ projectId, clip, asset, playheadSourceSec, onPlaceResult, onClose }: FrameChatModalProps) {
  const [messages, setMessages] = useState<FrameChatMessage[]>(() =>
    deserializeThread(typeof window !== 'undefined' ? localStorage.getItem(frameChatStorageKey(projectId)) : null));
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  // The assistant message currently being streamed, and a status line shown until the first token.
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<string>('');
  const canvasRef = useRef<FrameCanvasHandle>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string | undefined>(undefined);
  // Holds prompt+drawnPath for proposed generations until the user presses Generate. Keyed by message id.
  // Not persisted: a `proposed` message reloaded from localStorage has no entry, so its Generate
  // button is disabled (see render) rather than silently dead.
  const pendingGenRef = useRef<Record<string, { prompt: string; drawnPath: string | null }>>({});

  const hasFrame = Boolean(clip && asset && (asset.type === 'video' || asset.type === 'image') && frameUrl);

  useEffect(() => {
    try { localStorage.setItem(frameChatStorageKey(projectId), serializeThread(messages)); } catch {}
  }, [messages, projectId]);

  useEffect(() => { if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight; }, [messages, busy]);

  useEffect(() => {
    let cancelled = false;
    setFrameUrl(null);
    if (!clip || !asset || !(asset.type === 'video' || asset.type === 'image') || !asset.fileRef) return;
    const inputPath = asset.fileRef;
    if (asset.type === 'image') {
      // Use the secure local-media:// scheme so the <img> is canvas-clean (file:// taints
      // toDataURL in the http://localhost renderer); toFileUrl passes through existing URLs.
      setFrameUrl(toFileUrl(inputPath));
      return;
    }
    window.electronAPI.media.extractFrame({ inputPath, timeSec: playheadSourceSec ?? clip.trimStart }).then((res) => {
      if (cancelled || !res) return;
      setFrameUrl(toFileUrl(res.outputPath));
    }).catch(() => { if (!cancelled) setFrameUrl(null); });
    return () => { cancelled = true; };
  }, [clip, asset, playheadSourceSec]);

  const addMessage = useCallback((m: FrameChatMessage) => setMessages((prev) => [...prev, m]), []);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setError(null);
    const intent = detectFrameChatIntent(text);
    const userMsg: FrameChatMessage = { id: crypto.randomUUID(), role: 'user', content: text, createdAt: new Date().toISOString(), intent };
    addMessage(userMsg);
    setDraft('');
    setBusy(true);

    try {
      // flatten() can throw a SecurityError on a tainted canvas; keep it inside the try so a
      // failure surfaces via setError and busy still clears in finally.
      let drawnPath: string | null = null;
      const didDraw = hasFrame ? canvasRef.current?.hasDrawing() ?? false : false;
      const drawnDataUrl = hasFrame ? canvasRef.current?.flatten() ?? null : null;
      canvasRef.current?.clear();
      if (drawnDataUrl) drawnPath = await writeTempImage(drawnDataUrl);

      // Only generate when a clip with a usable source file is selected (State A). In chat-only
      // mode (State B) a 'generate' intent falls back to an ask turn so the user still gets a reply.
      const canGenerate = Boolean(clip && asset?.fileRef);
      if (intent === 'generate' && canGenerate) {
        const route = routeQuickEdit(text);
        const msgId = crypto.randomUUID();
        pendingGenRef.current[msgId] = { prompt: text, drawnPath };
        addMessage({
          id: msgId, role: 'assistant',
          content: `I can generate that — ${route.reason}. Press Generate to run it.`,
          createdAt: new Date().toISOString(),
          generation: {
            model: route.model, outputType: route.outputType, referenceMode: route.referenceMode,
            sourceClipId: clip!.id, status: 'proposed',
          },
        });
      } else {
        const visualRefs = drawnPath
          ? [{ label: asset?.name ?? 'frame', kind: 'asset' as const, mediaType: 'image' as const, fileRef: drawnPath }]
          : [];
        // When the user drew on the frame, the red marks are a POINTING GESTURE at the subject of
        // their question — not part of the scene. Tell Gemini to answer about what's marked and to
        // never describe the marks themselves ("a red box/arrow…").
        const userMessage = didDraw
          ? `${ANNOTATION_GUIDANCE}\n\nMy question: ${text}`
          : text;

        // Create the assistant message up-front and stream tokens into it so the user sees it think.
        const requestId = crypto.randomUUID();
        const assistantId = crypto.randomUUID();
        addMessage({ id: assistantId, role: 'assistant', content: '', createdAt: new Date().toISOString() });
        setStreamingId(assistantId);
        setStreamStatus('Thinking…');

        let streamed = '';
        const unsubscribe = subscribeCliCopilotStream('gemini', (ev) => {
          if (ev.requestId !== requestId) return;
          if (ev.status) setStreamStatus(ev.status);
          if (ev.token) {
            streamed += ev.token;
            setStreamStatus('');
            setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, content: streamed } : m));
          }
        });

        try {
          const res = await window.electronAPI.llm.geminiChat({
            requestId,
            userMessage,
            model: getCutVisionModel(),
            resumeSessionId: sessionIdRef.current,
            visualRefs,
          });
          sessionIdRef.current = res.sessionId ?? sessionIdRef.current;
          // Reconcile with the authoritative final text (covers backends that don't stream tokens).
          const finalText = res.message || streamed || '(no response)';
          setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, content: finalText } : m));
        } finally {
          unsubscribe();
          setStreamingId(null);
          setStreamStatus('');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [draft, busy, hasFrame, asset, clip, addMessage]);

  const handleGenerate = useCallback(async (msgId: string) => {
    const msg = messages.find((m) => m.id === msgId);
    if (!msg?.generation || !clip || !asset?.fileRef) return;
    const pending = pendingGenRef.current[msgId];
    if (!pending) return;
    setMessages((prev) => prev.map((m) => m.id === msgId && m.generation ? { ...m, generation: { ...m.generation, status: 'generating' } } : m));
    try {
      const sourceStartSec = clip.trimStart;
      const sourceEndSec = clip.duration - clip.trimEnd;
      const res = await window.electronAPI.higgsfield.quickEdit({
        fileRef: asset.fileRef, prompt: pending.prompt,
        model: msg.generation.model, outputType: msg.generation.outputType, referenceMode: msg.generation.referenceMode,
        frameTimeSec: playheadSourceSec, sourceStartSec, sourceEndSec,
        drawnFramePath: pending.drawnPath ?? undefined,
      });
      const durationSec = res.durationSec ?? clipEffectiveDuration(clip);
      setMessages((prev) => prev.map((m) => m.id === msgId && m.generation
        ? { ...m, generation: { ...m.generation, status: 'ready', resultUrl: res.url, resultDurationSec: durationSec } } : m));
    } catch (err) {
      setMessages((prev) => prev.map((m) => m.id === msgId && m.generation
        ? { ...m, generation: { ...m.generation, status: 'failed', error: err instanceof Error ? err.message : String(err) } } : m));
    }
  }, [messages, clip, asset, playheadSourceSec]);

  const handlePlace = useCallback((msgId: string) => {
    const msgIndex = messages.findIndex((m) => m.id === msgId);
    const msg = messages[msgIndex];
    if (!msg?.generation?.resultUrl || !msg.generation.resultDurationSec) return;
    onPlaceResult({
      sourceClipId: msg.generation.sourceClipId, url: msg.generation.resultUrl,
      durationSec: msg.generation.resultDurationSec, label: messages[msgIndex - 1]?.content.slice(0, 40) ?? 'Frame Chat',
    });
    setMessages((prev) => prev.map((m) => m.id === msgId && m.generation ? { ...m, generation: { ...m.generation, status: 'placed' } } : m));
  }, [messages, onPlaceResult]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); }
    if (e.key === 'Escape') onClose();
  };

  return (
    <div className="fcm__backdrop" onMouseDown={onClose}>
      <div className={`fcm${hasFrame ? ' fcm--with-frame' : ''}`} role="dialog" aria-modal="true" aria-label="Frame Chat" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="fcm__topbar">
          <span className="fcm__brand">
            <span className="fcm__brand-dot" />
            Frame Chat
          </span>
          <span className="fcm__subtitle">
            {hasFrame ? `${asset?.name ?? 'Clip'} · frame at playhead` : 'No clip under playhead — ask anything'}
          </span>
          <button className="fcm__close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="fcm__body">
          {hasFrame && frameUrl && (
            <div className="fcm__canvas-pane">
              <FrameCanvas ref={canvasRef} frameUrl={frameUrl} />
            </div>
          )}
          <div className="fcm__chat-pane">
            <div className="fcm__thread" ref={threadRef}>
              {messages.length === 0 && (
                <div className="fcm__empty">
                  <div className="fcm__empty-mark">✦</div>
                  <p className="fcm__empty-title">{hasFrame ? 'Ask about this frame' : 'Ask anything about your project'}</p>
                  <p className="fcm__empty-hint">{hasFrame ? 'Draw to point at something, then ask — or describe a change to generate.' : 'Move the playhead over a clip to draw on its frame.'}</p>
                </div>
              )}
              {messages.map((m) => (
                <div key={m.id} className={`fcm__row fcm__row--${m.role}`}>
                  {m.role === 'assistant' && <div className="fcm__avatar">✦</div>}
                  <div className={`fcm__msg fcm__msg--${m.role}`}>
                    <div className="fcm__msg-content">
                      {m.content}
                      {streamingId === m.id && (
                        m.content
                          ? <span className="fcm__cursor">▋</span>
                          : <span className="fcm__thinking">{streamStatus || 'Thinking…'}</span>
                      )}
                    </div>
                    {m.generation && (
                      <div className="fcm__gen">
                        {m.generation.status === 'proposed' && (
                          pendingGenRef.current[m.id]
                            ? <button className="fcm__btn fcm__btn--accent" onClick={() => void handleGenerate(m.id)}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 L14 9 L21 9 L15 13 L17 20 L12 16 L7 20 L9 13 L3 9 L10 9 Z" /></svg>
                                Generate
                              </button>
                            : <span className="fcm__note">Session expired — resend to generate.</span>
                        )}
                        {m.generation.status === 'generating' && (
                          <span className="fcm__note fcm__note--busy"><span className="fcm__spinner" /> Generating…</span>
                        )}
                        {m.generation.status === 'ready' && m.generation.resultUrl && (
                          <div className="fcm__result">
                            {m.generation.outputType === 'video'
                              ? <video className="fcm__result-media" src={m.generation.resultUrl} muted loop autoPlay />
                              : <img className="fcm__result-media" src={m.generation.resultUrl} alt="result" />}
                            <button className="fcm__btn fcm__btn--accent" onClick={() => handlePlace(m.id)}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
                              Add to timeline
                            </button>
                          </div>
                        )}
                        {m.generation.status === 'placed' && <span className="fcm__note fcm__note--ok">✓ Placed above the clip</span>}
                        {m.generation.status === 'failed' && <span className="fcm__note fcm__note--err">{m.generation.error}</span>}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {error && <div className="fcm__error">{error}</div>}
            <div className="fcm__composer">
              <textarea
                className="fcm__input"
                value={draft}
                disabled={busy}
                placeholder={hasFrame ? 'Ask about the frame, or describe a change…' : 'Ask anything, or describe a change…'}
                onChange={(e) => setDraft(e.target.value)}
                rows={1}
              />
              <button className="fcm__send" onClick={() => void handleSend()} disabled={!draft.trim() || busy} aria-label="Send">
                {busy
                  ? <span className="fcm__spinner" />
                  : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" /></svg>}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
