import { useCallback, useEffect, useRef, useState } from 'react';
import type { DirectorBreakdownItem, DirectorMode, DirectorShow } from '@/types/director';
import type { Element } from '@/types/elements';
import { useWorkspace } from '@/components/workspace/workspace-shell';
import { DirectorStructureRail } from './director-structure-rail';
import { DirectorScriptTab } from './director-script-tab';
import { DirectorBreakdownTab } from './director-breakdown-tab';
import { DirectorShotlistTab } from './director-shotlist-tab';
import { DirectorGenerateTab } from './director-generate-tab';
import { DirectorSetupDrawer } from './director-setup-drawer';
import { DirectorLookBiblePanel } from './director-look-bible';
import { useDirectorCascade } from './use-director-cascade';
import { pruneRemovedScenes, remapSceneIndexMaps } from '@/lib/director/cascade';
import { createEmptyDirectorShow } from '@/lib/director/create-show';
import { applyLlmBreakdownItems, mergeScenes, parseBreakdownPayload } from '@/lib/director/breakdown';
import { localBreakdownForShow } from '@/lib/director/local-breakdown';
import { clipDisplayLabels, mergeShotlist, parseShotlistPayload } from '@/lib/director/shotlist';
import { BREAKDOWN_AUDIT_SYSTEM_PROMPT, BREAKDOWN_IDENTIFY_SYSTEM_PROMPT, LOOK_BIBLE_SYSTEM_PROMPT, NOTES_REWRITE_SYSTEM_PROMPT, SCENE_NOTES_SYSTEM_PROMPT } from '@/lib/director/llm-jobs';
import {
  breakdownAuditInput,
  breakdownJobInput,
  lookBibleJobInput,
  sceneNotesJobInput,
} from '@/lib/director/job-inputs';
import { applyWrittenLook, lookBibleImageUrls } from '@/lib/director/look-bible';
import { ENRICH_CHARACTER_SYSTEM_PROMPT, buildEnrichInput, parseEnrichResult } from '@/lib/director/enrich';
import { getApiKey, getOpenAiApiKey } from '@/lib/utils/api-key';
import { runDirectorJsonJob } from '@/lib/director/run-llm';
import { runDirectorShotlist } from '@/lib/director/run-shotlist';
import { cancelCliCopilotChat } from '@/lib/llm/cli-copilot-client';
import { mergeDirectorLlmSpend } from '@/lib/llm/openai-usage';
import { HIGGSFIELD_LLM_CLI_SUPPORTED, cliProviderFor, cliTransportFor, parseDirectorLlmProvider, pickInstalledDirectorLlm } from '@/lib/director/cli-provider';
import { DirectorLlmPicker, type DirectorCliInfo } from './director-llm-picker';
import {
  CLI_LLM_PROVIDER_IDS,
  type CliLlmProviderId,
} from '@/lib/llm/claude-code-session';
import {
  appendDirectorTake,
  directorJobIsRunning,
  directorRunningLabel,
  discardPendingRewrite,
  keepPendingRewrite,
  selectedClip,
  selectedScene,
  updateDirectorClip,
  updateDirectorTake,
} from '@/lib/director/director-state';
import {
  clipsForGenerateScope,
  generationPreflight,
  isDirectorTakeLive,
  prepareDirectorGeneration,
  runtimeSeconds,
} from '@/lib/director/generate';
import { matchListedJobToTake } from '@/lib/director/rejoin-takes';
import { getDirectorAdapter } from '@/lib/director/video-adapter';
import { variantKey } from '@/lib/director/slate';
import { generateId, timestamp } from '@/lib/utils/ids';
import { defaultFolderForNewElement, projectFolderId } from '@/lib/elements/library';
import '@/styles/director-tab.css';

const EMPTY_CLI_PROVIDERS: Record<CliLlmProviderId, DirectorCliInfo> = {
  'claude-code': { id: 'claude-code', installed: false },
  codex: { id: 'codex', installed: false },
  gemini: { id: 'gemini', installed: false },
};

export function DirectorTab() {
  const { state, dispatch, projectId } = useWorkspace();
  const show = state.director ?? createEmptyDirectorShow();
  const showRef = useRef(show);
  const foldersRef = useRef(state.mediaFolders);
  const elementsRef = useRef(state.elements);
  const enrichingTags = useRef<Set<string>>(new Set());
  const recoverAttempted = useRef<Set<string>>(new Set());
  const recoverInFlight = useRef(false);
  const recoverTries = useRef(0);
  const recoverTimer = useRef<number>();
  const [recoverNonce, setRecoverNonce] = useState(0);
  const [fetchingTake, setFetchingTake] = useState(false);
  showRef.current = show;
  foldersRef.current = state.mediaFolders;
  elementsRef.current = state.elements;

  const [selectedBeatN, setSelectedBeatN] = useState(1);
  const [preflight, setPreflight] = useState('Seedance 2.5');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [cliProviders, setCliProviders] = useState<Record<CliLlmProviderId, DirectorCliInfo>>(EMPTY_CLI_PROVIDERS);
  const [higgsfieldReady, setHiggsfieldReady] = useState(false);
  const [openDrawer, setOpenDrawer] = useState<'setup' | 'look' | null>(null);

  const TABS: { id: DirectorMode; label: string }[] = [
    { id: 'source', label: 'Script' },
    { id: 'breakdown', label: 'Breakdown' },
    { id: 'shotlist', label: 'Shotlist' },
    { id: 'generate', label: 'Generate' },
  ];

  // Rail scene filter: null = show every scene on the shotlist stage. Only
  // RAIL clicks set it — expanding a clip on the stage must never collapse the
  // view down to one scene.
  const [sceneFilter, setSceneFilter] = useState<string | null>(null);
  // Rail clip clicks also expand that clip's row on the stage. The nonce makes
  // repeat clicks on the same clip re-open it after a manual collapse.
  const [expandRequest, setExpandRequest] = useState<{ clipId: string; n: number } | null>(null);
  // Abort handle for button-triggered shotlist runs (auto-sync runs carry the
  // cascade's own signal), so a stuck run can be stopped from the page.
  const manualShotlistAbort = useRef<AbortController | null>(null);

  const selectScene = (sceneId: string) => {
    const first = show.clips.find((row) => row.sceneId === sceneId);
    setShow({ ...show, selectedSceneId: sceneId, selectedClipId: first?.id ?? show.selectedClipId });
  };
  const selectClip = (sceneId: string, clipId: string) => {
    setShow({ ...show, selectedSceneId: sceneId, selectedClipId: clipId });
    const target = show.clips.find((row) => row.id === clipId);
    setSelectedBeatN(target?.beats[0]?.n ?? 1);
  };
  const liveSceneIds = new Set(show.scenes.map((scene) => scene.id));
  const nonAltClipCount = show.clips.filter((clip) => !clip.altOf && liveSceneIds.has(clip.sceneId)).length;
  const withRail = show.mode === 'shotlist' || show.mode === 'generate';

  const setShow = useCallback((director: DirectorShow) => {
    // Eagerly update the ref: async jobs read-modify-write showRef.current, and
    // React batches renders — two setShow calls in one tick would otherwise
    // both build on the SAME stale snapshot and the second silently reverts
    // the first (this is how freshly merged clips were vanishing).
    showRef.current = director;
    dispatch({ type: 'SET_DIRECTOR', director });
  }, [dispatch]);

  const recordSpend = useCallback((usage: Parameters<typeof mergeDirectorLlmSpend>[1]) => {
    const current = showRef.current;
    setShow({ ...current, llmSpend: mergeDirectorLlmSpend(current.llmSpend, usage) });
  }, [setShow]);

  const setJob = useCallback((type: NonNullable<DirectorShow['jobStatus']>['type'], message: string) => {
    const requestId = crypto.randomUUID();
    setShow({ ...showRef.current, jobStatus: { type, message, requestId } });
    return requestId;
  }, [setShow]);

  const failJob = useCallback((type: NonNullable<DirectorShow['jobStatus']>['type'], error: unknown, fallback: string) => {
    setShow({
      ...showRef.current,
      jobStatus: { type, message: error instanceof Error ? error.message : fallback, error: true },
    });
  }, [setShow]);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI.llm.cliDetect().then(({ providers }) => {
      if (cancelled) return;
      const next = { ...EMPTY_CLI_PROVIDERS };
      for (const provider of providers) {
        if (CLI_LLM_PROVIDER_IDS.includes(provider.id)) next[provider.id] = provider;
      }
      setCliProviders(next);
      // higgsfieldReady is optimistic (true) only while their CLI can actually
      // run LLM jobs — account status resolves later, and an explicit hosted
      // choice must not be clobbered before it is known.
      const nextProvider = pickInstalledDirectorLlm(
        parseDirectorLlmProvider(showRef.current.llmProvider),
        providers,
        {
          falReady: Boolean(getApiKey()),
          openaiReady: Boolean(getOpenAiApiKey()),
          higgsfieldReady: HIGGSFIELD_LLM_CLI_SUPPORTED,
        },
      );
      if (nextProvider !== showRef.current.llmProvider) {
        setShow({ ...showRef.current, llmProvider: nextProvider });
      }
    }).catch(() => {
      if (!cancelled) setCliProviders(EMPTY_CLI_PROVIDERS);
    });
    return () => { cancelled = true; };
  }, [setShow]);

  useEffect(() => {
    let cancelled = false;
    const adapter = getDirectorAdapter(show.adapterId);
    const run = async () => {
      let connected: boolean | undefined;
      let error: string | undefined;
      try {
        const status = await window.electronAPI.higgsfield.accountStatus();
        connected = status.connected;
        error = status.error;
      } catch (err) {
        connected = false;
        error = err instanceof Error ? err.message : 'Higgsfield unavailable';
      }
      if (cancelled) return;
      setHiggsfieldReady(Boolean(connected));
      const result = generationPreflight({
        clipCount: 1,
        seconds: selectedClip(show)?.seconds ?? 0,
        adapterLabel: adapter.label,
        higgsfieldConnected: connected,
        higgsfieldError: error,
      });
      setPreflight(result.summary);
      setWarnings(result.warnings);
    };
    void run();
    return () => { cancelled = true; };
  }, [show.adapterId, show.clips, show.selectedClipId, show.selectedSceneId]);

  const runBreakdown = useCallback(async (
    scope: { sceneIds: string[] } | 'all' = 'all',
    signal?: AbortSignal,
  ) => {
    const current = showRef.current;
    // Scene headings stay structural (script parse). Elements come only from the LLM.
    const local = localBreakdownForShow(current);
    const localScenes = mergeScenes(current.scenes, local.scenes, { authoritative: true });
    const requestId = crypto.randomUUID();
    setShow({
      ...current,
      scenes: localScenes,
      breakdownApproved: false,
      jobStatus: { type: 'breakdown', message: 'Breaking down script…', requestId },
      selectedSceneId: current.selectedSceneId ?? localScenes[0]?.id,
    });
    try {
      const existing = state.elements.map((element) => `${element.type} ${element.name}`).join(', ');
      const scopedIds = scope === 'all' ? [] : scope.sceneIds;
      const scopeArg = scopedIds.length > 0 ? { sceneIds: scopedIds } : undefined;
      const showForJob = { ...current, scenes: localScenes };
      const payload = await runDirectorJsonJob(
        BREAKDOWN_IDENTIFY_SYSTEM_PROMPT,
        breakdownJobInput(showForJob, existing, scopeArg),
        parseDirectorLlmProvider(current.llmProvider),
        requestId,
        signal,
        { onUsage: recordSpend },
      );
      if (signal?.aborted) return; // silent — a newer edit superseded this
      // The script was replaced or reset while the job ran — merging the stale
      // result would repopulate a board the user just cleared.
      if (showRef.current.sourceText !== current.sourceText) return;
      const parsed = parseBreakdownPayload(payload);
      let found = parsed.items;
      try {
        setShow({
          ...showRef.current,
          jobStatus: { type: 'breakdown', message: 'Checking for missed elements…', requestId },
        });
        const audit = parseBreakdownPayload(await runDirectorJsonJob(
          BREAKDOWN_AUDIT_SYSTEM_PROMPT,
          breakdownAuditInput(showForJob, found, scopeArg),
          parseDirectorLlmProvider(current.llmProvider),
          crypto.randomUUID(),
          signal,
          { onUsage: recordSpend },
        ));
        if (showRef.current.sourceText !== current.sourceText) return;
        found = [...found, ...audit.items];
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        // Keep the first pass — a failed audit must not wipe a usable breakdown.
      }
      const latest = showRef.current; // re-read: the user may have edited during the job
      setShow({
        ...latest,
        breakdown: applyLlmBreakdownItems(
          latest.breakdown, found, state.elements, { pruneMissing: !scopeArg },
        ),
        scenes: mergeScenes(latest.scenes, parsed.scenes),
        breakdownApproved: false,
        mode: latest.mode, // do NOT force the tab to switch during an auto-run
        jobStatus: null,
        selectedSceneId: latest.selectedSceneId ?? parsed.scenes[0]?.id,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      failJob('breakdown', error, 'Breakdown failed');
      throw error; // let the cascade know not to chain shotlist
    }
  }, [failJob, setShow, state.elements]);

  const createElementFromBreakdown = useCallback((item: DirectorBreakdownItem, data: {
    name: string;
    type: Element['type'];
    description: string;
    images: Element['images'];
  }) => {
    const element: Element = {
      id: generateId(),
      ...data,
      folderId: defaultFolderForNewElement('all', projectFolderId(
        { version: 1, folders: state.elementFolders, elements: state.elements },
        projectId,
      )),
      createdAt: timestamp(),
      updatedAt: timestamp(),
    };
    dispatch({ type: 'ADD_ELEMENT', element });
    const current = showRef.current;
    setShow({
      ...current,
      breakdown: current.breakdown.map((entry) => (
        entry.tag === item.tag ? { ...entry, elementId: element.id } : entry
      )),
    });
  }, [dispatch, projectId, setShow, state.elementFolders, state.elements]);

  // One LLM call PER SCENE (each response gets the full output budget, clips
  // land progressively), plus an automatic continuation pass when a scene's
  // clips cover far less than its estimated screen time — a nine-page scene
  // must become ~25 clips, not two highlights.
  const runShotlist = useCallback(async (
    scope: { sceneIds: string[] } | 'all' = 'all',
    signal?: AbortSignal,
  ) => {
    const start = showRef.current;
    const targets = scope === 'all'
      ? start.scenes
      : start.scenes.filter((s) => scope.sceneIds.includes(s.id));
    if (targets.length === 0) return;
    try {
      const result = await runDirectorShotlist(
        { getShow: () => showRef.current, setShow, signal, onUsage: recordSpend },
        start,
        targets,
        parseDirectorLlmProvider(start.llmProvider),
      );
      if (result.error) throw new Error(result.error);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      failJob('shotlist', error, 'Shotlist failed');
      throw error;
    }
  }, [failJob, setShow]);

  // Scene-level director's notes → the LLM patches only the clips the notes
  // mention (referenced by display label), returning them in the shotlist
  // schema so the normal merge applies the changes in place.
  const runSceneNotes = useCallback(async (sceneId: string, notes: string) => {
    const current = showRef.current;
    const scene = current.scenes.find((entry) => entry.id === sceneId);
    const clips = current.clips.filter((entry) => entry.sceneId === sceneId);
    if (!scene || clips.length === 0 || !notes.trim()) return;
    const requestId = setJob('rewrite', `Applying notes to ${scene.label}…`);
    try {
      const labels = clipDisplayLabels(current.scenes, current.clips);
      const payload = await runDirectorJsonJob(
        SCENE_NOTES_SYSTEM_PROMPT,
        sceneNotesJobInput(scene, clips, labels, notes),
        parseDirectorLlmProvider(current.llmProvider),
        requestId,
        undefined,
        { onUsage: recordSpend },
      );
      // The script was replaced or reset while the job ran.
      if (showRef.current.sourceText !== current.sourceText) return;
      const parsed = parseShotlistPayload(payload, sceneId);
      if (parsed.clips.length === 0) throw new Error('The rewrite returned no clips — name them by label (1A, 1B) in the notes.');
      // A model that answers with the display label as the id would otherwise
      // insert a duplicate clip instead of updating the one it meant.
      const labelToId = new Map<string, string>();
      for (const entry of clips) {
        const label = labels.get(entry.id);
        if (label) labelToId.set(label.toUpperCase(), entry.id);
      }
      const fixed = {
        ...parsed,
        clips: parsed.clips.map((clip) => {
          const realId = labelToId.get(clip.id.toUpperCase());
          return realId && realId !== clip.id ? { ...clip, id: realId } : clip;
        }),
      };
      const merged = mergeShotlist(showRef.current.scenes, showRef.current.clips, fixed);
      // A stored manual body edit would mask the structured update the user
      // just asked for, so touched clips drop theirs.
      const touched = new Set(fixed.clips.map((clip) => clip.id));
      setShow({
        ...showRef.current,
        scenes: merged.scenes,
        clips: merged.clips.map((clip) => touched.has(clip.id) ? { ...clip, bodyEdits: {} } : clip),
        jobStatus: parsed.errors[0] ? { type: 'rewrite', message: parsed.errors[0], error: true } : null,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      failJob('rewrite', error, 'Notes rewrite failed');
    }
  }, [failJob, setJob, setShow]);

  const commitSyncState = useCallback((syncState: NonNullable<DirectorShow['syncState']>) => {
    const cur = showRef.current;
    const prevKeys = Object.keys(cur.syncState?.hashes ?? {});
    const nextKeys = Object.keys(syncState.hashes);
    let nextShow = cur;
    if (prevKeys.join('|') !== nextKeys.join('|')) {
      nextShow = remapSceneIndexMaps(nextShow, prevKeys, nextKeys);
      nextShow = pruneRemovedScenes(nextShow, nextShow);
    }
    setShow({ ...nextShow, syncState });
  }, [setShow]);

  // Scene list stays in sync with the script (headings are structural). Elements
  // wait for the LLM breakdown — the live extractor no longer mints suggestions.
  useEffect(() => {
    const cur = showRef.current;
    if (!cur.sourceText.trim() && cur.docKind !== 'beatsheet') return;
    const local = localBreakdownForShow(cur);
    const scenes = mergeScenes(cur.scenes, local.scenes, { authoritative: true });
    if (scenes === cur.scenes) return;
    setShow({ ...cur, scenes });
  }, [show.sourceText, show.docKind, setShow]);

  const cascade = useDirectorCascade({
    show,
    autoSync: show.autoSync ?? true,
    runBreakdown,
    runShotlist,
    commitSyncState,
  });

  const startManualShotlist = useCallback((sceneId?: string) => {
    manualShotlistAbort.current?.abort();
    const controller = new AbortController();
    manualShotlistAbort.current = controller;
    void runShotlist(sceneId ? { sceneIds: [sceneId] } : 'all', controller.signal)
      .catch(() => {})
      .finally(() => {
        if (manualShotlistAbort.current === controller) manualShotlistAbort.current = null;
      });
  }, [runShotlist]);

  const stopShotlist = useCallback(() => {
    manualShotlistAbort.current?.abort();
    manualShotlistAbort.current = null;
    cascade.cancel();
    setShow({ ...showRef.current, jobStatus: null });
  }, [cascade, setShow]);

  const enrichCharacter = useCallback(async (tag: string): Promise<void> => {
    const cur = showRef.current;
    const item = cur.breakdown.find((b) => b.tag === tag && b.kind === 'character');
    if (!item || item.enrichedAt || item.actingProfile?.trim()) return;
    if (enrichingTags.current.has(tag)) return;
    enrichingTags.current.add(tag);
    try {
      const payload = await runDirectorJsonJob(
        ENRICH_CHARACTER_SYSTEM_PROMPT,
        buildEnrichInput(item, cur.sourceText),
        parseDirectorLlmProvider(cur.llmProvider),
        crypto.randomUUID(),
        undefined,
        { onUsage: recordSpend },
      );
      const { actingProfile, voice } = parseEnrichResult(payload);
      // Only mark the character enriched if the LLM actually returned something.
      // An empty parse (junk / wrong keys) must leave enrichedAt unset so a later
      // generation retries instead of permanently locking the item as "enriched but empty".
      if (!actingProfile && !voice) return;
      const now = Date.now();
      setShow({
        ...showRef.current,
        breakdown: showRef.current.breakdown.map((b) =>
          b.tag === tag ? { ...b, actingProfile: actingProfile ?? b.actingProfile, voice: voice ?? b.voice, enrichedAt: now } : b,
        ),
      });
    } catch {
      // best-effort: leave the item un-enriched; generation falls back to description
    } finally {
      enrichingTags.current.delete(tag);
    }
  }, [setShow]);

  const generateOne = useCallback(async (clipId: string): Promise<string | null> => {
    const current = showRef.current;
    const clip = current.clips.find((entry) => entry.id === clipId);
    const scene = clip
      ? (current.scenes.find((entry) => entry.id === clip.sceneId) ?? selectedScene(current) ?? current.scenes[0])
      : undefined;
    if (!clip || !scene) {
      const message = 'Select a clip before generating.';
      setShow({ ...current, jobStatus: { type: 'generate', message, error: true } });
      return message;
    }
    if (!window.electronAPI?.higgsfield?.generate) {
      const message = 'Higgsfield generate is only available in the CineGen desktop app.';
      setShow({ ...current, jobStatus: { type: 'generate', message, error: true } });
      return message;
    }
    // Enrich in the background — waiting here made Generate look dead while the LLM ran.
    const charTags = current.breakdown
      .filter((b) => b.kind === 'character' && clip.elementTags.includes(b.tag) && !b.enrichedAt && !b.actingProfile?.trim())
      .map((b) => b.tag);
    for (const tag of charTags) void enrichCharacter(tag);
    const prepared = prepareDirectorGeneration({
      show: current,
      scene,
      clip,
      folders: foldersRef.current,
      elements: elementsRef.current,
    });
    foldersRef.current = [...foldersRef.current, ...prepared.foldersToAdd];
    for (const folder of prepared.foldersToAdd) {
      dispatch({ type: 'ADD_FOLDER', folder });
    }
    for (const folder of prepared.foldersToRename) {
      foldersRef.current = foldersRef.current.map((entry) => (
        entry.id === folder.id ? { ...entry, ...folder } : entry
      ));
      dispatch({ type: 'UPDATE_FOLDER', folder });
    }
    dispatch({ type: 'ADD_ASSET', asset: prepared.asset });
    setShow(appendDirectorTake({
      ...showRef.current,
      mode: 'generate',
      selectedClipId: clip.id,
      selectedTakeId: prepared.take.id,
      jobStatus: { type: 'generate', message: `Generating ${prepared.asset.name}…` },
    }, clip.id, prepared.take));

    try {
      const submitted = await window.electronAPI.higgsfield.generate({
        prompt: prepared.request.prompt,
        model: prepared.request.modelId,
        outputType: 'video',
        params: prepared.request.params,
        medias: prepared.request.medias,
        wait: false,
      });
      const jobId = submitted.jobId;
      if (jobId) {
        recoverAttempted.current.add(prepared.take.id);
        setShow(updateDirectorTake(showRef.current, clip.id, prepared.take.id, { jobId }));
      }
      const result = submitted.url
        ? submitted
        : jobId
          ? await window.electronAPI.higgsfield.generate({
              jobId,
              model: prepared.request.modelId,
              outputType: 'video',
            })
          : submitted;
      if (!result.url) throw new Error('Higgsfield finished but returned no video URL.');
      dispatch({
        type: 'UPDATE_ASSET',
        asset: {
          id: prepared.asset.id,
          url: result.url,
          fileRef: result.url,
          duration: result.durationSec ?? prepared.request.durationSec,
          metadata: { generating: false, generatedVia: 'director', higgsfieldModel: prepared.request.modelId },
        },
      });
      setShow(updateDirectorTake(showRef.current, clip.id, prepared.take.id, {
        status: 'done',
        jobId: result.jobId ?? jobId,
      }));
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Generation failed';
      dispatch({
        type: 'UPDATE_ASSET',
        asset: {
          id: prepared.asset.id,
          name: `${prepared.asset.name} failed`,
          metadata: { generating: false, error: true, generatedVia: 'director' },
        },
      });
      setShow(updateDirectorTake({
        ...showRef.current,
        jobStatus: { type: 'generate', message, error: true },
      }, clip.id, prepared.take.id, {
        status: 'failed',
        error: message,
      }));
      return message;
    }
  }, [dispatch, setShow, enrichCharacter]);

  const runGenerate = useCallback(async (scope: 'active' | 'queued' | 'scene') => {
    const current = showRef.current;
    const clip = selectedClip(current);
    const sceneId = clip?.sceneId ?? selectedScene(current)?.id;
    const targets = clipsForGenerateScope(current.clips, scope, current.selectedClipId ?? clip?.id, sceneId);
    if (targets.length === 0) {
      const message = scope === 'queued'
        ? 'Queue is empty. Tick Queue on clips, then generate queued.'
        : 'Select a clip before generating.';
      setShow({ ...current, jobStatus: { type: 'generate', message, error: true } });
      return;
    }
    setShow({ ...current, mode: 'generate', jobStatus: { type: 'generate', message: `Generating ${targets.length} clip${targets.length === 1 ? '' : 's'}…` } });
    let lastError: string | null = null;
    for (const target of targets) {
      const error = await generateOne(target.id);
      if (error) lastError = error;
    }
    setShow({
      ...showRef.current,
      jobStatus: lastError ? { type: 'generate', message: lastError, error: true } : null,
    });
  }, [generateOne, setShow]);

  const recoverLiveTakes = useCallback(async () => {
    if (!window.electronAPI?.higgsfield?.generate || recoverInFlight.current) return;
    if (directorJobIsRunning(showRef.current, 'generate')) return;
    const live: Array<{ clipId: string; take: (typeof showRef.current.clips)[number]['takes'][number] }> = [];
    for (const clip of showRef.current.clips) {
      for (const take of clip.takes) {
        if (!isDirectorTakeLive(take) || recoverAttempted.current.has(take.id)) continue;
        live.push({ clipId: clip.id, take });
      }
    }
    if (live.length === 0) return;
    recoverInFlight.current = true;
    let retry = false;
    try {
      let listed: Array<Record<string, unknown>> | undefined;
      for (const row of live) {
        try {
          let jobId = row.take.jobId;
          if (!jobId && window.electronAPI.higgsfield.generateList) {
            listed ??= await window.electronAPI.higgsfield.generateList({ video: true, size: 30 });
            jobId = matchListedJobToTake(listed, row.take);
          }
          if (!jobId) {
            retry = true;
            continue;
          }
          const result = await window.electronAPI.higgsfield.generate({
            jobId,
            model: row.take.modelId,
            outputType: 'video',
            wait: false,
          });
          if (!result.url) {
            retry = true;
            continue;
          }
          recoverAttempted.current.add(row.take.id);
          if (row.take.assetId) {
            dispatch({
              type: 'UPDATE_ASSET',
              asset: {
                id: row.take.assetId,
                url: result.url,
                fileRef: result.url,
                duration: result.durationSec,
                metadata: { generating: false, generatedVia: 'director', higgsfieldModel: row.take.modelId },
              },
            });
          }
          setShow(updateDirectorTake(showRef.current, row.clipId, row.take.id, {
            status: 'done',
            jobId,
          }));
        } catch {
          retry = true;
        }
      }
    } finally {
      recoverInFlight.current = false;
    }
    if (retry && recoverTries.current < 12) {
      recoverTries.current += 1;
      window.clearTimeout(recoverTimer.current);
      recoverTimer.current = window.setTimeout(() => setRecoverNonce((n) => n + 1), 4_000);
    }
  }, [dispatch, setShow]);

  useEffect(() => {
    void recoverLiveTakes();
    return () => window.clearTimeout(recoverTimer.current);
  }, [recoverLiveTakes, recoverNonce, show]);

  const fetchLiveTake = useCallback(async () => {
    recoverTries.current = 0;
    for (const clip of showRef.current.clips) {
      for (const take of clip.takes) {
        if (isDirectorTakeLive(take)) recoverAttempted.current.delete(take.id);
      }
    }
    setFetchingTake(true);
    try {
      await recoverLiveTakes();
    } finally {
      setFetchingTake(false);
    }
  }, [recoverLiveTakes]);

  const runRewrite = useCallback(async (notes: string) => {
    const current = showRef.current;
    const clip = selectedClip(current);
    if (!clip || !notes.trim()) return;
    const requestId = setJob('rewrite', 'Rewriting active variant…');
    try {
      const adapter = getDirectorAdapter(current.adapterId);
      const compiled = adapter.buildRequest({ show: current, clip, variant: clip.activeVariant });
      const payload = await runDirectorJsonJob(
        NOTES_REWRITE_SYSTEM_PROMPT,
        `NOTES:\n${notes.trim()}\n\nCURRENT BODY:\n${compiled.prompt}`,
        parseDirectorLlmProvider(current.llmProvider),
        requestId,
        undefined,
        { onUsage: recordSpend },
      );
      const body = payload && typeof payload === 'object' && typeof (payload as { body?: unknown }).body === 'string'
        ? (payload as { body: string }).body
        : '';
      if (!body) throw new Error('Rewrite did not return a body.');
      setShow(updateDirectorClip({ ...showRef.current, jobStatus: null }, clip.id, (entry) => ({
        ...entry,
        pendingRewrite: { variantKey: variantKey(entry.activeVariant), body },
      })));
    } catch (error) {
      failJob('rewrite', error, 'Rewrite failed');
    }
  }, [failJob, setJob, setShow]);

  const runLookBible = useCallback(async () => {
    const current = showRef.current;
    const requestId = setJob('look-bible', 'Writing look bible…');
    try {
      const payload = await runDirectorJsonJob(
        LOOK_BIBLE_SYSTEM_PROMPT,
        lookBibleJobInput(current),
        parseDirectorLlmProvider(current.llmProvider),
        requestId,
        undefined,
        { onUsage: recordSpend, imageUrls: lookBibleImageUrls(current) },
      );
      const stylePrefix = payload && typeof payload === 'object' && typeof (payload as { stylePrefix?: unknown }).stylePrefix === 'string'
        ? (payload as { stylePrefix: string }).stylePrefix.trim()
        : '';
      if (!stylePrefix) throw new Error('Look bible did not return a prefix.');
      setShow({ ...applyWrittenLook(showRef.current, stylePrefix), jobStatus: null });
    } catch (error) {
      failJob('look-bible', error, 'Look bible failed');
    }
  }, [failJob, setJob, setShow]);

  const cancelLookBible = useCallback(() => {
    const current = showRef.current;
    const requestId = current.jobStatus?.requestId;
    const provider = parseDirectorLlmProvider(current.llmProvider);
    // Hosted calls (fal, Higgsfield, OpenAI) have no kill switch — cancelling just stops
    // waiting. cliTransportFor maps a provider to the CLI actually running it (luna ->
    // codex) and returns null for hosted ones.
    const transport = cliTransportFor(provider);
    if (requestId && transport) {
      void cancelCliCopilotChat(transport, requestId);
    }
    setShow({ ...current, jobStatus: { type: 'look-bible', message: 'Cancelled', error: true } });
  }, [setShow]);

  // Full reset: script, breakdown, scenes, clips and sync state all go — the
  // setup, look bible and LLM choice stay. Kills any in-flight CLI job; hosted
  // jobs finish server-side but their results are dropped by the staleness
  // guard in runBreakdown/runShotlist.
  const startOver = useCallback(() => {
    const current = showRef.current;
    const requestId = current.jobStatus?.requestId;
    const provider = parseDirectorLlmProvider(current.llmProvider);
    const cli = requestId ? cliTransportFor(provider) : null;
    if (cli && requestId) void cancelCliCopilotChat(cli, requestId);
    setShow({
      ...current,
      docKind: undefined,
      sourceText: '',
      sourceElements: undefined,
      beatSheet: undefined,
      sourceFileName: undefined,
      chatMessages: undefined,
      breakdown: [],
      breakdownApproved: false,
      scenes: [],
      clips: [],
      stylePrefix: '',
      selectedSceneId: undefined,
      selectedClipId: undefined,
      selectedTakeId: undefined,
      sceneAssetOverrides: undefined,
      sceneAssetSuggestions: undefined,
      syncState: undefined,
      jobStatus: null,
      mode: 'source',
    });
  }, [setShow]);

  return (
    <div className="director-tab">
      <div className="director-tab__toolbar">
        <div className="director-tab__stagetabs">
          {TABS.map((tab) => (
            <button key={tab.id} type="button"
              className={`director-tab__stab${show.mode === tab.id ? ' director-tab__stab--active' : ''}`}
              onClick={() => setShow({ ...show, mode: tab.id })}>
              {tab.label}
              {tab.id === 'source' && show.sourceText.trim() && <span className="director-tab__stab-dot" />}
              {tab.id === 'breakdown' && show.breakdown.length > 0 && <span className="director-tab__stab-badge">{show.breakdown.length}</span>}
              {tab.id === 'shotlist' && nonAltClipCount > 0 && <span className="director-tab__stab-badge">{nonAltClipCount}</span>}
            </button>
          ))}
        </div>
        {show.jobStatus && (
          <span className={`director-tab__status${show.jobStatus.error ? ' director-tab__status--err' : ''}`}>
            {show.jobStatus.error ? show.jobStatus.message : directorRunningLabel(show.jobStatus.type)}
          </span>
        )}
        <div className="director-tab__toolcluster">
          <label className="dtog" title="Auto-run breakdown + shotlist after edits">
            <input type="checkbox" checked={show.autoSync ?? true}
              onChange={(e) => setShow({ ...show, autoSync: e.target.checked })} />
            <span className="dtog-track" aria-hidden><span className="dtog-thumb" /></span>
            <span className="dtog-label">Auto-sync</span>
            {cascade.running && <span className="dtog-badge dtog-badge--run">running</span>}
            {!cascade.running && cascade.dirty.length > 0 && <span className="dtog-badge">{cascade.dirty.length} stale</span>}
          </label>
          <span className="director-tab__vr" aria-hidden />
          <div className="dtool">
            <button
              type="button"
              className={`dtool-btn${openDrawer === 'setup' ? ' dtool-btn--on' : ''}`}
              aria-expanded={openDrawer === 'setup'}
              aria-controls="director-setup-drawer"
              onClick={() => setOpenDrawer((d) => d === 'setup' ? null : 'setup')}
            >
              <SetupIcon />
              Setup
            </button>
            <span className="dtool-vr" aria-hidden />
            <button
              type="button"
              className={`dtool-btn${openDrawer === 'look' ? ' dtool-btn--on' : ''}`}
              aria-expanded={openDrawer === 'look'}
              aria-controls="director-look-drawer"
              onClick={() => setOpenDrawer((d) => d === 'look' ? null : 'look')}
            >
              <LookIcon />
              Look bible
            </button>
          </div>
          <span className="director-tab__vr" aria-hidden />
          <DirectorLlmPicker
            provider={parseDirectorLlmProvider(show.llmProvider)}
            providers={cliProviders}
            falReady={Boolean(getApiKey())}
            openaiReady={Boolean(getOpenAiApiKey())}
            higgsfieldReady={higgsfieldReady}
            onChange={(llmProvider) => setShow({ ...show, llmProvider })}
          />
        </div>
      </div>

      <div
        id="director-setup-drawer"
        className={`director-tab__drawer${openDrawer === 'setup' ? ' director-tab__drawer--open' : ''}`}
      >
        <div className="director-tab__drawer-clip">
          <DirectorSetupDrawer show={show} onChange={setShow} />
        </div>
      </div>
      <div
        id="director-look-drawer"
        className={`director-tab__drawer${openDrawer === 'look' ? ' director-tab__drawer--open' : ''}`}
      >
        <div className="director-tab__drawer-clip">
          <DirectorLookBiblePanel
            show={show}
            writing={directorJobIsRunning(show, 'look-bible')}
            error={show.jobStatus?.type === 'look-bible' && show.jobStatus.error ? show.jobStatus.message : ''}
            onChange={setShow}
            onWrite={() => void runLookBible()}
            onCancel={cancelLookBible}
          />
        </div>
      </div>

      <div className={`director-tab__workbench${withRail ? '' : ' director-tab__workbench--norail'}`}>
        {withRail && (
          <DirectorStructureRail
            show={show}
            filterSceneId={sceneFilter}
            onShowAll={() => setSceneFilter(null)}
            onSelectScene={(sceneId) => { setSceneFilter(sceneId); selectScene(sceneId); }}
            onSelectClip={(sceneId, clipId) => {
              setSceneFilter(sceneId);
              selectClip(sceneId, clipId);
              setExpandRequest((prev) => ({ clipId, n: (prev?.n ?? 0) + 1 }));
            }}
          />
        )}
        {show.mode === 'source' && (
          <DirectorScriptTab
            show={show}
            onChange={setShow}
            onBreakdown={() => {
              const cur = showRef.current;
              cascade.acknowledge(cur.sourceText, cur.docKind);
              void runBreakdown();
            }}
            onStartOver={startOver}
          />
        )}
        {show.mode === 'breakdown' && (
          <DirectorBreakdownTab show={show} elements={state.elements} dirtyKeys={cascade.dirty} syncing={cascade.running} onChange={setShow} onCreateElement={createElementFromBreakdown} onOpenElements={() => dispatch({ type: 'SET_TAB', tab: 'elements' })} />
        )}
        {show.mode === 'shotlist' && (
          <DirectorShotlistTab show={show} elements={state.elements} sceneFilter={sceneFilter} expandRequest={expandRequest} syncing={cascade.running} onChange={setShow} onShotlist={startManualShotlist} onStopShotlist={stopShotlist} onSceneNotes={(sceneId, notes) => void runSceneNotes(sceneId, notes)} onSelectClip={selectClip} />
        )}
        {show.mode === 'generate' && (
          <DirectorGenerateTab
            show={show} assets={state.assets} preflight={preflight} warnings={warnings}
            selectedBeatN={selectedBeatN} onSelectBeat={setSelectedBeatN}
            onChange={setShow}
            onGenerate={(scope) => void runGenerate(scope)}
            onFetchTake={() => void fetchLiveTake()}
            fetchingTake={fetchingTake}
            onRewrite={(notes) => void runRewrite(notes)}
            onKeepRewrite={() => { const current = selectedClip(show); if (current) setShow(keepPendingRewrite(show, current.id)); }}
            onDiscardRewrite={() => { const current = selectedClip(show); if (current) setShow(discardPendingRewrite(show, current.id)); }}
            onRemoveAsset={(assetId) => dispatch({ type: 'REMOVE_ASSET', assetId })}
          />
        )}
      </div>
    </div>
  );
}

function SetupIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 3.2v2.1M12 18.7v2.1M4.7 4.7l1.5 1.5M17.8 17.8l1.5 1.5M3.2 12h2.1M18.7 12h2.1M4.7 19.3l1.5-1.5M17.8 6.2l1.5-1.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LookIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 5h12.2A1.8 1.8 0 0 1 19 6.8V20H7.4A2.4 2.4 0 0 0 5 22.4V5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M5 5A2.4 2.4 0 0 1 7.4 2.6H20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M8.5 9h7M8.5 12.5h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
