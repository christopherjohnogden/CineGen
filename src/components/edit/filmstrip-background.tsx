import { useMemo, type CSSProperties } from 'react';

interface FilmstripBackgroundProps {
  filmstripUrl: string;
  assetDuration: number;
  trimStart: number;
  clipDuration: number;
  clipWidthPx: number;
  renderWidthPx: number;
  sourceOffsetPx?: number;
}

export function FilmstripBackground({
  filmstripUrl,
  assetDuration,
  trimStart,
  clipDuration,
  clipWidthPx,
  renderWidthPx,
  sourceOffsetPx = 0,
}: FilmstripBackgroundProps) {
  // Worker sprite generation caps frames at 120.
  const totalFrames = Math.max(1, Math.min(Math.ceil(assetDuration), 120));
  const totalSegments = Math.max(1, Math.floor(clipWidthPx / 80));
  const renderWindow = useMemo(() => {
    if (renderWidthPx <= 0) return null;
    const startPx = Math.max(0, Math.min(sourceOffsetPx, clipWidthPx));
    const endPx = Math.max(startPx, Math.min(clipWidthPx, sourceOffsetPx + renderWidthPx));
    return { startPx, endPx };
  }, [clipWidthPx, renderWidthPx, sourceOffsetPx]);

  const segments = useMemo(() => {
    if (!renderWindow) return [];

    if (totalSegments === 1) {
      const midpoint = trimStart + clipDuration * 0.5;
      const progress = assetDuration > 0 ? Math.max(0, Math.min(1, midpoint / assetDuration)) : 0;
      const idx = Math.round(progress * (totalFrames - 1));
      return [{
        key: 'single',
        left: 0,
        width: renderWindow.endPx - renderWindow.startPx,
        bgPos: totalFrames > 1 ? (idx / (totalFrames - 1)) * 100 : 0,
      }];
    }

    const segmentWidth = clipWidthPx / totalSegments;
    const startIndex = Math.max(0, Math.floor(renderWindow.startPx / segmentWidth));
    const endIndex = Math.min(totalSegments, Math.ceil(renderWindow.endPx / segmentWidth));
    const nextSegments: { key: string; left: number; width: number; bgPos: number }[] = [];

    for (let i = startIndex; i < endIndex; i++) {
      const segmentStart = i * segmentWidth;
      const segmentEnd = Math.min(segmentStart + segmentWidth, clipWidthPx);
      const overlapStart = Math.max(segmentStart, renderWindow.startPx);
      const overlapEnd = Math.min(segmentEnd, renderWindow.endPx);
      if (overlapEnd <= overlapStart) continue;
      const t = totalSegments <= 1 ? 0.5 : i / (totalSegments - 1);
      const localT = trimStart + clipDuration * t;
      const progress = assetDuration > 0 ? Math.max(0, Math.min(1, localT / assetDuration)) : 0;
      const idx = Math.round(progress * (totalFrames - 1));
      nextSegments.push({
        key: `${i}:${overlapStart}`,
        left: overlapStart - renderWindow.startPx,
        width: overlapEnd - overlapStart,
        bgPos: totalFrames > 1 ? (idx / (totalFrames - 1)) * 100 : 0,
      });
    }

    return nextSegments;
  }, [assetDuration, clipDuration, clipWidthPx, renderWindow, totalFrames, totalSegments, trimStart]);

  return (
    <div
      className="clip-card__filmstrip"
      style={{ '--filmstrip-gap': totalSegments <= 2 ? '2px' : '8px' } as CSSProperties}
    >
      {segments.map((segment) => (
        <div
          key={segment.key}
          className="clip-card__filmstrip-frame clip-card__filmstrip-frame--sprite"
          style={{
            position: 'absolute',
            top: 0,
            left: segment.left,
            width: segment.width,
            height: '100%',
            backgroundImage: `url(${filmstripUrl})`,
            backgroundSize: `${totalFrames * 100}% 100%`,
            backgroundPosition: `${segment.bgPos}% 0%`,
            backgroundRepeat: 'no-repeat',
          }}
        />
      ))}
    </div>
  );
}
