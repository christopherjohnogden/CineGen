import { useCallback, useRef, useEffect } from 'react';

interface TimeRulerProps {
  pxPerSecond: number;
  duration: number;
  currentTime: number;
  onSeek: (time: number) => void;
  scrollLeft: number;
  trackAreaWidth: number;
}

function formatTimecode(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.floor((seconds % 1) * 24);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}

export function TimeRuler({
  pxPerSecond,
  duration,
  currentTime,
  onSeek,
  scrollLeft,
  trackAreaWidth,
}: TimeRulerProps) {
  const rulerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const xToTime = useCallback((clientX: number) => {
    if (!rulerRef.current) return 0;
    const rect = rulerRef.current.getBoundingClientRect();
    const x = clientX - rect.left + scrollLeft;
    const maxSeek = duration + Math.max(10, duration * 0.5);
    return Math.max(0, Math.min(x / pxPerSecond, maxSeek));
  }, [pxPerSecond, scrollLeft, duration]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isDragging.current = true;
    onSeek(xToTime(e.clientX));
    e.preventDefault();
  }, [xToTime, onSeek]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      onSeek(xToTime(e.clientX));
    };
    const handleMouseUp = () => { isDragging.current = false; };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [xToTime, onSeek]);

  let majorInterval: number;
  if (pxPerSecond >= 100) majorInterval = 1;
  else if (pxPerSecond >= 30) majorInterval = 5;
  else majorInterval = 10;

  const totalWidth = Math.max(duration * pxPerSecond + 200, trackAreaWidth);
  const totalSeconds = totalWidth / pxPerSecond;
  const ticks: { time: number; isMajor: boolean }[] = [];

  for (let t = 0; t <= totalSeconds + majorInterval; t += majorInterval / 2) {
    ticks.push({ time: t, isMajor: t % majorInterval === 0 });
  }

  const playheadX = currentTime * pxPerSecond;

  return (
    <div className="time-ruler" ref={rulerRef} onMouseDown={handleMouseDown} style={{ width: totalWidth }}>
      {ticks.map(({ time, isMajor }) => (
        <div
          key={time}
          className={`time-ruler__tick ${isMajor ? 'time-ruler__tick--major' : ''}`}
          style={{ left: time * pxPerSecond }}
        >
          {isMajor && <span className="time-ruler__label">{formatTimecode(time)}</span>}
        </div>
      ))}
      <div className="time-ruler__playhead" style={{ left: playheadX }}>
        <div className="time-ruler__playhead-head" />
      </div>
    </div>
  );
}

export { formatTimecode };
