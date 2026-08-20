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

export function clipFolderName(clip: DirectorClip, clipLabel?: string): string {
  const slate = clipLabel?.trim() || clip.id;
  return `${slate} — ${clip.title}`.trim();
}

export function variantFolderName(clip: DirectorClip, key: string): string {
  const variant = parseVariantKey(key);
  if (variant.kind === 'full') return 'Full';
  const beat = clip.beats.find((entry) => entry.n === variant.beatN);
  const seconds = variant.mode === 'native' ? (beat?.dur ?? clip.seconds) : clip.seconds;
  return `Shot ${variant.beatN} · ${seconds}s`;
}

/** Compact Generate-board label: Full vs S1 · 7s vs S1 · 20s held. */
export function variantTakeLabel(clip: DirectorClip, key: string): string {
  const variant = parseVariantKey(key);
  if (variant.kind === 'full') return 'Full';
  const beat = clip.beats.find((entry) => entry.n === variant.beatN);
  if (variant.mode === 'native') return `S${variant.beatN} · ${beat?.dur ?? clip.seconds}s`;
  return `S${variant.beatN} · ${clip.seconds}s held`;
}

export function takeDisplayName(
  scene: DirectorScene,
  clip: DirectorClip,
  key: string,
  takeNumber: number,
  clipLabel?: string,
): string {
  const slate = clipLabel?.trim() || clip.id;
  const take = `T${String(takeNumber).padStart(2, '0')}`;
  const variant = parseVariantKey(key);
  if (variant.kind === 'full') return `${slate} · ${take}`;
  if (variant.mode === 'held') return `${slate} · S${variant.beatN} held · ${take}`;
  return `${slate} · S${variant.beatN} · ${take}`;
}

/** Old media-pool names leaked the stored clip id (`S01_1-p0a_S1_T01`). */
export function isLegacyTakeDisplayName(name: string, clipId: string): boolean {
  const base = name.replace(/\s+failed$/i, '').trim();
  const parts = base.split('_');
  return parts.length >= 3 && /^S\d+$/i.test(parts[0]) && parts[1] === clipId;
}

export function nextTakeNumber(clip: DirectorClip, key: string): number {
  const existing = clip.takes.filter((take) => take.variantKey === key);
  if (existing.length === 0) return 1;
  return Math.max(...existing.map((take) => take.number)) + 1;
}

export function diskRelativeDir(scene: DirectorScene, clip: DirectorClip, key: string): string {
  return `director/S${padSceneNumber(scene.number)}/${clip.id}/${key.replace(':', '-')}`;
}
