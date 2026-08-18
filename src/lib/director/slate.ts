import type { DirectorClip, DirectorScene, IsolateVariant } from '@/types/director';

export function variantKey(variant: IsolateVariant): string {
  if (variant.kind === 'full') return 'full';
  return `${variant.beatN}:${variant.mode}`;
}

export function parseVariantKey(key: string): IsolateVariant {
  if (!key || key === 'full') return { kind: 'full' };
  const [beat, mode] = key.split(':');
  const beatN = Number(beat);
  if (!Number.isFinite(beatN) || (mode !== 'held' && mode !== 'native')) {
    return { kind: 'full' };
  }
  return { kind: 'isolated', beatN, mode };
}

export function padSceneNumber(n: number): string {
  return String(Math.max(0, Math.trunc(n))).padStart(2, '0');
}

export function sceneFolderName(scene: DirectorScene): string {
  const label = scene.label.replace(/^SCENE\s+\d+\s*[—–-]\s*/i, '').trim() || scene.label;
  return `Scene ${padSceneNumber(scene.number)} — ${label}`;
}

export function clipFolderName(clip: DirectorClip): string {
  return `${clip.id} — ${clip.title}`.trim();
}

export function variantFolderName(clip: DirectorClip, key: string): string {
  const variant = parseVariantKey(key);
  if (variant.kind === 'full') return 'Full';
  const beat = clip.beats.find((entry) => entry.n === variant.beatN);
  const seconds = variant.mode === 'native' ? (beat?.dur ?? clip.seconds) : clip.seconds;
  return `Shot ${variant.beatN} · ${seconds}s`;
}

export function takeDisplayName(
  scene: DirectorScene,
  clip: DirectorClip,
  key: string,
  takeNumber: number,
): string {
  const sceneCode = `S${padSceneNumber(scene.number)}`;
  const take = `T${String(takeNumber).padStart(2, '0')}`;
  const variant = parseVariantKey(key);
  if (variant.kind === 'full') return `${sceneCode}_${clip.id}_${take}`;
  if (variant.mode === 'held') return `${sceneCode}_${clip.id}_S${variant.beatN}x${clip.seconds}_${take}`;
  return `${sceneCode}_${clip.id}_S${variant.beatN}_${take}`;
}

export function nextTakeNumber(clip: DirectorClip, key: string): number {
  const existing = clip.takes.filter((take) => take.variantKey === key);
  if (existing.length === 0) return 1;
  return Math.max(...existing.map((take) => take.number)) + 1;
}

export function diskRelativeDir(scene: DirectorScene, clip: DirectorClip, key: string): string {
  return `director/S${padSceneNumber(scene.number)}/${clip.id}/${key.replace(':', '-')}`;
}
