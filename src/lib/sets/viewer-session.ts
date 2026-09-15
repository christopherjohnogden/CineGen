import type { SetStartView } from '@/types/sets';
import type { ScanTuning } from './scene';
import type { SensorSize } from './optics';

export interface ViewerSession {
  camera: SetStartView;
  focalMm: number;
  sensor: SensorSize;
  navMode: 'look' | 'pan' | 'orbit';
  tuning: ScanTuning;
  placementMode: 'floor' | 'pick-floor' | 'standin' | null;
  selectedStandIn: string | null;
  floorGizmoMode: 'move' | 'tilt' | 'size';
  standInGizmoMode: 'move' | 'rotate' | 'size';
  openSections: string[];
  panelScroll: number;
}
export function viewerSessionKey(projectId: string, setId: string): string {
  return `cinegen_set_view:${projectId}:${setId}`;
}
export function readViewerSession(key?: string): ViewerSession | undefined {
  if (!key) return;
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null');
    const vec = (v: unknown): v is number[] => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n));
    if (!value || !vec(value.camera?.position) || !vec(value.camera?.target) || !vec(value.camera?.up)
      || !(value.focalMm > 0) || !(value.sensor?.widthMm > 0) || !(value.sensor?.heightMm > 0)
      || !['look','pan','orbit'].includes(value.navMode)) return;
    return value as ViewerSession;
  } catch { return; }
}
export function writeViewerSession(key: string | undefined, value: ViewerSession): void {
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage may be unavailable. */ }
}
export function readLastSet(projectId: string): string | null {
  try { return localStorage.getItem(`cinegen_last_set:${projectId}`); } catch { return null; }
}
export function writeLastSet(projectId: string, setId: string | null): void {
  try {
    const key = `cinegen_last_set:${projectId}`;
    if (setId) localStorage.setItem(key, setId); else localStorage.removeItem(key);
  } catch { /* Navigation still works without storage. */ }
}
