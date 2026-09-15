import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Quaternion, Vector3 } from 'three';

import type { RotationAxis } from '@/lib/sets/navigation';
const RINGS = [
  { axis: 'x', color: '#ee737e', basis: [[0, 1, 0], [0, 0, 1]] },
  { axis: 'y', color: '#98c980', basis: [[0, 0, 1], [1, 0, 0]] },
  { axis: 'z', color: '#78aaf0', basis: [[1, 0, 0], [0, 1, 0]] },
] as const;
const CENTER = 70;
const RADIUS = 48;
const SAMPLES = 96;

/** Colored world-axis rings. The drag tangent is frozen on grab, so rotating
 * the view cannot change the axis or reverse the gesture under the pointer. */
export function ViewGizmo({ quaternion, onRotate }: {
  quaternion: Quaternion;
  onRotate: (axis: RotationAxis, radians: number) => void;
}) {
  const [active, setActive] = useState<RotationAxis | null>(null);
  const drag = useRef<{ axis: RotationAxis; pointer: number; x: number; y: number; tx: number; ty: number; scale: number; center?: { x: number; y: number }; angle?: number } | null>(null);
  const inverse = quaternion.clone().invert();
  const project = (point: Vector3) => point.applyQuaternion(inverse);
  const rings = RINGS.map((ring) => {
    const u = project(new Vector3(...ring.basis[0]));
    const v = project(new Vector3(...ring.basis[1]));
    const points = Array.from({ length: SAMPLES + 1 }, (_, i) => {
      const angle = i * Math.PI * 2 / SAMPLES;
      return {
        x: CENTER + RADIUS * (u.x * Math.cos(angle) + v.x * Math.sin(angle)),
        y: CENTER - RADIUS * (u.y * Math.cos(angle) + v.y * Math.sin(angle)),
        z: u.z * Math.cos(angle) + v.z * Math.sin(angle),
        tx: RADIUS * (-u.x * Math.sin(angle) + v.x * Math.cos(angle)),
        ty: -RADIUS * (-u.y * Math.sin(angle) + v.y * Math.cos(angle)),
      };
    });
    return { ...ring, points, path: points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ') };
  });
  const corners = Array.from({ length: 8 }, (_, i) => project(new Vector3(i & 1 ? 19 : -19, i & 2 ? 19 : -19, i & 4 ? 19 : -19)));
  const faces = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]
    .map((face, i) => ({ face, i, z: face.reduce((sum, corner) => sum + corners[corner].z, 0) }))
    .sort((a, b) => a.z - b.z);

  const begin = (event: ReactPointerEvent<SVGPathElement>, ring: typeof rings[number]) => {
    if (event.button !== 0 || drag.current) return;
    event.preventDefault();
    const rect = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const scale = 140 / rect.width;
    const x = (event.clientX - rect.left) * scale, y = (event.clientY - rect.top) * scale;
    const nearest = ring.points.reduce((a, b) => Math.hypot(b.x - x, b.y - y) < Math.hypot(a.x - x, a.y - y) ? b : a);
    const tangent = nearest.tx ** 2 + nearest.ty ** 2 < 100 ? { tx: 40, ty: 0 } : nearest;
    drag.current = { axis: ring.axis, pointer: event.pointerId, x: event.clientX, y: event.clientY, tx: tangent.tx, ty: tangent.ty, scale };
    setActive(ring.axis);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const beginRoll = (event: ReactPointerEvent<SVGCircleElement>) => {
    if (event.button !== 0 || drag.current) return;
    event.preventDefault();
    const rect = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    drag.current = { axis: 'roll', pointer: event.pointerId, x: event.clientX, y: event.clientY,
      tx: 0, ty: 0, scale: 1, center, angle: Math.atan2(event.clientY - center.y, event.clientX - center.x) };
    setActive('roll');
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: ReactPointerEvent<SVGPathElement | SVGCircleElement>) => {
    const state = drag.current;
    if (!state || state.pointer !== event.pointerId) return;
    if (state.center) {
      // Track angle around the whole ring, including crossing the -PI/PI seam.
      if (Math.hypot(event.clientX - state.center.x, event.clientY - state.center.y) < 8) {
        state.angle = undefined;
        return;
      }
      const angle = Math.atan2(event.clientY - state.center.y, event.clientX - state.center.x);
      if (state.angle !== undefined) {
        const delta = angle - state.angle;
        onRotate('roll', Math.atan2(Math.sin(delta), Math.cos(delta)));
      }
      state.angle = angle;
      return;
    }
    const delta = ((event.clientX - state.x) * state.tx + (event.clientY - state.y) * state.ty) * state.scale / (state.tx ** 2 + state.ty ** 2);
    onRotate(state.axis, Math.max(-0.3, Math.min(0.3, delta)));
    state.x = event.clientX; state.y = event.clientY;
  };
  const end = (event: ReactPointerEvent<SVGPathElement | SVGCircleElement>) => {
    if (drag.current?.pointer !== event.pointerId) return;
    drag.current = null; setActive(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div className="set-viewer__gizmo" role="group" aria-label="3D rotation rings" data-testid="set-viewer-gizmo">
      <svg viewBox="0 0 140 140">
        <g className={`set-viewer__rotation-ring${active === 'roll' ? ' is-active' : ''}`}>
          <circle className="set-viewer__gizmo-outline" cx="70" cy="70" r="62" pointerEvents="none" />
          <circle className="set-viewer__rotation-hit" cx="70" cy="70" r="62"
            role="button" tabIndex={0} aria-label="Roll camera" data-axis="roll"
            onPointerDown={beginRoll} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
              event.preventDefault();
              onRotate('roll', (event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1) * Math.PI / 36);
            }}>
            <title>Drag to roll the camera · arrow keys roll 5°</title>
          </circle>
        </g>
        {rings.map((ring) => <path key={`back-${ring.axis}`} d={ring.path} fill="none" stroke={ring.color} strokeWidth="2" opacity="0.22" pointerEvents="none" />)}
        <g pointerEvents="none">
          {faces.map(({ face, i }) => <polygon key={i} points={face.map((index) => `${CENTER + corners[index].x},${CENTER - corners[index].y}`).join(' ')} fill={['#3a414b', '#555f6b', '#333a44', '#697581', '#434b56', '#505a66'][i]} stroke="#a2aab3" strokeWidth="0.8" />)}
        </g>
        {rings.map((ring) => <g key={ring.axis} className={`set-viewer__rotation-ring${active === ring.axis ? ' is-active' : ''}`}>
          {ring.points.slice(0, -1).map((p, i) => p.z >= 0 && <line key={i} x1={p.x} y1={p.y} x2={ring.points[i + 1].x} y2={ring.points[i + 1].y} stroke={ring.color} strokeWidth="3" strokeLinecap="round" pointerEvents="none" />)}
          <path d={ring.path} className="set-viewer__rotation-hit" role="button" tabIndex={0}
            aria-label={`Rotate ${ring.axis.toUpperCase()} axis`} data-axis={ring.axis}
            onPointerDown={(event) => begin(event, ring)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
              event.preventDefault();
              onRotate(ring.axis, (event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1) * Math.PI / 36);
            }}>
            <title>Drag to rotate around {ring.axis.toUpperCase()} · arrow keys rotate 5°</title>
          </path>
        </g>)}
      </svg>
      <span className="set-viewer__gizmo-caption">{active === 'roll' ? 'Camera roll' : active ? `${active.toUpperCase()} rotation` : 'Drag a ring · outer: roll'}</span>
    </div>
  );
}
