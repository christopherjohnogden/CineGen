import type { DirectorClip, DirectorShow, DirectorTake, IsolateVariant } from '@/types/director';
import { variantKey } from './slate';

export function directorJobIsRunning(
  show: Pick<DirectorShow, 'jobStatus'>,
  type?: NonNullable<DirectorShow['jobStatus']>['type'],
): boolean {
  const status = show.jobStatus;
  if (!status || status.error) return false;
  return type ? status.type === type : true;
}

export function patchDirectorShow(show: DirectorShow, patch: Partial<DirectorShow>): DirectorShow {
  return { ...show, ...patch };
}

export function updateDirectorClip(
  show: DirectorShow,
  clipId: string,
  updater: (clip: DirectorClip) => DirectorClip,
): DirectorShow {
  return {
    ...show,
    clips: show.clips.map((clip) => clip.id === clipId ? updater(clip) : clip),
  };
}

export function selectedClip(show: DirectorShow): DirectorClip | undefined {
  return show.clips.find((clip) => clip.id === show.selectedClipId) ?? show.clips[0];
}

export function selectedScene(show: DirectorShow) {
  return show.scenes.find((scene) => scene.id === show.selectedSceneId)
    ?? show.scenes.find((scene) => scene.id === selectedClip(show)?.sceneId)
    ?? show.scenes[0];
}

export function appendDirectorTake(show: DirectorShow, clipId: string, take: DirectorTake): DirectorShow {
  return updateDirectorClip(show, clipId, (clip) => ({
    ...clip,
    takes: [...clip.takes, take],
  }));
}

export function updateDirectorTake(
  show: DirectorShow,
  clipId: string,
  takeId: string,
  patch: Partial<DirectorTake>,
): DirectorShow {
  return updateDirectorClip(show, clipId, (clip) => ({
    ...clip,
    takes: clip.takes.map((take) => take.id === takeId ? { ...take, ...patch } : take),
  }));
}

export function setClipVariant(show: DirectorShow, clipId: string, variant: IsolateVariant): DirectorShow {
  return updateDirectorClip(show, clipId, (clip) => ({ ...clip, activeVariant: variant }));
}

export function setHeroTake(show: DirectorShow, clipId: string, takeId: string): DirectorShow {
  return {
    ...updateDirectorClip(show, clipId, (clip) => {
      const target = clip.takes.find((take) => take.id === takeId);
      if (!target) return clip;
      return {
        ...clip,
        takes: clip.takes.map((take) => (
          take.variantKey === target.variantKey
            ? { ...take, hero: take.id === takeId }
            : take
        )),
      };
    }),
    selectedTakeId: takeId,
  };
}

export function keepPendingRewrite(show: DirectorShow, clipId: string): DirectorShow {
  return updateDirectorClip(show, clipId, (clip) => {
    if (!clip.pendingRewrite) return clip;
    return {
      ...clip,
      bodyEdits: { ...clip.bodyEdits, [clip.pendingRewrite.variantKey]: clip.pendingRewrite.body },
      pendingRewrite: undefined,
    };
  });
}

export function discardPendingRewrite(show: DirectorShow, clipId: string): DirectorShow {
  return updateDirectorClip(show, clipId, (clip) => ({ ...clip, pendingRewrite: undefined }));
}

export function activeVariantKey(clip: DirectorClip): string {
  return variantKey(clip.activeVariant);
}
