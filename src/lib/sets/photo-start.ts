import * as THREE from 'three';
import type { SetStartView } from '@/types/sets';

/** Explicit companion format: the pose is already aligned to the exported
 * splat, in scan-local coordinates. Never guess a raw camera file's convention. */
export function parsePhotoStart(value: unknown): SetStartView | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (data.format !== 'cinegen-start-view' || data.version !== 1 || data.coordinates !== 'splat-local') return null;
  const vector = (v: unknown): v is [number, number, number] =>
    Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
  if (!vector(data.position) || !vector(data.target) || !vector(data.up)) return null;
  const direction = new THREE.Vector3(...data.target).sub(new THREE.Vector3(...data.position));
  const up = new THREE.Vector3(...data.up);
  if (direction.length() < 1e-8 || up.length() < 1e-8 || direction.clone().normalize().cross(up.clone().normalize()).length() < 1e-6) return null;
  if (typeof data.verticalFov !== 'number' || !Number.isFinite(data.verticalFov) || data.verticalFov <= 0 || data.verticalFov >= 179) return null;
  return { position: [...data.position], target: [...data.target], up: up.normalize().toArray(), verticalFov: data.verticalFov,
    ...(typeof data.sourceImage === 'string' ? { sourceImage: data.sourceImage } : {}) };
}

/** Room.ply pairs with Room.start-view.json. Optional metadata must never stop
 * a scan opening; existing scans keep the estimated-view fallback. */
export async function loadPhotoStart(splatUrl: string | undefined, signal?: AbortSignal): Promise<SetStartView | null> {
  if (!splatUrl) return null;
  try {
    const url = new URL(splatUrl, window.location.href);
    if (!/\.(ply|spz|sog|splat|ksplat)$/i.test(url.pathname)) return null;
    url.pathname = url.pathname.replace(/\.[^.]+$/, '.start-view.json');
    const response = await fetch(url.href, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000), cache: 'no-store' });
    if (!response.ok) return null;
    return parsePhotoStart(await response.json());
  } catch {
    return null;
  }
}
