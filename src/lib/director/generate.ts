import type { Asset, MediaFolder } from '@/types/project';
import type { DirectorBreakdownItem, DirectorClip, DirectorScene, DirectorShow, DirectorTake, IsolateMode, IsolateVariant } from '@/types/director';
import type { Element } from '@/types/elements';
import { generateId, timestamp } from '@/lib/utils/ids';
import { nextTakeNumber, parseVariantKey, takeDisplayName, variantKey, variantTakeLabel } from './slate';
import { planDirectorFolders } from './folders';
import { clipDisplayLabels } from './shotlist';
import { getDirectorAdapter } from './video-adapter';
import { findMatchingElement, normalizeElementName, normalizeTag } from './breakdown';

export function createPendingTake(args: {
  clip: DirectorClip;
  variant: IsolateVariant;
  adapterId: string;
  modelId: string;
  promptSnapshot: string;
  notes?: string;
}): DirectorTake {
  const key = variantKey(args.variant);
  return {
    id: generateId(),
    number: nextTakeNumber(args.clip, key),
    variantKey: key,
    status: 'queued',
    adapterId: args.adapterId,
    modelId: args.modelId,
    promptSnapshot: args.promptSnapshot,
    notes: args.notes,
    createdAt: timestamp(),
  };
}

export function takesForVariant(clip: DirectorClip, key: string): DirectorTake[] {
  return clip.takes
    .filter((take) => take.variantKey === key)
    .sort((a, b) => a.number - b.number);
}

export interface DirectorTakeGroup {
  key: string;
  variant: IsolateVariant;
  label: string;
  takes: DirectorTake[];
}

export function takeCountForShot(clip: DirectorClip, beatN: number): number {
  return takesForVariant(clip, `${beatN}:native`).length + takesForVariant(clip, `${beatN}:held`).length;
}

/** When opening a shot from Full, land on the isolate mode that actually has takes. */
export function preferredIsolateMode(
  clip: DirectorClip,
  beatN: number,
  current?: IsolateVariant,
): IsolateMode {
  if (current?.kind === 'isolated') return current.mode;
  const nativeCount = takesForVariant(clip, `${beatN}:native`).length;
  const heldCount = takesForVariant(clip, `${beatN}:held`).length;
  if (nativeCount > 0 && nativeCount >= heldCount) return 'native';
  if (heldCount > 0) return 'held';
  return 'native';
}

export function takesGroupedForClip(clip: DirectorClip, activeKey: string): DirectorTakeGroup[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const push = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    keys.push(key);
  };
  push('full');
  for (const beat of clip.beats) {
    push(`${beat.n}:native`);
    push(`${beat.n}:held`);
  }
  for (const take of clip.takes) push(take.variantKey);
  return keys
    .map((key) => ({
      key,
      variant: parseVariantKey(key),
      label: variantTakeLabel(clip, key),
      takes: takesForVariant(clip, key),
    }))
    .filter((group) => group.takes.length > 0 || group.key === activeKey);
}

export function runtimeSeconds(clips: DirectorClip[]): number {
  return clips
    .filter((clip) => !clip.altOf)
    .reduce((sum, clip) => sum + clip.seconds, 0);
}

export function clipsForGenerateScope(
  clips: DirectorClip[],
  scope: 'active' | 'queued' | 'scene',
  selectedClipId?: string,
  sceneId?: string,
): DirectorClip[] {
  if (scope === 'active') {
    const id = selectedClipId ?? clips[0]?.id;
    return clips.filter((clip) => clip.id === id);
  }
  if (scope === 'scene') {
    return clips.filter((clip) => clip.sceneId === sceneId && !clip.altOf);
  }
  // Queued means queued only — an empty queue does not fall back to the whole show.
  return clips.filter((clip) => clip.queued);
}

const MAX_ELEMENT_REFS = 8;

function elementForTag(
  tag: string,
  item: DirectorBreakdownItem | undefined,
  elements: Element[],
): Element | undefined {
  if (item?.elementId) {
    const linked = elements.find((element) => element.id === item.elementId);
    if (linked) return linked;
  }
  if (item) {
    const matched = findMatchingElement(elements, item);
    if (matched) return matched;
  }
  return elements.find((element) => (
    normalizeTag(element.name) === tag
    || normalizeElementName(element.name) === normalizeElementName(tag)
  ));
}

/** First still for each tagged clip element, then framing ref, then the staging map LAST. */
export function collectClipElementRefs(
  clip: DirectorClip,
  breakdown: DirectorBreakdownItem[],
  elements: Element[],
): string[] {
  const primary: string[] = [];
  const staging: string[] = [];
  const push = (bucket: string[], raw?: string) => {
    if (!raw?.trim()) return;
    const tag = raw.startsWith('@') ? raw : `@${raw}`;
    if (!primary.includes(tag) && !staging.includes(tag)) bucket.push(tag);
  };

  for (const tag of clip.elementTags) {
    const normalized = tag.startsWith('@') ? tag : `@${tag}`;
    push(/^@staging[_-]/i.test(normalized) ? staging : primary, tag);
  }
  if (clip.framingRefOn) push(primary, clip.framingRefTag);
  if (clip.staging?.enabled) push(staging, clip.staging.stagingTag);

  const stillFor = (tag: string) => {
    const item = breakdown.find((entry) => entry.tag === tag);
    return elementForTag(tag, item, elements)?.images.find((image) => image.url.trim())?.url.trim();
  };

  const urls: string[] = [];
  const stagingUrls = staging.map(stillFor).filter((url): url is string => Boolean(url));
  if (clip.staging?.enabled && clip.staging.diagramUrl?.trim() && !stagingUrls.includes(clip.staging.diagramUrl.trim())) {
    stagingUrls.push(clip.staging.diagramUrl.trim());
  }
  const maxPrimary = Math.max(0, MAX_ELEMENT_REFS - (stagingUrls.length > 0 ? 1 : 0));
  for (const tag of primary) {
    if (urls.length >= maxPrimary) break;
    const url = stillFor(tag);
    if (url && !urls.includes(url)) urls.push(url);
  }
  for (const url of stagingUrls) {
    if (urls.length >= MAX_ELEMENT_REFS) break;
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}

export function isDirectorTakeLive(take?: DirectorTake): boolean {
  return take?.status === 'running' || take?.status === 'queued';
}

export function takeChipLabel(take: Pick<DirectorTake, 'number'>): string {
  return `T${String(take.number).padStart(2, '0')}`;
}

export function generateViewerMessage(take: DirectorTake | undefined, hasUrl: boolean): string {
  if (hasUrl) return '';
  if (take?.status === 'running' || take?.status === 'queued') {
    return `${takeChipLabel(take)} generating…`;
  }
  if (take?.status === 'failed') {
    return take.error?.trim() || 'Generation failed. Check Higgsfield CLI is installed and connected in Settings.';
  }
  return 'No take yet for this variant';
}

export function deleteTakeConfirmCopy(take: DirectorTake): { title: string; description: string } {
  const label = takeChipLabel(take);
  const title = `Delete ${label}`;
  if (isDirectorTakeLive(take)) {
    return { title, description: 'It is still generating. This cannot be undone.' };
  }
  if (take.hero) {
    return { title, description: 'This is the marked hero. This cannot be undone.' };
  }
  return { title, description: 'This cannot be undone.' };
}

export function generationPreflight(args: {
  clipCount: number;
  seconds: number;
  adapterLabel: string;
  higgsfieldConnected?: boolean;
  higgsfieldError?: string;
}): { summary: string; warnings: string[] } {
  const warnings: string[] = [];
  if (args.higgsfieldConnected === false) {
    warnings.push(args.higgsfieldError?.trim() || 'Higgsfield CLI is not connected. Generation will fail until it is.');
  }
  return {
    summary: `${args.clipCount} clip${args.clipCount === 1 ? '' : 's'} · ${args.seconds}s · ${args.adapterLabel}`,
    warnings,
  };
}

export function prepareDirectorGeneration(args: {
  show: DirectorShow;
  scene: DirectorScene;
  clip: DirectorClip;
  folders: MediaFolder[];
  elements?: Element[];
}): {
  foldersToAdd: MediaFolder[];
  foldersToRename: Array<{ id: string; name: string }>;
  take: DirectorTake;
  asset: Asset;
  request: ReturnType<ReturnType<typeof getDirectorAdapter>['buildRequest']>;
  variantFolderId: string;
} {
  const adapter = getDirectorAdapter(args.show.adapterId);
  const variant = args.clip.activeVariant;
  const referenceImages = collectClipElementRefs(args.clip, args.show.breakdown, args.elements ?? []);
  const request = adapter.buildRequest({ show: args.show, clip: args.clip, variant, referenceImages });
  const key = variantKey(variant);
  const scenes = args.show.scenes.some((entry) => entry.id === args.scene.id)
    ? args.show.scenes
    : [...args.show.scenes, args.scene];
  const clips = args.show.clips.some((entry) => entry.id === args.clip.id)
    ? args.show.clips
    : [...args.show.clips, args.clip];
  const clipLabel = clipDisplayLabels(scenes, clips).get(args.clip.id);
  const planned = planDirectorFolders({
    folders: args.folders,
    scene: args.scene,
    clip: args.clip,
    variantKey: key,
    clipLabel,
  });
  const take = createPendingTake({
    clip: args.clip,
    variant,
    adapterId: adapter.id,
    modelId: adapter.modelId,
    promptSnapshot: request.prompt,
  });
  take.status = 'running';
  const assetId = generateId();
  take.assetId = assetId;
  const asset: Asset = {
    id: assetId,
    name: takeDisplayName(args.scene, args.clip, key, take.number, clipLabel),
    type: 'video',
    url: '',
    duration: request.durationSec,
    createdAt: timestamp(),
    folderId: planned.variantId,
    metadata: {
      generating: true,
      generatedVia: 'director',
      directorClipId: args.clip.id,
      directorTakeId: take.id,
      directorVariant: key,
      higgsfieldModel: adapter.modelId,
    },
  };
  return {
    foldersToAdd: planned.foldersToAdd,
    foldersToRename: planned.foldersToRename,
    take,
    asset,
    request,
    variantFolderId: planned.variantId,
  };
}
