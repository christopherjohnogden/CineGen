import type { Asset, MediaFolder } from '@/types/project';
import type { DirectorClip, DirectorScene, DirectorShow, DirectorTake, IsolateVariant } from '@/types/director';
import { generateId, timestamp } from '@/lib/utils/ids';
import { nextTakeNumber, takeDisplayName, variantKey } from './slate';
import { planDirectorFolders } from './folders';
import { getDirectorAdapter } from './video-adapter';

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
    return clips.filter((clip) => clip.id === selectedClipId);
  }
  if (scope === 'scene') {
    return clips.filter((clip) => clip.sceneId === sceneId && !clip.altOf);
  }
  // Queued means queued only — an empty queue does not fall back to the whole show.
  return clips.filter((clip) => clip.queued);
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
}): {
  foldersToAdd: MediaFolder[];
  take: DirectorTake;
  asset: Asset;
  request: ReturnType<ReturnType<typeof getDirectorAdapter>['buildRequest']>;
  variantFolderId: string;
} {
  const adapter = getDirectorAdapter(args.show.adapterId);
  const variant = args.clip.activeVariant;
  const request = adapter.buildRequest({ show: args.show, clip: args.clip, variant });
  const key = variantKey(variant);
  const planned = planDirectorFolders({
    folders: args.folders,
    scene: args.scene,
    clip: args.clip,
    variantKey: key,
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
    name: takeDisplayName(args.scene, args.clip, key, take.number),
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
    take,
    asset,
    request,
    variantFolderId: planned.variantId,
  };
}
