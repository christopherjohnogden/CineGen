import type { ProjectSet } from '@/types/sets';
import type { StandIn } from '@/lib/sets/scene';
import { cameraFrustum, planBounds, toPlan } from '@/lib/sets/floor-plan';
import { horizontalFov } from '@/lib/sets/optics';

const SIZE = 100;

/**
 * Overhead plan of a Set: every saved camera's frustum and every mark.
 *
 * Pure presentation over `lib/sets/floor-plan` — Scene Blocking (build step 5)
 * renders the same geometry for a whole scene, so the projection stays in the
 * lib and only the drawing lives here.
 */
export function FloorPlan({ set, standIns = [] }: { set: ProjectSet; standIns?: StandIn[] }) {
  const bounds = planBounds(set.marks, set.cameras, standIns);

  return (
    <figure className="floor-plan" data-testid="floor-plan">
      <figcaption className="floor-plan__caption">Overhead</figcaption>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`Overhead plan of ${set.name}`}>
        <rect x="0" y="0" width={SIZE} height={SIZE} className="floor-plan__ground" />

        {set.cameras.map((camera) => {
          const wedge = cameraFrustum(
            camera,
            horizontalFov(camera.focalMm, { widthMm: camera.sensorWidthMm, heightMm: camera.sensorHeightMm }),
            bounds,
            SIZE,
          );
          return (
            <g key={camera.id} className="floor-plan__camera">
              <polygon points={`${wedge.apex.x},${wedge.apex.y} ${wedge.left.x},${wedge.left.y} ${wedge.right.x},${wedge.right.y}`} />
              <circle cx={wedge.apex.x} cy={wedge.apex.y} r="1.6" />
            </g>
          );
        })}

        {set.marks.map((mark) => {
          const point = toPlan(mark.x, mark.z, bounds, SIZE);
          return (
            <g key={mark.id} className="floor-plan__mark">
              <circle cx={point.x} cy={point.y} r="1.8" />
              <text x={point.x + 3} y={point.y + 1.5}>{mark.name}</text>
            </g>
          );
        })}

        {standIns.map((standIn) => {
          const point = toPlan(standIn.x, standIn.z, bounds, SIZE);
          return <circle key={standIn.id} className="floor-plan__standin" cx={point.x} cy={point.y} r="2.2" />;
        })}
      </svg>
    </figure>
  );
}
