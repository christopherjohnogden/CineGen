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

export function FrameChatModal({ projectId, clip, asset, playheadSourceSec, onPlaceResult, onClose }: FrameChatModalProps) {
  const [messages, setMessages] = useState<FrameChatMessage[]>(() =>
    deserializeThread(typeof window !== 'undefined' ? localStorage.getItem(frameChatStorageKey(projectId)) : null));
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const canvasRef = useRef<FrameCanvasHandle>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string | undefined>(undefined);
  // Holds prompt+drawnPath for proposed generations until the user presses Generate. Keyed by message index.
  const pendingGenRef = useRef<Record<number, { prompt: string; drawnPath: string | null }>>({});

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
      setFrameUrl(inputPath.startsWith('http') || inputPath.startsWith('file') || inputPath.startsWith('local-media') ? inputPath : `file://${inputPath}`);
      return;
    }
    window.electronAPI.media.extractFrame({ inputPath, timeSec: playheadSourceSec ?? clip.trimStart }).then((res) => {
      if (cancelled || !res) return;
      setFrameUrl(`file://${res.outputPath}`);
    }).catch(() => { if (!cancelled) setFrameUrl(null); });
    return () => { cancelled = true; };
  }, [clip, asset, playheadSourceSec]);

  const addMessage = useCallback((m: FrameChatMessage) => setMessages((prev) => [...prev, m]), []);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setError(null);
    const intent = detectFrameChatIntent(text);
    const drawnDataUrl = hasFrame ? canvasRef.current?.flatten() ?? null : null;
    const userMsg: FrameChatMessage = { id: crypto.randomUUID(), role: 'user', content: text, createdAt: new Date().toISOString(), intent };
    addMessage(userMsg);
    setDraft('');
    canvasRef.current?.clear();
    setBusy(true);

    try {
      let drawnPath: string | null = null;
      if (drawnDataUrl) drawnPath = await writeTempImage(drawnDataUrl);

      if (intent === 'ask') {
        const visualRefs = drawnPath
          ? [{ label: asset?.name ?? 'frame', kind: 'asset' as const, mediaType: 'image' as const, fileRef: drawnPath }]
          : [];
        const res = await window.electronAPI.llm.geminiChat({
          userMessage: text,
          model: getCutVisionModel(),
          resumeSessionId: sessionIdRef.current,
          visualRefs,
        });
        sessionIdRef.current = res.sessionId ?? sessionIdRef.current;
        addMessage({ id: crypto.randomUUID(), role: 'assistant', content: res.message || '(no response)', createdAt: new Date().toISOString() });
      } else {
        const route = routeQuickEdit(text);
        // Capture the proposal context keyed by the index this assistant message will occupy.
        setMessages((prev) => {
          const idx = prev.length;
          pendingGenRef.current[idx] = { prompt: text, drawnPath };
          return [...prev, {
            id: crypto.randomUUID(), role: 'assistant',
            content: `I can generate that — ${route.reason}. Press Generate to run it.`,
            createdAt: new Date().toISOString(),
            generation: {
              model: route.model, outputType: route.outputType, referenceMode: route.referenceMode,
              sourceClipId: clip!.id, status: 'proposed',
            },
          }];
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [draft, busy, hasFrame, asset, clip, addMessage]);

  const handleGenerate = useCallback(async (msgIndex: number) => {
    const msg = messages[msgIndex];
    if (!msg?.generation || !clip || !asset?.fileRef) return;
    const pending = pendingGenRef.current[msgIndex];
    if (!pending) return;
    setMessages((prev) => prev.map((m, i) => i === msgIndex && m.generation ? { ...m, generation: { ...m.generation, status: 'generating' } } : m));
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
      setMessages((prev) => prev.map((m, i) => i === msgIndex && m.generation
        ? { ...m, generation: { ...m.generation, status: 'ready', resultUrl: res.url, resultDurationSec: durationSec } } : m));
    } catch (err) {
      setMessages((prev) => prev.map((m, i) => i === msgIndex && m.generation
        ? { ...m, generation: { ...m.generation, status: 'failed', error: err instanceof Error ? err.message : String(err) } } : m));
    }
  }, [messages, clip, asset, playheadSourceSec]);

  const handlePlace = useCallback((msgIndex: number) => {
    const msg = messages[msgIndex];
    if (!msg?.generation?.resultUrl || !msg.generation.resultDurationSec) return;
    onPlaceResult({
      sourceClipId: msg.generation.sourceClipId, url: msg.generation.resultUrl,
      durationSec: msg.generation.resultDurationSec, label: messages[msgIndex - 1]?.content.slice(0, 40) ?? 'Frame Chat',
    });
    setMessages((prev) => prev.map((m, i) => i === msgIndex && m.generation ? { ...m, generation: { ...m.generation, status: 'placed' } } : m));
  }, [messages, onPlaceResult]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); }
    if (e.key === 'Escape') onClose();
  };

  return (
    <div className="fcm__backdrop" onMouseDown={onClose}>
      <div className={`fcm${hasFrame ? ' fcm--with-frame' : ''}`} role="dialog" aria-modal="true" aria-label="Frame Chat" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        {hasFrame && frameUrl && (
          <div className="fcm__canvas-pane">
            <FrameCanvas ref={canvasRef} frameUrl={frameUrl} />
          </div>
        )}
        <div className="fcm__chat-pane">
          <div className="fcm__thread" ref={threadRef}>
            {messages.length === 0 && <div className="fcm__empty">Ask about your project, or describe a change to generate.</div>}
            {messages.map((m, i) => (
              <div key={m.id} className={`fcm__msg fcm__msg--${m.role}`}>
                <div className="fcm__msg-content">{m.content}</div>
                {m.generation && (
                  <div className="fcm__gen">
                    {m.generation.status === 'proposed' && <button onClick={() => void handleGenerate(i)}>Generate</button>}
                    {m.generation.status === 'generating' && <span>Generating…</span>}
                    {m.generation.status === 'ready' && m.generation.resultUrl && (
                      <div>
                        {m.generation.outputType === 'video'
                          ? <video src={m.generation.resultUrl} muted loop autoPlay style={{ maxWidth: 220, borderRadius: 6 }} />
                          : <img src={m.generation.resultUrl} alt="result" style={{ maxWidth: 220, borderRadius: 6 }} />}
                        <button onClick={() => handlePlace(i)}>Add to timeline</button>
                      </div>
                    )}
                    {m.generation.status === 'placed' && <span>Placed above the clip ✓</span>}
                    {m.generation.status === 'failed' && <span className="fcm__error">{m.generation.error}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
          {error && <div className="fcm__error">{error}</div>}
          <div className="fcm__composer">
            <textarea value={draft} disabled={busy} placeholder={hasFrame ? 'Ask about the frame, or describe a change…' : 'Ask anything, or describe a change…'}
              onChange={(e) => setDraft(e.target.value)} rows={2} />
            <button onClick={() => void handleSend()} disabled={!draft.trim() || busy}>{busy ? '…' : 'Send'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
