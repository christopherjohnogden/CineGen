

import { useRef, useEffect, useState, useMemo, memo } from 'react';

interface WaveformCanvasProps {
  peaks: number[];
  width: number;
  height: number;
  trimStart: number;
  trimEnd: number;
  duration: number;
  amplitudeScale?: number;
  color?: string;
  peaksUrl?: string;
  sourceWidthPx?: number;
  sourceOffsetPx?: number;
}

const waveformPeakFetchCache = new Map<string, Promise<number[]>>();
const MAX_CANVAS_BITMAP_WIDTH = 4096;
const MIN_TILE_CSS_WIDTH = 512;

function loadWaveformPeaks(peaksUrl: string): Promise<number[]> {
  const cached = waveformPeakFetchCache.get(peaksUrl);
  if (cached) return cached;

  const request = fetch(peaksUrl)
    .then((res) => {
      if (!res.ok) throw new Error(`Waveform fetch failed: ${res.status}`);
      return res.json();
    })
    .then((data) => {
      if (!Array.isArray(data)) throw new Error('Waveform JSON is not an array');
      return data as number[];
    })
    .catch((err) => {
      waveformPeakFetchCache.delete(peaksUrl);
      throw err;
    });

  waveformPeakFetchCache.set(peaksUrl, request);
  return request;
}

/**
 * Pre-reduce a large peaks array to roughly targetLen using a blended
 * mean/peak summary. Pure max-of-max downsampling makes long clips look
 * inflated and blocky, especially on speech-heavy material.
 */
function preReduce(src: number[], targetLen: number): number[] {
  if (src.length <= targetLen) return src;
  const binSize = src.length / targetLen;
  const out = new Array<number>(targetLen);
  for (let i = 0; i < targetLen; i++) {
    const start = Math.floor(i * binSize);
    const end = Math.min(Math.floor((i + 1) * binSize), src.length);
    let max = 0;
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      const value = src[j];
      sum += value;
      count++;
      if (value > max) max = value;
    }
    const mean = count > 0 ? sum / count : 0;
    out[i] = mean * 0.72 + max * 0.28;
  }
  return out;
}

function getVisiblePeakRange(
  peakCount: number,
  trimStart: number,
  trimEnd: number,
  duration: number,
): { startIdx: number; endIdx: number } | null {
  if (peakCount <= 0 || duration <= 0) return null;
  const startFrac = trimStart / duration;
  const endFrac = 1 - trimEnd / duration;
  const startIdx = Math.max(0, Math.floor(startFrac * peakCount));
  const endIdx = Math.max(startIdx + 1, Math.min(peakCount, Math.ceil(endFrac * peakCount)));
  return { startIdx, endIdx };
}

function drawWaveformSegment(
  canvas: HTMLCanvasElement,
  peaks: number[],
  startIdx: number,
  endIdx: number,
  width: number,
  height: number,
  amplitudeScale: number,
  color: string,
  dpr: number,
) {
  if (width <= 0 || height <= 0 || startIdx >= endIdx) return;

  const bitmapWidth = Math.max(1, Math.round(width * dpr));
  const bitmapHeight = Math.max(1, Math.round(height * dpr));
  canvas.width = bitmapWidth;
  canvas.height = bitmapHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  let segmentPeaks = peaks.slice(startIdx, endIdx);
  if (segmentPeaks.length === 0) return;

  const pixelWidth = Math.max(1, Math.round(width));
  const centerY = height / 2;
  const maxAmp = (height / 2) * 0.85 * Math.max(0, amplitudeScale);

  const targetDensity = pixelWidth * 4;
  if (segmentPeaks.length > targetDensity) {
    segmentPeaks = preReduce(segmentPeaks, targetDensity);
  }

  if (segmentPeaks.length > pixelWidth) {
    const binSize = segmentPeaks.length / pixelWidth;
    const bodyPath = new Path2D();
    const peakPath = new Path2D();
    for (let i = 0; i < pixelWidth; i++) {
      const start = Math.floor(i * binSize);
      const end = Math.max(start + 1, Math.min(Math.floor((i + 1) * binSize), segmentPeaks.length));
      let max = 0;
      let sum = 0;
      let count = 0;
      for (let j = start; j < end; j++) {
        const value = segmentPeaks[j];
        sum += value;
        count++;
        if (value > max) max = value;
      }
      const mean = count > 0 ? sum / count : 0;
      const bodyAmp = Math.max(0.5, mean * maxAmp);
      const peakAmp = Math.max(bodyAmp, max * maxAmp);
      const x = i + 0.5;
      bodyPath.moveTo(x, centerY - bodyAmp);
      bodyPath.lineTo(x, centerY + bodyAmp);
      peakPath.moveTo(x, centerY - peakAmp);
      peakPath.lineTo(x, centerY + peakAmp);
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.2;
    ctx.stroke(peakPath);
    ctx.globalAlpha = 0.78;
    ctx.stroke(bodyPath);
    return;
  }

  const ratio = segmentPeaks.length <= 1 ? 0 : (segmentPeaks.length - 1) / (pixelWidth - 1);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.78;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < pixelWidth; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, segmentPeaks.length - 1);
    const t = srcIdx - lo;
    const val = segmentPeaks[lo] * (1 - t) + segmentPeaks[hi] * t;
    const amp = Math.max(0.5, val * maxAmp);
    const x = i + 0.5;
    ctx.moveTo(x, centerY - amp);
    ctx.lineTo(x, centerY + amp);
  }
  ctx.stroke();
}

interface WaveformTileProps {
  peaks: number[];
  startIdx: number;
  endIdx: number;
  left: number;
  width: number;
  height: number;
  amplitudeScale: number;
  color: string;
  dpr: number;
}

const WaveformTile = memo(function WaveformTile({
  peaks,
  startIdx,
  endIdx,
  left,
  width,
  height,
  amplitudeScale,
  color,
  dpr,
}: WaveformTileProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawWaveformSegment(canvas, peaks, startIdx, endIdx, width, height, amplitudeScale, color, dpr);
  }, [amplitudeScale, color, dpr, endIdx, height, peaks, startIdx, width]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left,
        width,
        height,
        display: 'block',
      }}
    />
  );
});

export const WaveformCanvas = memo(function WaveformCanvas({
  peaks,
  width,
  height,
  trimStart,
  trimEnd,
  duration,
  amplitudeScale = 1,
  color = '#d4a054',
  peaksUrl,
  sourceWidthPx,
  sourceOffsetPx = 0,
}: WaveformCanvasProps) {
  const [precomputedPeaks, setPrecomputedPeaks] = useState<number[] | null>(null);

  useEffect(() => {
    if (!peaksUrl) {
      setPrecomputedPeaks(null);
      return;
    }

    let cancelled = false;

    loadWaveformPeaks(peaksUrl)
      .then((data) => {
        if (!cancelled && Array.isArray(data)) {
          setPrecomputedPeaks(data);
        }
      })
      .catch((err) => {
        console.warn('[waveform] Failed to load peaks file:', peaksUrl, err);
        if (!cancelled) {
          setPrecomputedPeaks(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [peaksUrl]);

  const activePeaks = precomputedPeaks ?? peaks;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const pixelWidth = Math.max(1, Math.round(width));
  const pixelHeight = Math.max(1, Math.round(height));
  const tileCssWidth = Math.max(MIN_TILE_CSS_WIDTH, Math.floor(MAX_CANVAS_BITMAP_WIDTH / dpr));
  const logicalWidth = Math.max(1, Math.round(sourceWidthPx ?? width));
  const visibleRange = useMemo(
    () => getVisiblePeakRange(activePeaks.length, trimStart, trimEnd, duration),
    [activePeaks.length, duration, trimEnd, trimStart],
  );
  const tiles = useMemo(() => {
    if (!visibleRange || pixelWidth <= 0 || pixelHeight <= 0) return [];

    const visiblePeakCount = visibleRange.endIdx - visibleRange.startIdx;
    const windowStartPx = Math.max(0, Math.min(sourceOffsetPx, logicalWidth - 1));
    const windowEndPx = Math.max(windowStartPx + 1, Math.min(logicalWidth, sourceOffsetPx + pixelWidth));
    const windowSpanPx = Math.max(1, windowEndPx - windowStartPx);
    const tileCount = Math.max(1, Math.ceil(pixelWidth / tileCssWidth));

    return Array.from({ length: tileCount }, (_, index) => {
      const left = index * tileCssWidth;
      const tileWidth = Math.min(tileCssWidth, pixelWidth - left);
      const logicalStartPx = windowStartPx + (left / pixelWidth) * windowSpanPx;
      const logicalEndPx = windowStartPx + ((left + tileWidth) / pixelWidth) * windowSpanPx;
      const startIdx = visibleRange.startIdx + Math.floor((logicalStartPx / logicalWidth) * visiblePeakCount);
      const endIdx = visibleRange.startIdx + Math.ceil((logicalEndPx / logicalWidth) * visiblePeakCount);
      const safeStartIdx = Math.max(visibleRange.startIdx, Math.min(startIdx, visibleRange.endIdx - 1));
      return {
        key: `${left}:${tileWidth}:${startIdx}:${endIdx}`,
        left,
        width: tileWidth,
        startIdx: safeStartIdx,
        endIdx: Math.max(
          safeStartIdx + 1,
          Math.min(endIdx, visibleRange.endIdx),
        ),
      };
    });
  }, [logicalWidth, pixelHeight, pixelWidth, sourceOffsetPx, tileCssWidth, visibleRange]);

  if (activePeaks.length === 0 || width <= 0 || height <= 0 || tiles.length === 0) {
    return null;
  }

  return (
    <div
      className="clip-card__waveform"
      style={{ width, height }}
      aria-hidden="true"
    >
      {tiles.map((tile) => (
        <WaveformTile
          key={tile.key}
          peaks={activePeaks}
          startIdx={tile.startIdx}
          endIdx={tile.endIdx}
          left={tile.left}
          width={tile.width}
          height={height}
          amplitudeScale={amplitudeScale}
          color={color}
          dpr={dpr}
        />
      ))}
    </div>
  );
});
