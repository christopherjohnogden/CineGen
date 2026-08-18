import type { MediaFolder } from '@/types/project';
import type { DirectorClip, DirectorScene } from '@/types/director';
import { generateId, timestamp } from '@/lib/utils/ids';
import { clipFolderName, sceneFolderName, variantFolderName } from './slate';

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
}): PlannedDirectorFolders {
  const foldersToAdd: MediaFolder[] = [];
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
  const clipId = ensure(sceneId, clipFolderName(args.clip));
  const variantId = ensure(clipId, variantFolderName(args.clip, args.variantKey));
  return { foldersToAdd, rootId, sceneId, clipId, variantId };
}
