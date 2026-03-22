

import { useRef, useState, useCallback, useEffect } from 'react';

interface ImageCompareProps {
  beforeUrl: string;
  afterUrl: string;
  className?: string;
  dragHandleOnly?: boolean;
}

export function ImageCompare({ beforeUrl, afterUrl, className, dragHandleOnly = false }: ImageCompareProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(50);
  const [dragging, setDragging] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const updatePosition = useCallback((clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    setPosition((x / rect.width) * 100);
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    updatePosition(e.clientX);
  }, [updatePosition]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!dragging) return;
    e.preventDefault();
    e.stopPropagation();
    updatePosition(e.clientX);
  }, [dragging, updatePosition]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
  }, []);

  return (
    <div
      ref={containerRef}
      className={`image-compare${dragHandleOnly ? ' image-compare--handle-only' : ''} ${className ?? ''}`.trim()}
      onPointerDown={dragHandleOnly ? undefined : handlePointerDown}
      onPointerMove={dragHandleOnly ? undefined : handlePointerMove}
      onPointerUp={dragHandleOnly ? undefined : handlePointerUp}
      onDragStart={(e) => e.preventDefault()}
    >
      {/* After (current) -- full width behind */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={afterUrl}
        alt="After"
        className="image-compare__img image-compare__after"
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
      />

      {/* Before (previous) -- clipped to left of divider */}
      <div className="image-compare__before-clip" style={{ width: `${position}%` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={beforeUrl}
          alt="Before"
          className="image-compare__img image-compare__before"
          style={containerWidth ? { width: containerWidth } : undefined}
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
        />
      </div>

      {/* Divider line */}
      <div
        className="image-compare__divider"
        style={{ left: `${position}%` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="image-compare__handle">
          <svg width="12" height="20" viewBox="0 0 12 20" fill="none">
            <path d="M4 0L0 4L4 8" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 0L12 4L8 8" stroke="currentColor" strokeWidth="1.5" transform="translate(0 12)" />
          </svg>
        </div>
      </div>
    </div>
  );
}
