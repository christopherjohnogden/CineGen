import type { DirectorScene, DirectorShow } from '@/types/director';
import { directorShotlistParallel, type DirectorLlmProvider } from './cli-provider';
import type { OpenAiPricedUsage } from '@/lib/llm/openai-usage';
import {
  bindShotlistToScene,
  clipDisplayLabels,
  mergeShotlist,
  parseShotlistPayload,
} from './shotlist';
import {
  estimateSceneSeconds,
  sceneScriptText,
  shotlistContinuationInput,
  shotlistDensity,
  shotlistJobInput,
  shotlistSliceContinuationInput,
  shotlistSliceInput,
} from './job-inputs';
import { shotlistContinueSystemPrompt, shotlistSystemPrompt } from './llm-jobs';
import { DIRECTOR_SHOTLIST_TIMEOUT_MS, runDirectorJsonJob } from './run-llm';
import {
  FAL_SHOTLIST_CONCURRENCY,
  createGate,
  falSliceBatchSize,
  falSliceCount,
  splitScriptForCoverage,
} from './shotlist-parallel';

export interface ShotlistRunHost {
  getShow: () => DirectorShow;
  setShow: (show: DirectorShow) => void;
  signal?: AbortSignal;
  onUsage?: (usage: OpenAiPricedUsage) => void;
}

const MAX_ROUNDS = 20;

export async function runDirectorShotlist(
  host: ShotlistRunHost,
  start: DirectorShow,
  targets: DirectorScene[],
  provider: DirectorLlmProvider,
): Promise<{ error: string | null }> {
  if (targets.length === 0) return { error: null };
  const density = shotlistDensity(start);
  const parallel = directorShotlistParallel(provider);
  const gate = createGate(parallel ? FAL_SHOTLIST_CONCURRENCY : 1);
  let firstError: string | null = null;
  let applyChain = Promise.resolve();
  const targetById = new Map(targets.map((scene) => [scene.id, scene]));

  const parseForScene = (payload: unknown, sceneId: string) => {
    const scene = targetById.get(sceneId);
    const parsed = parseShotlistPayload(payload, sceneId);
    return scene ? bindShotlistToScene(parsed, scene) : parsed;
  };

  const superseded = () => Boolean(host.signal?.aborted) || host.getShow().sourceText !== start.sourceText;
  const announce = (): string => {
    const requestId = crypto.randomUUID();
    host.setShow({ ...host.getShow(), jobStatus: { type: 'shotlist', message: 'Shotlisting…', requestId } });
    return requestId;
  };
  const apply = (sceneId: string, payload: unknown, onlyNewClips = false): { added: number; coveredToEnd?: boolean } => {
    const parsed = parseForScene(payload, sceneId);
    if (parsed.errors[0] && !firstError) firstError = parsed.errors[0];
    console.log('[director:shotlist]', sceneId, `raw=${parsed.rawClipCount}`, `parsed=${parsed.clips.length}`, `coveredToEnd=${String(parsed.coveredToEnd)}`, parsed.errors.length ? parsed.errors : '');
    if (parsed.rawClipCount > 0 && parsed.clips.length === 0 && !firstError) {
      firstError = `The model returned ${parsed.rawClipCount} clip entr${parsed.rawClipCount === 1 ? 'y' : 'ies'} but none were usable.`;
    }
    const latest = host.getShow();
    if (onlyNewClips) {
      const existingIds = new Set(latest.clips.map((clip) => clip.id));
      parsed.clips = parsed.clips.filter((clip) => !existingIds.has(clip.id));
    }
    const merged = mergeShotlist(latest.scenes, latest.clips, parsed);
    host.setShow({
      ...latest,
      stylePrefix: latest.stylePrefix.trim()
        ? latest.stylePrefix
        : (parsed.stylePrefix?.trim() ? parsed.stylePrefix : latest.stylePrefix),
      scenes: merged.scenes,
      clips: merged.clips,
      mode: latest.mode,
      selectedSceneId: latest.selectedSceneId ?? sceneId,
      selectedClipId: latest.selectedClipId ?? merged.clips.find((clip) => clip.sceneId === sceneId)?.id,
    });
    return { added: parsed.clips.length, coveredToEnd: parsed.coveredToEnd };
  };
  const queuedApply = (
    sceneId: string,
    payload: unknown,
    onlyNewClips = false,
  ): Promise<{ added: number; coveredToEnd?: boolean }> => {
    const run = applyChain.then(() => apply(sceneId, payload, onlyNewClips));
    applyChain = run.then(() => undefined, () => undefined);
    return run;
  };

  // Resolve every target before deleting an existing shotlist or starting an
  // LLM request. A scoped run must never fall back to the full screenplay.
  const scriptsByScene = new Map(targets.map((scene) => [scene.id, sceneScriptText(start, scene).trim()]));
  const unresolved = targets.find((scene) => !scriptsByScene.get(scene.id));
  if (unresolved) {
    return {
      error: `Could not isolate Scene ${unresolved.number} from the screenplay. Re-run Breakdown before shotlisting this scene.`,
    };
  }

  const targetIds = new Set(targets.map((scene) => scene.id));
  const before = host.getShow();
  if (before.clips.some((clip) => targetIds.has(clip.sceneId))) {
    const kept = before.clips.filter((clip) => !targetIds.has(clip.sceneId));
    host.setShow({
      ...before,
      clips: kept,
      selectedClipId: kept.some((clip) => clip.id === before.selectedClipId) ? before.selectedClipId : undefined,
    });
  }

  const shotlistScene = async (scene: DirectorScene) => {
    if (superseded()) return;
    const estClips = Math.max(1, Math.round(estimateSceneSeconds(host.getShow(), scene) / start.clipLengthSec));
    const script = scriptsByScene.get(scene.id)!;
    const slices = parallel
      ? splitScriptForCoverage(script, falSliceCount(estClips))
      : [script];
    const sliceOf = slices.length;
    const firstBatch = parallel ? falSliceBatchSize(estClips, sliceOf) : 1;
    const nextBatch = parallel ? firstBatch : 4;
    console.log('[director:shotlist] parallel', { scene: scene.label, estClips, sliceOf, firstBatch, words: slices.map((slice) => slice.split(/\s+/).filter(Boolean).length) });

    const steps = new Map<number, Array<{ payload: unknown; onlyNew: boolean }>>();
    const applied = new Map<number, number>();
    const complete = new Set<number>();
    let next = 0;
    const flush = async () => {
      while (next < sliceOf) {
        const list = steps.get(next) ?? [];
        const done = applied.get(next) ?? 0;
        for (let index = done; index < list.length; index += 1) {
          await queuedApply(scene.id, list[index].payload, list[index].onlyNew);
        }
        applied.set(next, list.length);
        if (!complete.has(next)) break;
        next += 1;
      }
    };
    const accept = async (sliceIndex: number, payload: unknown, onlyNew: boolean) => {
      const list = steps.get(sliceIndex) ?? [];
      list.push({ payload, onlyNew });
      steps.set(sliceIndex, list);
      await flush();
    };

    await Promise.all(slices.map(async (text, sliceIndex) => {
      if (superseded()) return;
      const slice = { index: sliceIndex, of: sliceOf, text };
      const requestId = announce();
      let cliSession: string | undefined;
      const payload = await gate.run(() => runDirectorJsonJob(
        shotlistSystemPrompt(start.clipLengthSec, density, firstBatch),
        sliceOf > 1 ? shotlistSliceInput(host.getShow(), scene, slice) : shotlistJobInput(host.getShow(), [scene]),
        provider,
        requestId,
        host.signal,
        { timeoutMs: DIRECTOR_SHOTLIST_TIMEOUT_MS, fast: true, onSession: (id) => { cliSession = id; }, onUsage: host.onUsage },
      ));
      if (superseded()) return;
      await accept(sliceIndex, payload, false);
      let parsed = parseForScene(payload, scene.id);
      let coveredToEnd = parsed.coveredToEnd;
      let sliceClips = parsed.clips.filter((clip) => !clip.altOf);

      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        if (coveredToEnd === true || superseded()) break;
        const cur = host.getShow();
        const sceneClips = cur.clips.filter((clip) => clip.sceneId === scene.id && !clip.altOf);
        const covered = sceneClips.reduce((sum, clip) => sum + clip.seconds, 0);
        const expected = estimateSceneSeconds(cur, scene);
        if (sliceClips.length === 0) break;
        if (sliceOf === 1 && coveredToEnd === undefined && covered >= expected * 0.85) break;
        const denominator = Math.max(estClips, (sliceOf === 1 ? sceneClips.length : sliceClips.length) + 1);
        const contId = announce();
        const labels = clipDisplayLabels(cur.scenes, cur.clips);
        const contPayload = await gate.run(() => runDirectorJsonJob(
          shotlistContinueSystemPrompt(start.clipLengthSec, density, nextBatch),
          sliceOf > 1
            ? shotlistSliceContinuationInput(cur, scene, slice, sliceClips, labels)
            : shotlistContinuationInput(cur, scene, sceneClips, labels),
          provider,
          contId,
          host.signal,
          {
            timeoutMs: DIRECTOR_SHOTLIST_TIMEOUT_MS,
            fast: true,
            resumeSessionId: cliSession,
            onSession: (id) => { cliSession = id; },
            onUsage: host.onUsage,
          },
        ));
        if (superseded()) return;
        await accept(sliceIndex, contPayload, true);
        parsed = parseForScene(contPayload, scene.id);
        const existingIds = new Set(sliceClips.map((clip) => clip.id));
        const added = parsed.clips.filter((clip) => !clip.altOf && !existingIds.has(clip.id));
        if (added.length === 0) break;
        sliceClips = [...sliceClips, ...added];
        coveredToEnd = parsed.coveredToEnd;
        if (sliceOf === 1) {
          const after = host.getShow().clips
            .filter((clip) => clip.sceneId === scene.id && !clip.altOf)
            .reduce((sum, clip) => sum + clip.seconds, 0);
          if (after <= covered) break;
        }
      }
      complete.add(sliceIndex);
      await flush();
    }));
  };

  try {
    await Promise.all(targets.map((scene) => shotlistScene(scene).catch((error) => {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      if (!firstError) firstError = error instanceof Error ? error.message : 'Shotlist failed';
    })));
    if (superseded()) return { error: firstError };
    host.setShow({
      ...host.getShow(),
      jobStatus: firstError ? { type: 'shotlist', message: firstError, error: true } : null,
    });
    return { error: firstError };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return { error: null };
    throw error;
  }
}
