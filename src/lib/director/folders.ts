import type { Asset, MediaFolder } from '@/types/project';
import type { DirectorClip, DirectorScene, DirectorShow } from '@/types/director';
import { generateId, timestamp } from '@/lib/utils/ids';
import { clipDisplayLabels } from './shotlist';
import {
  clipFolderName, isLegacyTakeDisplayName, sceneFolderName, takeDisplayName, variantFolderName,
} from './slate';

export const DIRECTOR_ROOT_FOLDER_NAME = 'Director';

function findChild(
  folders: MediaFolder[],
  parentId: string | undefined,
  name: string,
): MediaFolder | undefined {
  return folders.find((folder) => folder.name === name && (folder.parentId ?? undefined) === parentId);
}

export interface PlannedDirectorFolders {
  foldersToAdd: MediaFolder[];
  foldersToRename: Array<{ id: string; name: string }>;
  rootId: string;
  sceneId: string;
  clipId: string;
  variantId: string;
}

export function planDirectorFolders(args: {
  folders: MediaFolder[];
  scene: DirectorScene;
  clip: DirectorClip;
  variantKey: string;
  clipLabel?: string;
}): PlannedDirectorFolders {
  const foldersToAdd: MediaFolder[] = [];
  const foldersToRename: Array<{ id: string; name: string }> = [];
  const all = [...args.folders];

  function ensure(parentId: string | undefined, name: string): string {
    const existing = findChild(all, parentId, name);
    if (existing) return existing.id;
    const folder: MediaFolder = {
      id: generateId(),
      name,
      parentId,
      createdAt: timestamp(),
    };
    all.push(folder);
    foldersToAdd.push(folder);
    return folder.id;
  }

  const rootId = ensure(undefined, DIRECTOR_ROOT_FOLDER_NAME);
  const sceneId = ensure(rootId, sceneFolderName(args.scene));
  const nextClipName = clipFolderName(args.clip, args.clipLabel);
  const legacyClipName = clipFolderName(args.clip);
  const existingClip = findChild(all, sceneId, nextClipName)
    ?? (legacyClipName !== nextClipName ? findChild(all, sceneId, legacyClipName) : undefined);
  let clipId: string;
  if (existingClip) {
    clipId = existingClip.id;
    if (existingClip.name !== nextClipName) {
      foldersToRename.push({ id: existingClip.id, name: nextClipName });
      all.splice(all.indexOf(existingClip), 1, { ...existingClip, name: nextClipName });
    }
  } else {
    clipId = ensure(sceneId, nextClipName);
  }
  const variantId = ensure(clipId, variantFolderName(args.clip, args.variantKey));
  return { foldersToAdd, foldersToRename, rootId, sceneId, clipId, variantId };
}

function metaString(metadata: Asset['metadata'], key: string): string {
  const value = metadata?.[key];
  return typeof value === 'string' ? value : '';
}

/** Rewrite leftover `S01_1-p0a_T01` asset names and `1-p0a — Title` folders to 1A slate labels. */
export function directorPoolRelabel(
  show: DirectorShow,
  assets: Asset[],
  folders: MediaFolder[],
): { assets: Array<{ id: string; name: string }>; folders: Array<{ id: string; name: string }> } {
  const labels = clipDisplayLabels(show.scenes, show.clips);
  const nextAssets: Array<{ id: string; name: string }> = [];
  for (const asset of assets) {
    const clipId = metaString(asset.metadata, 'directorClipId');
    const takeId = metaString(asset.metadata, 'directorTakeId');
    if (!clipId || !takeId) continue;
    const clip = show.clips.find((entry) => entry.id === clipId);
    const take = clip?.takes.find((entry) => entry.id === takeId);
    const scene = clip ? show.scenes.find((entry) => entry.id === clip.sceneId) : undefined;
    if (!clip || !take || !scene) continue;
    let name = takeDisplayName(scene, clip, take.variantKey, take.number, labels.get(clip.id));
    if (take.status === 'failed' || asset.metadata?.error) name = `${name} failed`;
    if (name === asset.name) continue;
    if (!isLegacyTakeDisplayName(asset.name, clip.id)) continue;
    nextAssets.push({ id: asset.id, name });
  }

  const nextFolders: Array<{ id: string; name: string }> = [];
  for (const clip of show.clips) {
    const nextName = clipFolderName(clip, labels.get(clip.id));
    const legacyName = clipFolderName(clip);
    if (nextName === legacyName) continue;
    const folder = folders.find((entry) => entry.name === legacyName);
    if (folder) nextFolders.push({ id: folder.id, name: nextName });
  }
  return { assets: nextAssets, folders: nextFolders };
}
