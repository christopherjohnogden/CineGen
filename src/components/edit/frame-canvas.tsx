import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';

export type FrameTool = 'brush' | 'rect' | 'ellipse' | 'arrow' | 'text';

export interface FrameCanvasHandle {
  /** Composite the frame image + drawing into one PNG data URL. Null if nothing to flatten. */
  flatten: () => string | null;
  /** True when the user has drawn at least one mark on the frame. */
  hasDrawing: () => boolean;
  clear: () => void;
}

interface FrameCanvasProps {
  /** Displayable URL for the extracted frame (file:// or local-media://). */
  frameUrl: string;
  width?: number;
  height?: number;
}

interface Stroke {
  tool: FrameTool;
  color: string;
  points: Array<{ x: number; y: number }>;
  text?: string;
}

const COLOR = '#ff3b30';

export const FrameCanvas = forwardRef<FrameCanvasHandle, FrameCanvasProps>(function FrameCanvas(
  { frameUrl, width = 560, height = 315 },
  ref,
) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [tool, setTool] = useState<FrameTool>('brush');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const strokesRef = useRef<Stroke[]>([]);
  strokesRef.current = strokes;
  const drawingRef = useRef<Stroke | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLOR;
    ctx.fillStyle = COLOR;
    ctx.lineCap = 'round';
    ctx.font = '18px sans-serif';
    const all = drawingRef.current ? [...strokes, drawingRef.current] : strokes;
    for (const s of all) {
      if (!s || !s.points) continue; // defensive: never let a stray stroke crash the canvas
      const pts = s.points;
      if (s.tool === 'brush') {
        ctx.beginPath();
        pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.stroke();
      } else if ((s.tool === 'rect' || s.tool === 'ellipse') && pts.length >= 2) {
        const [a, b] = [pts[0], pts[pts.length - 1]];
        if (s.tool === 'rect') {
          ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
        } else {
          ctx.beginPath();
          ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (s.tool === 'arrow' && pts.length >= 2) {
        const [a, b] = [pts[0], pts[pts.length - 1]];
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - 12 * Math.cos(angle - Math.PI / 6), b.y - 12 * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(b.x - 12 * Math.cos(angle + Math.PI / 6), b.y - 12 * Math.sin(angle + Math.PI / 6));
        ctx.closePath(); ctx.fill();
      } else if (s.tool === 'text' && s.text && pts.length >= 1) {
        ctx.fillText(s.text, pts[0].x, pts[0].y);
      }
    }
  }, [strokes]);

  useEffect(() => { redraw(); }, [redraw]);

  const toPoint = (e: ReactPointerEvent): { x: number; y: number } => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * (width / rect.width), y: (e.clientY - rect.top) * (height / rect.height) };
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    const p = toPoint(e);
    if (tool === 'text') {
      const text = window.prompt('Label text:')?.trim();
      if (text) setStrokes((prev) => [...prev, { tool, color: COLOR, points: [p], text }]);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = { tool, color: COLOR, points: [p] };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (!drawingRef.current) return;
    drawingRef.current.points.push(toPoint(e));
    redraw();
  };
  const onPointerUp = () => {
    // Capture the stroke before clearing the ref — the setStrokes updater runs later, by which
    // point drawingRef.current is already null (pushing null → crash in redraw on s.points).
    const finished = drawingRef.current;
    drawingRef.current = null;
    if (finished) setStrokes((prev) => [...prev, finished]);
  };

  useImperativeHandle(ref, () => ({
    flatten: () => {
      const img = imgRef.current;
      const draw = canvasRef.current;
      if (!img || !draw || !imgLoaded) return null;
      const out = document.createElement('canvas');
      out.width = width; out.height = height;
      const ctx = out.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, width, height);
      ctx.drawImage(draw, 0, 0, width, height);
      return out.toDataURL('image/png');
    },
    hasDrawing: () => strokesRef.current.length > 0,
    clear: () => { setStrokes([]); drawingRef.current = null; },
  }), [imgLoaded, width, height]);

  const tools: Array<{ id: FrameTool; label: string; icon: ReactNode }> = [
    { id: 'brush', label: 'Brush', icon: <path d="M3 21c1.8-1.5 2.4-3.6 2.6-5.2L15.4 6a2 2 0 0 1 2.8 0l-.2-.2a2 2 0 0 1 0 2.8L8.2 18.4C6.6 18.6 4.5 19.2 3 21Z" /> },
    { id: 'rect', label: 'Rectangle', icon: <rect x="4" y="6" width="16" height="12" rx="1" /> },
    { id: 'ellipse', label: 'Ellipse', icon: <ellipse cx="12" cy="12" rx="8" ry="6" /> },
    { id: 'arrow', label: 'Arrow', icon: <><path d="M5 19 19 5" /><path d="M10 5h9v9" /></> },
    { id: 'text', label: 'Text', icon: <><path d="M5 6h14" /><path d="M12 6v13" /></> },
  ];

  return (
    <div className="frame-canvas">
      <div className="frame-canvas__tools">
        <div className="frame-canvas__toolgroup">
          {tools.map((t) => (
            <button
              key={t.id}
              className={`frame-canvas__tool${tool === t.id ? ' is-active' : ''}`}
              onClick={() => setTool(t.id)}
              title={t.label}
              aria-label={t.label}
              aria-pressed={tool === t.id}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{t.icon}</svg>
            </button>
          ))}
        </div>
        <div className="frame-canvas__toolgroup">
          <button className="frame-canvas__tool" onClick={() => setStrokes((p) => p.slice(0, -1))} title="Undo" aria-label="Undo">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-1" /></svg>
          </button>
          <button className="frame-canvas__tool" onClick={() => { drawingRef.current = null; setStrokes([]); }} title="Clear all" aria-label="Clear all">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>
          </button>
        </div>
      </div>
      <div className="frame-canvas__stage" style={{ width, height }}>
        <img ref={imgRef} src={frameUrl} alt="frame" crossOrigin="anonymous" onLoad={() => setImgLoaded(true)}
          style={{ position: 'absolute', inset: 0, width, height, objectFit: 'contain', pointerEvents: 'none' }} />
        <canvas ref={canvasRef} width={width} height={height}
          style={{ position: 'absolute', inset: 0, width, height, touchAction: 'none', cursor: 'crosshair' }}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp} onPointerCancel={onPointerUp} />
      </div>
    </div>
  );
});
