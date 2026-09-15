import type { ProjectSet, SetCamera, SetMark, SplatFormat } from '@/types/sets';
import { generateId, timestamp } from '@/lib/utils/ids';

/**
 * Hydration never trusts stored data.
 *
 * There is no schema version to migrate against in this codebase — forward
 * compatibility is per-field parsing at load time — and everything here ends up
 * as three.js geometry, where a single NaN silently blanks a render instead of
 * throwing. So anything unusable is dropped rather than coerced.
 */

const SPLAT_FORMATS: readonly SplatFormat[] = ['ply', 'spz', 'sog', 'splat', 'ksplat'];

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function vec3(value: unknown): [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  const [x, y, z] = value.map(num);
  if (x === undefined || y === undefined || z === undefined) return undefined;
  return [x, y, z];
}

/** Diagonal FOV in degrees, so a stored camera always has one even if it predates the field. */
function diagonalFovDeg(focalMm: number, sensorW: number, sensorH: number): number {
  const diagonal = Math.hypot(sensorW, sensorH);
  return (2 * Math.atan(diagonal / (2 * focalMm)) * 180) / Math.PI;
}

function normalizeMark(value: unknown): SetMark[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const x = num(record.x);
  const z = num(record.z);
  if (x === undefined || z === undefined) return [];
  return [{
    id: str(record.id, generateId()),
    name: str(record.name, 'Mark'),
    x,
    z,
    facing: num(record.facing) ?? 0,
  }];
}

function normalizeCamera(value: unknown): SetCamera[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const position = vec3(record.position);
  const target = vec3(record.target);
  const up = vec3(record.up);
  if (!position || !target) return [];

  const focalMm = num(record.focalMm) ?? 50;
  const sensorWidthMm = num(record.sensorWidthMm) ?? 36;
  const sensorHeightMm = num(record.sensorHeightMm) ?? 24;
  return [{
    id: str(record.id, generateId()),
    name: str(record.name, 'Camera'),
    createdAt: str(record.createdAt, timestamp()),
    position,
    target,
    ...(up && Math.hypot(...up) > 0 ? { up } : {}),
    focalMm,
    sensorWidthMm,
    sensorHeightMm,
    aspect: str(record.aspect, '16:9'),
    fovDiagonal: num(record.fovDiagonal) ?? diagonalFovDeg(focalMm, sensorWidthMm, sensorHeightMm),
    ...(num(record.subjectDistance) !== undefined ? { subjectDistance: num(record.subjectDistance) } : {}),
  }];
}

export function normalizeProjectSets(value: unknown): ProjectSet[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const now = timestamp();
    const createdAt = str(record.createdAt, now);

    const format = typeof record.splatFormat === 'string'
      ? SPLAT_FORMATS.find((candidate) => candidate === record.splatFormat)
      : undefined;
    const splatPath = typeof record.splatPath === 'string' && record.splatPath ? record.splatPath : undefined;
    const thumbnailUrl = typeof record.thumbnailUrl === 'string' && record.thumbnailUrl ? record.thumbnailUrl : undefined;

    // A zero or negative scale would collapse the whole scene, so it is not merely defaulted when absent.
    const scale = num(record.scaleToMeters);
    const rotation = vec3(record.rotationDeg);
    const groundY = num(record.groundY);
    const floorRecord = record.floorPlane && typeof record.floorPlane === 'object' ? record.floorPlane as Record<string, unknown> : undefined;
    const normal = vec3(floorRecord?.normal), constant = num(floorRecord?.constant);
    const length = normal ? Math.hypot(...normal) : 0;
    const floorOrigin = vec3(floorRecord?.origin);
    const floorSize = num(floorRecord?.size);
    const floorXAxis = vec3(floorRecord?.xAxis);
    const floorPlane = normal && length > 1e-8 && constant !== undefined
      ? { normal: normal.map(v => v / length) as [number, number, number], constant: constant / length,
        ...(floorOrigin ? { origin: floorOrigin } : {}),
        ...(floorXAxis && Math.hypot(...floorXAxis) > 1e-8 ? { xAxis: floorXAxis } : {}),
        ...(floorSize !== undefined && floorSize > 0 ? { size: floorSize } : {}) } : undefined;
    const standIns = Array.isArray(record.standIns) ? record.standIns.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const entry = item as Record<string, unknown>;
      const x = num(entry.x), z = num(entry.z);
      if (x === undefined || z === undefined) return [];
      const pose: 'standing' | 'sitting' | 'walking' | 'kneeling' = entry.pose === 'sitting' || entry.pose === 'walking' || entry.pose === 'kneeling' ? entry.pose : 'standing';
      return [{ id: str(entry.id, generateId()), heightM: Math.max(.01, Math.min(10, num(entry.heightM) ?? 1.8)), pose,
        x, z, facing: num(entry.facing) ?? 0,
        ...(typeof entry.visible === 'boolean' ? { visible: entry.visible } : {}),
        ...(vec3(entry.position) ? { position: vec3(entry.position)! } : {}),
        ...(typeof entry.label === 'string' ? { label: entry.label } : {}),
        ...(typeof entry.elementId === 'string' ? { elementId: entry.elementId } : {}),
      }];
    }) : undefined;
    const start = record.startView && typeof record.startView === 'object'
      ? record.startView as Record<string, unknown> : undefined;
    const startPosition = vec3(start?.position), startTarget = vec3(start?.target), startUp = vec3(start?.up);
    const startView = startPosition && startTarget && startPosition.some((v, i) => Math.abs(v - startTarget[i]) > 1e-8)
      ? { position: startPosition, target: startTarget, ...(startUp && Math.hypot(...startUp) > 0 ? { up: startUp } : {}),
        ...(typeof start?.verticalFov === 'number' && Number.isFinite(start.verticalFov) && start.verticalFov > 0 && start.verticalFov < 179 ? { verticalFov: start.verticalFov } : {}),
        ...(typeof start?.sourceImage === 'string' ? { sourceImage: start.sourceImage } : {}),
      } : undefined;

    return [{
      id: str(record.id, generateId()),
      name: str(record.name, 'Untitled Set'),
      createdAt,
      updatedAt: str(record.updatedAt, createdAt),
      ...(splatPath ? { splatPath } : {}),
      ...(format ? { splatFormat: format } : {}),
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
      upAxis: record.upAxis === 'z' ? 'z' : 'y',
      ...(rotation ? { rotationDeg: rotation } : {}),
      ...(groundY !== undefined ? { groundY } : {}),
      ...(floorPlane ? { floorPlane } : {}),
      ...(standIns ? { standIns } : {}),
      ...(startView ? { startView } : {}),
      scaleToMeters: scale !== undefined && scale > 0 ? scale : 1,
      marks: Array.isArray(record.marks) ? record.marks.flatMap(normalizeMark) : [],
      cameras: Array.isArray(record.cameras) ? record.cameras.flatMap(normalizeCamera) : [],
    }];
  });
}
