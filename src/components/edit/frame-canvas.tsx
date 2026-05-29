import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

export type FrameTool = 'brush' | 'rect' | 'ellipse' | 'arrow' | 'text';

export interface FrameCanvasHandle {
  /** Composite the frame image + drawing into one PNG data URL. Null if nothing to flatten. */
  flatten: () => string | null;
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
  { frameUrl, width = 512, height = 288 },
  ref,
) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [tool, setTool] = useState<FrameTool>('brush');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
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

  const toPoint = (e: React.PointerEvent): { x: number; y: number } => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * (width / rect.width), y: (e.clientY - rect.top) * (height / rect.height) };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const p = toPoint(e);
    if (tool === 'text') {
      const text = window.prompt('Label text:')?.trim();
      if (text) setStrokes((prev) => [...prev, { tool, color: COLOR, points: [p], text }]);
      return;
    }
    drawingRef.current = { tool, color: COLOR, points: [p] };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawingRef.current) return;
    drawingRef.current.points.push(toPoint(e));
    redraw();
  };
  const onPointerUp = () => {
    if (drawingRef.current) setStrokes((prev) => [...prev, drawingRef.current!]);
    drawingRef.current = null;
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
    clear: () => { setStrokes([]); drawingRef.current = null; },
  }), [imgLoaded, width, height]);

  return (
    <div className="frame-canvas">
      <div className="frame-canvas__tools">
        {(['brush', 'rect', 'ellipse', 'arrow', 'text'] as FrameTool[]).map((t) => (
          <button key={t} className={`frame-canvas__tool${tool === t ? ' is-active' : ''}`} onClick={() => setTool(t)}>{t}</button>
        ))}
        <button className="frame-canvas__tool" onClick={() => setStrokes((p) => p.slice(0, -1))}>undo</button>
        <button className="frame-canvas__tool" onClick={() => setStrokes([])}>clear</button>
      </div>
      <div className="frame-canvas__stage" style={{ position: 'relative', width, height }}>
        <img ref={imgRef} src={frameUrl} alt="frame" crossOrigin="anonymous" onLoad={() => setImgLoaded(true)}
          style={{ position: 'absolute', inset: 0, width, height, objectFit: 'contain', pointerEvents: 'none' }} />
        <canvas ref={canvasRef} width={width} height={height}
          style={{ position: 'absolute', inset: 0, width, height, touchAction: 'none', cursor: 'crosshair' }}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp} />
      </div>
    </div>
  );
});
