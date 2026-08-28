import { useCallback, useEffect, useRef, useState } from 'react';
import type { DirectorBeatTime, DirectorBreakdownItem, DirectorMode, DirectorShow } from '@/types/director';
import type { Element } from '@/types/elements';
import { useWorkspace } from '@/components/workspace/workspace-shell';
import { DirectorStructureRail } from './director-structure-rail';
import { DirectorScriptTab } from './director-script-tab';
import { DirectorBreakdownTab } from './director-breakdown-tab';
import { DirectorShotlistTab } from './director-shotlist-tab';
import { DirectorStoryboardTab } from './director-storyboard-tab';
import { DirectorGenerateTab } from './director-generate-tab';
import { DirectorSetupDrawer } from './director-setup-drawer';
import { DirectorLookBiblePanel } from './director-look-bible';
import { useDirectorCascade } from './use-director-cascade';
import { pruneRemovedScenes, remapSceneIndexMaps } from '@/lib/director/cascade';
import { createEmptyDirectorShow } from '@/lib/director/create-show';
import { applyLlmBreakdownItems, mergeScenes, parseBreakdownPayload } from '@/lib/director/breakdown';
import { localBreakdownForShow } from '@/lib/director/local-breakdown';
import { applyReshotBeat, applyReshotClip, clipDisplayLabels, mergeShotlist, parseReshotBeatPayload, parseReshotClipPayload, parseShotlistPayload, shotDensityHint } from '@/lib/director/shotlist';
import { BREAKDOWN_AUDIT_SYSTEM_PROMPT, BREAKDOWN_IDENTIFY_SYSTEM_PROMPT, CLIP_NOTES_SYSTEM_PROMPT, LOOK_BIBLE_SYSTEM_PROMPT, RESHOT_BEAT_SYSTEM_PROMPT, reshotClipSystemPrompt, SCENE_NOTES_SYSTEM_PROMPT } from '@/lib/director/llm-jobs';
import {
  breakdownAuditInput,
  breakdownJobInput,
  clipNotesJobInput,
  lookBibleJobInput,
  reshotBeatJobInput,
  reshotClipJobInput,
  sceneNotesJobInput,
} from '@/lib/director/job-inputs';
import { applyWrittenLook, lookBibleImageUrls } from '@/lib/director/look-bible';
import { ENRICH_CHARACTER_SYSTEM_PROMPT, buildEnrichInput, parseEnrichResult } from '@/lib/director/enrich';
import {
  getApiKey,
  getOpenAiApiKey,
  getRunpodLtxPodAuthToken,
  getRunpodLtxPodId,
  getRunpodLtxPodUrl,
  getRunpodSessionImageModels,
  isRunpodGenerationSessionReady,
} from '@/lib/utils/api-key';
import { adapterIdForVideoProvider, getVideoGenerationProvider } from '@/lib/utils/video-generation-provider';
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
import { generateLtx25AndWait } from '@/lib/runpod/ltx25-client';
import { generateSessionImageAndWait } from '@/lib/runpod/session-image-client';
import { parseVariantKey, variantKey, variantTakeLabel } from '@/lib/director/slate';
import { generateId, timestamp } from '@/lib/utils/ids';
import { defaultFolderForNewElement, projectFolderId } from '@/lib/elements/library';
import { HIGGSFIELD_MODELS } from '@/lib/higgsfield/higgsfield-models';
import { runWorkflow } from '@/lib/cloud/funding';
import {
  storyboardPlan,
  storyboardGenerationErrorMessage,
  storyboardModelForRunpodSession,
  storyboardModelOption,
  storyboardQwenRequest,
  storyboardPromptWithReferences,
  storyboardPromptWithoutImageReferences,
  storyboardReferences,
  storyboardResultUrl,
  storyboardRunpodDimensions,
  runStoryboardWithRetry,
  upsertStoryboardFrame,
} from '@/lib/director/storyboard';
import { planDirectorFolders } from '@/lib/director/folders';
import { stagingDiagramPrompt } from '@/lib/director/staging-map';
import {
  bindStagingDiagram, ensureClipStaging, listedStagingJobId, listedStagingMediaUrl,
  matchListedStagingJob, patchClipStaging,
} from '@/lib/director/staging-diagram';
import { captureFramingLook, bindKeyForFrameGrab, stagingBindKey } from '@/lib/director/framing-reserve';
import { takeTimelineClip } from '@/lib/director/take-timeline';
import { grammarSizeLabel } from '@/lib/director/craft/coverage';
import type { Asset } from '@/types/project';
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
  const recoverTimer = useRef<number | undefined>(undefined);
  const stagingRecovered = useRef<Set<string>>(new Set());
  const [recoverNonce, setRecoverNonce] = useState(0);
  const [fetchingTake, setFetchingTake] = useState(false);
  showRef.current = show;
  foldersRef.current = state.mediaFolders;
  elementsRef.current = state.elements;

  const [selectedBeatN, setSelectedBeatN] = useState(1);
  const [preflight, setPreflight] = useState('Topview AI · Auto');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [cliProviders, setCliProviders] = useState<Record<CliLlmProviderId, DirectorCliInfo>>(EMPTY_CLI_PROVIDERS);
  const [higgsfieldReady, setHiggsfieldReady] = useState(false);
  const [runpodStoryboardSession, setRunpodStoryboardSession] = useState(() => ({
    ready: isRunpodGenerationSessionReady(),
    models: getRunpodSessionImageModels(),
  }));
  const [openDrawer, setOpenDrawer] = useState<'setup' | 'look' | null>(null);

  const TABS: { id: DirectorMode; label: string }[] = [
    { id: 'source', label: 'Script' },
    { id: 'breakdown', label: 'Breakdown' },
    { id: 'shotlist', label: 'Shotlist' },
    { id: 'storyboard', label: 'Storyboard' },
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
  const storyboardFrameCount = show.clips
    .filter((clip) => !clip.altOf && liveSceneIds.has(clip.sceneId))
    .reduce((total, clip) => total + clip.beats.length, 0);
  const withRail = show.mode === 'shotlist' || show.mode === 'storyboard' || show.mode === 'generate';

  const setShow = useCallback((director: DirectorShow) => {
    // Eagerly update the ref: async jobs read-modify-write showRef.current, and
    // React batches renders — two setShow calls in one tick would otherwise
    // both build on the SAME stale snapshot and the second silently reverts
    // the first (this is how freshly merged clips were vanishing).
    showRef.current = director;
    dispatch({ type: 'SET_DIRECTOR', director });
  }, [dispatch]);

  useEffect(() => {
    const syncVideoProvider = () => {
      const adapterId = adapterIdForVideoProvider(getVideoGenerationProvider());
      const current = showRef.current;
      if (current.adapterId !== adapterId) setShow({ ...current, adapterId });
    };
    syncVideoProvider();
    window.addEventListener('cinegen:settings-changed', syncVideoProvider);
    return () => window.removeEventListener('cinegen:settings-changed', syncVideoProvider);
  }, [setShow]);

  useEffect(() => {
    const syncRunpodStoryboardSession = () => {
      const ready = isRunpodGenerationSessionReady();
      const models = getRunpodSessionImageModels();
      setRunpodStoryboardSession({ ready, models });

      const current = showRef.current;
      const storyboardModelId = storyboardModelForRunpodSession(current.storyboardModelId, ready, models);
      if (storyboardModelId && storyboardModelId !== current.storyboardModelId) {
        setShow({ ...current, storyboardModelId });
      }
    };
    syncRunpodStoryboardSession();
    window.addEventListener('cinegen:settings-changed', syncRunpodStoryboardSession);
    return () => window.removeEventListener('cinegen:settings-changed', syncRunpodStoryboardSession);
  }, [setShow]);

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
        if (adapter.provider === 'topview') {
          const [status, higgsfieldStatus] = await Promise.all([
            window.electronAPI.topview.accountStatus(),
            window.electronAPI.higgsfield.accountStatus().catch(() => ({ connected: false })),
          ]);
          connected = status.connected;
          error = status.error;
          if (!cancelled) setHiggsfieldReady(Boolean(higgsfieldStatus.connected));
        } else if (adapter.provider === 'artlist') {
          const [status, higgsfieldStatus] = await Promise.all([
            window.electronAPI.artlist.accountStatus(),
            window.electronAPI.higgsfield.accountStatus().catch(() => ({ connected: false })),
          ]);
          connected = status.connected;
          error = status.error;
          if (!cancelled) setHiggsfieldReady(Boolean(higgsfieldStatus.connected));
        } else if (adapter.provider === 'runpod') {
          const higgsfieldStatus = await window.electronAPI.higgsfield.accountStatus().catch(() => ({ connected: false }));
          connected = Boolean(getRunpodLtxPodId() && getRunpodLtxPodUrl() && getRunpodLtxPodAuthToken());
          error = connected ? undefined : 'Start an LTX-2.5 Pod session in Settings.';
          if (!cancelled) setHiggsfieldReady(Boolean(higgsfieldStatus.connected));
        } else {
          const status = await window.electronAPI.higgsfield.accountStatus();
          connected = status.connected;
          error = status.error;
        }
      } catch (err) {
        connected = false;
        error = err instanceof Error ? err.message : `${adapter.label} unavailable`;
      }
      if (cancelled) return;
      if (adapter.provider !== 'topview' && adapter.provider !== 'artlist' && adapter.provider !== 'runpod') setHiggsfieldReady(Boolean(connected));
      const result = generationPreflight({
        clipCount: 1,
        seconds: selectedClip(show)?.seconds ?? 0,
        adapterLabel: adapter.label,
        providerConnected: connected,
        providerError: error,
      });
      const maxDurationSec = adapter.capabilities.maxDurationSec;
      if (maxDurationSec !== undefined && (selectedClip(show)?.seconds ?? 0) > maxDurationSec) {
        result.warnings.push(`${adapter.label} supports direct clips up to ${maxDurationSec}s. Choose a shorter clip/isolate or another provider before rendering.`);
      }
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

  const setStagingFrame = useCallback(async (source: {
    dataUrl?: string;
    fileRef?: string;
    timeSec?: number;
    durationSec?: number;
    variantKey?: string;
    beatTimes?: DirectorBeatTime[];
    promptSnapshot?: string;
  }) => {
    const current = showRef.current;
    const clip = selectedClip(current);
    const scene = selectedScene(current);
    if (!clip || !scene) return;
    let framePath: string | undefined;
    try {
      if (source.dataUrl?.startsWith('data:') && window.electronAPI?.media?.writeTempImage) {
        framePath = (await window.electronAPI.media.writeTempImage({ dataUrl: source.dataUrl })).outputPath;
      } else if (source.fileRef && window.electronAPI?.media?.extractFrame) {
        const extracted = await window.electronAPI.media.extractFrame({
          inputPath: source.fileRef,
          timeSec: source.timeSec ?? 0,
        });
        framePath = extracted?.outputPath;
      }
    } catch (error) {
      setShow(patchClipStaging(showRef.current, clip.id, {
        error: error instanceof Error ? error.message : 'Could not save that frame.',
      }, scene.label));
      return;
    }
    const url = framePath || source.dataUrl;
    if (!url) {
      setShow(patchClipStaging(showRef.current, clip.id, {
        error: 'Pause the take on the frame you like, then Set as frame.',
      }, scene.label));
      return;
    }
    const clipLabel = clipDisplayLabels(current.scenes, current.clips).get(clip.id);
    const planned = planDirectorFolders({
      folders: foldersRef.current,
      scene,
      clip,
      variantKey: variantKey(clip.activeVariant),
      clipLabel,
    });
    foldersRef.current = [...foldersRef.current, ...planned.foldersToAdd];
    for (const folder of planned.foldersToAdd) dispatch({ type: 'ADD_FOLDER', folder });
    for (const folder of planned.foldersToRename) {
      foldersRef.current = foldersRef.current.map((entry) => (
        entry.id === folder.id ? { ...entry, ...folder } : entry
      ));
      dispatch({ type: 'UPDATE_FOLDER', folder });
    }
    const timeline = takeTimelineClip(clip, {
      beatTimes: source.beatTimes,
      promptSnapshot: source.promptSnapshot ?? '',
    });
    const bindKey = bindKeyForFrameGrab(timeline, {
      variant: source.variantKey ? parseVariantKey(source.variantKey) : clip.activeVariant,
      timeSec: source.timeSec,
      durationSec: source.durationSec,
    });
    const look = captureFramingLook(clip, bindKey);
    const size = grammarSizeLabel(look.grammar);
    const shotLabel = bindKey === 'full'
      ? variantTakeLabel(clip, variantKey(clip.activeVariant))
      : `S${bindKey}`;
    const asset: Asset = {
      id: generateId(),
      name: `${clipLabel ?? clip.title} ${shotLabel}${size ? ` · ${size}` : ''} frame`,
      type: 'image',
      url,
      fileRef: framePath,
      thumbnailUrl: url,
      createdAt: timestamp(),
      folderId: planned.clipId,
      metadata: {
        generatedVia: 'director-staging-frame',
        directorClipId: clip.id,
        directorBindKey: bindKey,
        directorLook: look,
      },
    };
    dispatch({ type: 'ADD_ASSET', asset });
    setShow(patchClipStaging(showRef.current, clip.id, {
      sourceFrameUrl: url,
      sourceAssetId: asset.id,
      sourceBindKey: bindKey,
      sourceLook: look,
      error: undefined,
      status: clip.staging?.diagramUrl ? 'ready' : 'idle',
    }, scene.label));
  }, [dispatch, setShow]);

  const commitStagingDiagram = useCallback((args: {
    clipId: string;
    url: string;
    jobId?: string;
    scope: 'clip' | 'scene';
  }) => {
    const current = showRef.current;
    const clip = current.clips.find((entry) => entry.id === args.clipId);
    const scene = current.scenes.find((entry) => entry.id === clip?.sceneId);
    if (!clip || !scene) return;
    const staging = ensureClipStaging(clip, scene.label, current.breakdown);
    const tagName = staging.stagingTag.replace(/^@/, '');
    const existing = elementsRef.current.find((element) => element.id === staging.elementId)
      ?? elementsRef.current.find((element) => element.name === tagName);
    const image = { id: generateId(), url: args.url, createdAt: timestamp(), source: 'generated' as const };
    let elementId = existing?.id ?? generateId();
    if (existing) {
      dispatch({
        type: 'UPDATE_ELEMENT',
        elementId: existing.id,
        updates: { images: [image, ...existing.images] },
      });
      elementId = existing.id;
    } else {
      dispatch({
        type: 'ADD_ELEMENT',
        element: {
          id: elementId,
          name: tagName,
          type: 'prop',
          description: 'Staging reference — positions only.',
          images: [image],
          folderId: defaultFolderForNewElement('all', projectFolderId(
            { version: 1, folders: state.elementFolders, elements: elementsRef.current },
            projectId,
          )),
          createdAt: timestamp(),
          updatedAt: timestamp(),
        },
      });
    }
    const clipLabel = clipDisplayLabels(current.scenes, current.clips).get(clip.id);
    const planned = planDirectorFolders({
      folders: foldersRef.current,
      scene,
      clip,
      variantKey: variantKey(clip.activeVariant),
      clipLabel,
    });
    foldersRef.current = [...foldersRef.current, ...planned.foldersToAdd];
    for (const folder of planned.foldersToAdd) dispatch({ type: 'ADD_FOLDER', folder });
    const grab = clip.staging;
    const bindKey = grab?.sourceBindKey ?? stagingBindKey(clip.activeVariant);
    const look = grab?.sourceLook ?? captureFramingLook(clip, bindKey);
    const size = grammarSizeLabel(look.grammar);
    const shotLabel = bindKey === 'full'
      ? variantTakeLabel(clip, variantKey(clip.activeVariant))
      : `S${bindKey}`;
    const diagramAsset: Asset = {
      id: generateId(),
      name: `${clipLabel ?? clip.title} ${shotLabel}${size ? ` · ${size}` : ''} map`,
      type: 'image',
      url: args.url,
      sourceUrl: args.url,
      thumbnailUrl: args.url,
      createdAt: timestamp(),
      folderId: planned.clipId,
      metadata: {
        generatedVia: 'director-staging-map',
        directorClipId: clip.id,
        directorBindKey: bindKey,
        directorLook: look,
        higgsfieldModel: HIGGSFIELD_MODELS.nanoBanana,
        higgsfieldJobId: args.jobId,
      },
    };
    dispatch({ type: 'ADD_ASSET', asset: diagramAsset });
    setShow(bindStagingDiagram({
      show: showRef.current,
      clipId: clip.id,
      diagramUrl: args.url,
      elementId,
      assetId: diagramAsset.id,
      jobId: args.jobId,
      scope: args.scope,
      framingName: `${clipLabel ?? clip.title} · ${shotLabel}${size ? ` · ${size}` : ''}`,
    }));
  }, [dispatch, projectId, setShow, state.elementFolders]);

  const pullStagingDiagram = useCallback(async (jobId?: string) => {
    const hf = window.electronAPI?.higgsfield;
    const fromList = async () => {
      if (!hf?.generateList) return undefined;
      const listed = await hf.generateList({ size: 50 });
      const match = matchListedStagingJob(listed, { jobId });
      const url = match ? listedStagingMediaUrl(match) : undefined;
      if (!match || !url) return undefined;
      return { url, jobId: listedStagingJobId(match) ?? jobId };
    };
    const listed = await fromList();
    if (listed) return listed;
    if (jobId && hf?.generate) {
      try {
        const got = await hf.generate({
          jobId,
          model: HIGGSFIELD_MODELS.nanoBanana,
          outputType: 'image',
          wait: false,
        });
        if (got.url) return { url: got.url, jobId: got.jobId ?? jobId };
      } catch {
        // Still running — poll the image list instead of a 20-minute wait.
      }
    }
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 3000));
      const again = await fromList();
      if (again) return again;
    }
    return undefined;
  }, []);

  const fetchStagingDiagram = useCallback(async () => {
    const current = showRef.current;
    const clip = selectedClip(current);
    const scene = selectedScene(current);
    if (!clip || !scene) return;
    const staging = ensureClipStaging(clip, scene.label, current.breakdown);
    if (!window.electronAPI?.higgsfield?.generateList) {
      setShow(patchClipStaging(current, clip.id, {
        status: 'failed',
        error: 'Higgsfield generate is only available in the CineGen desktop app.',
      }, scene.label));
      return;
    }
    const scope = staging.scope ?? 'clip';
    setShow(patchClipStaging(showRef.current, clip.id, { status: 'generating', error: undefined }, scene.label));
    try {
      const pulled = await pullStagingDiagram(staging.jobId);
      if (!pulled?.url) {
        throw new Error('No blocking map on Higgsfield yet. If the job is still running, wait, then Load from Higgsfield.');
      }
      commitStagingDiagram({ clipId: clip.id, url: pulled.url, jobId: pulled.jobId, scope });
    } catch (error) {
      setShow(patchClipStaging(showRef.current, clip.id, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Could not load the blocking map.',
      }, scene.label));
    }
  }, [commitStagingDiagram, pullStagingDiagram, setShow]);

  const keepStagingFraming = useCallback(() => {
    const clip = selectedClip(showRef.current);
    const url = clip?.staging?.diagramUrl?.trim();
    if (!clip || !url) return;
    commitStagingDiagram({
      clipId: clip.id,
      url,
      jobId: clip.staging?.jobId,
      scope: clip.staging?.scope ?? 'clip',
    });
  }, [commitStagingDiagram]);

  const cancelStagingDiagram = useCallback(() => {
    const current = showRef.current;
    const clip = selectedClip(current);
    const scene = selectedScene(current);
    if (!clip || !scene) return;
    setShow(patchClipStaging(current, clip.id, {
      status: clip.staging?.diagramUrl ? 'ready' : 'idle',
      error: undefined,
    }, scene.label));
  }, [setShow]);

  const makeStagingDiagram = useCallback(async () => {
    const current = showRef.current;
    const clip = selectedClip(current);
    const scene = selectedScene(current);
    if (!clip || !scene) return;
    const staging = ensureClipStaging(clip, scene.label, current.breakdown);
    if (!staging.sourceFrameUrl) {
      setShow(patchClipStaging(current, clip.id, { error: 'Set a frame first.' }, scene.label));
      return;
    }
    if (!window.electronAPI?.higgsfield?.generate) {
      setShow(patchClipStaging(current, clip.id, {
        error: 'Higgsfield generate is only available in the CineGen desktop app.',
      }, scene.label));
      return;
    }
    const scope = staging.scope ?? 'clip';
    setShow(patchClipStaging(showRef.current, clip.id, { status: 'generating', error: undefined }, scene.label));
    try {
      let mediaValue = staging.sourceFrameUrl;
      if (mediaValue.startsWith('data:') && window.electronAPI.media?.writeTempImage) {
        mediaValue = (await window.electronAPI.media.writeTempImage({ dataUrl: mediaValue })).outputPath;
      }
      const submitted = await window.electronAPI.higgsfield.generate({
        prompt: stagingDiagramPrompt({
          figures: staging.figures,
          aspectRatio: current.aspectRatio,
          engine: 'higgsfield',
        }),
        model: HIGGSFIELD_MODELS.nanoBanana,
        outputType: 'image',
        medias: [{ value: mediaValue, role: 'image' }],
        params: { aspect_ratio: current.aspectRatio, resolution: '2k' },
        wait: false,
      });
      if (submitted.jobId) {
        setShow(patchClipStaging(showRef.current, clip.id, {
          status: 'generating',
          jobId: submitted.jobId,
          error: undefined,
        }, scene.label));
      }
      const pulled = submitted.url
        ? { url: submitted.url, jobId: submitted.jobId }
        : await pullStagingDiagram(submitted.jobId);
      if (!pulled?.url) {
        throw new Error('Higgsfield finished the map, but CineGen missed the image URL. Use Load from Higgsfield.');
      }
      commitStagingDiagram({
        clipId: clip.id,
        url: pulled.url,
        jobId: pulled.jobId ?? submitted.jobId,
        scope,
      });
    } catch (error) {
      setShow(patchClipStaging(showRef.current, clip.id, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Blocking map failed.',
      }, scene.label));
    }
  }, [commitStagingDiagram, pullStagingDiagram, setShow]);

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
    if (!scene || clips.length === 0 || !notes.trim()) return false;
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
      if (showRef.current.sourceText !== current.sourceText) return false;
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
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return false;
      failJob('rewrite', error, 'Notes rewrite failed');
      return false;
    }
  }, [failJob, setJob, setShow]);

  const runClipNotes = useCallback(async (clipId: string, notes: string) => {
    const current = showRef.current;
    const clip = current.clips.find((entry) => entry.id === clipId);
    const scene = clip ? current.scenes.find((entry) => entry.id === clip.sceneId) : undefined;
    if (!clip || !scene || !notes.trim()) return false;
    const labels = clipDisplayLabels(current.scenes, current.clips);
    const clipLabel = labels.get(clip.id) ?? clip.id;
    const requestId = setJob('rewrite', `Applying notes to ${clipLabel}…`);
    try {
      const payload = await runDirectorJsonJob(
        CLIP_NOTES_SYSTEM_PROMPT,
        clipNotesJobInput(scene, clip, clipLabel, notes),
        parseDirectorLlmProvider(current.llmProvider),
        requestId,
        undefined,
        { onUsage: recordSpend },
      );
      if (showRef.current.sourceText !== current.sourceText) return false;
      const incoming = parseReshotClipPayload(payload, clip.sceneId);
      if (!incoming || incoming.beats.length === 0) throw new Error('The rewrite returned no shots.');
      setShow(updateDirectorClip(
        { ...showRef.current, jobStatus: null },
        clipId,
        (entry) => applyReshotClip(entry, incoming),
      ));
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return false;
      failJob('rewrite', error, 'Notes rewrite failed');
      return false;
    }
  }, [failJob, setJob, setShow]);

  const runReshotBeat = useCallback(async (clipId: string, beatN: number) => {
    const current = showRef.current;
    const clip = current.clips.find((entry) => entry.id === clipId);
    const scene = clip ? current.scenes.find((entry) => entry.id === clip.sceneId) : undefined;
    const beat = clip?.beats.find((entry) => entry.n === beatN);
    if (!clip || !scene || !beat) return;
    const labels = clipDisplayLabels(current.scenes, current.clips);
    const clipLabel = labels.get(clip.id) ?? clip.id;
    const requestId = setJob('rewrite', `Redoing S${beatN} of ${clipLabel}…`);
    try {
      const payload = await runDirectorJsonJob(
        RESHOT_BEAT_SYSTEM_PROMPT,
        reshotBeatJobInput(scene, clip, clipLabel, beatN),
        parseDirectorLlmProvider(current.llmProvider),
        requestId,
        undefined,
        { onUsage: recordSpend },
      );
      if (showRef.current.sourceText !== current.sourceText) return;
      const incoming = parseReshotBeatPayload(payload, beatN);
      if (!incoming?.cam?.trim()) throw new Error('The rewrite returned no camera line.');
      setShow(updateDirectorClip(
        { ...showRef.current, jobStatus: null },
        clipId,
        (entry) => applyReshotBeat(entry, beatN, incoming),
      ));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      failJob('rewrite', error, 'Redo shot failed');
    }
  }, [failJob, setJob, setShow]);

  const runReshotClip = useCallback(async (clipId: string) => {
    const current = showRef.current;
    const clip = current.clips.find((entry) => entry.id === clipId);
    const scene = clip ? current.scenes.find((entry) => entry.id === clip.sceneId) : undefined;
    if (!clip || !scene) return;
    const labels = clipDisplayLabels(current.scenes, current.clips);
    const clipLabel = labels.get(clip.id) ?? clip.id;
    const neighbours = current.clips
      .filter((entry) => entry.sceneId === clip.sceneId && entry.id !== clip.id && !entry.altOf)
      .map((entry) => ({ label: labels.get(entry.id) ?? entry.id, title: entry.title }));
    const requestId = setJob('rewrite', `Redoing ${clipLabel}…`);
    try {
      const payload = await runDirectorJsonJob(
        reshotClipSystemPrompt(clip.seconds, shotDensityHint(clip.seconds)),
        reshotClipJobInput(scene, clip, clipLabel, neighbours),
        parseDirectorLlmProvider(current.llmProvider),
        requestId,
        undefined,
        { onUsage: recordSpend },
      );
      if (showRef.current.sourceText !== current.sourceText) return;
      const incoming = parseReshotClipPayload(payload, clip.sceneId);
      if (!incoming || incoming.beats.length === 0) throw new Error('The rewrite returned no shots.');
      setShow(updateDirectorClip(
        { ...showRef.current, jobStatus: null },
        clipId,
        (entry) => applyReshotClip(entry, incoming),
      ));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      failJob('rewrite', error, 'Redo clip failed');
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
    const adapter = getDirectorAdapter(current.adapterId);
    const activeVariant = clip.activeVariant;
    const intendedDuration = activeVariant.kind === 'isolated' && activeVariant.mode === 'native'
      ? clip.beats.find((beat) => beat.n === activeVariant.beatN)?.dur ?? clip.seconds
      : clip.seconds;
    const maxDurationSec = adapter.capabilities.maxDurationSec;
    if (maxDurationSec !== undefined && intendedDuration > maxDurationSec) {
      const message = `${adapter.label} supports direct clips up to ${maxDurationSec}s. Choose a shorter clip/isolate, or select another provider in Settings.`;
      setShow({ ...current, jobStatus: { type: 'generate', message, error: true } });
      return message;
    }
    const canGenerate = adapter.provider === 'topview'
      ? Boolean(window.electronAPI?.topview?.generate)
      : adapter.provider === 'artlist'
        ? Boolean(window.electronAPI?.artlist?.generate)
      : adapter.provider === 'runpod'
        ? Boolean((window.electronAPI?.pod as typeof window.electronAPI.pod & { generateLtx25?: unknown })?.generateLtx25)
        : Boolean(window.electronAPI?.higgsfield?.generate);
    if (!canGenerate) {
      const message = adapter.provider === 'runpod'
        ? 'RunPod LTX-2.5 generation is not available in this CineGen build.'
        : `${adapter.label} generation is only available in the CineGen desktop app.`;
      setShow({ ...current, jobStatus: { type: 'generate', message, error: true } });
      return message;
    }
    if (adapter.provider === 'runpod' && !(getRunpodLtxPodId() && getRunpodLtxPodUrl() && getRunpodLtxPodAuthToken())) {
      const message = 'Start an LTX-2.5 Pod session in Settings before generating.';
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
      const submitted = prepared.request.provider === 'runpod'
        ? await generateLtx25AndWait({
            prompt: prepared.request.prompt,
            durationSec: prepared.request.durationSec,
            aspectRatio: String(prepared.request.params.aspect_ratio ?? current.aspectRatio),
            resolution: String(prepared.request.params.resolution ?? current.resolution),
            generateAudio: Boolean(prepared.request.params.generate_audio),
            referenceImages: prepared.request.medias
              ?.filter((media) => media.role === 'image' || media.role === 'start_image')
              .map((media) => media.value),
          }, {
            onJobId: (jobId) => {
              recoverAttempted.current.add(prepared.take.id);
              setShow(updateDirectorTake(showRef.current, clip.id, prepared.take.id, { jobId }));
            },
          })
        : prepared.request.provider === 'topview'
          ? await window.electronAPI.topview.generate({
              prompt: prepared.request.prompt,
              model: prepared.request.modelId,
              durationSec: prepared.request.durationSec,
              aspectRatio: String(prepared.request.params.aspect_ratio ?? current.aspectRatio),
              resolution: String(prepared.request.params.resolution ?? current.resolution),
              generateAudio: Boolean(prepared.request.params.generate_audio),
              medias: prepared.request.medias,
            })
        : prepared.request.provider === 'artlist'
          ? await window.electronAPI.artlist.generate({
              prompt: prepared.request.prompt,
              model: prepared.request.modelId,
              durationSec: prepared.request.durationSec,
              aspectRatio: String(prepared.request.params.aspect_ratio ?? current.aspectRatio),
              resolution: String(prepared.request.params.resolution ?? current.resolution),
              generateAudio: Boolean(prepared.request.params.generate_audio),
              medias: prepared.request.medias,
            })
          : await window.electronAPI.higgsfield.generate({
              prompt: prepared.request.prompt,
              model: prepared.request.modelId,
              outputType: 'video',
              params: prepared.request.params,
              medias: prepared.request.medias,
              wait: false,
            });
      const jobId = 'jobId' in submitted
        ? submitted.jobId
        : ('generationId' in submitted
            ? submitted.generationId
            : ('taskId' in submitted ? submitted.taskId : undefined));
      if (jobId) {
        recoverAttempted.current.add(prepared.take.id);
        setShow(updateDirectorTake(showRef.current, clip.id, prepared.take.id, { jobId }));
      }
      const result = submitted.url
        ? submitted
        : jobId && prepared.request.provider === 'higgsfield'
          ? await window.electronAPI.higgsfield.generate({
              jobId,
              model: prepared.request.modelId,
              outputType: 'video',
            })
          : submitted;
      if (!result.url) throw new Error(`${prepared.request.label} finished but returned no video URL.`);
      dispatch({
        type: 'UPDATE_ASSET',
        asset: {
          id: prepared.asset.id,
          url: result.url,
          fileRef: result.url,
          duration: result.durationSec ?? prepared.request.durationSec,
          metadata: {
            generating: false,
            generatedVia: 'director',
            generationProvider: prepared.request.provider,
            generationModel: 'model' in result && result.model ? result.model : prepared.request.modelId,
            ...(prepared.request.provider === 'higgsfield' ? { higgsfieldModel: prepared.request.modelId } : {}),
            ...('accountUrl' in result && result.accountUrl ? { artlistAccountUrl: result.accountUrl } : {}),
            ...('boardUrl' in result && result.boardUrl ? { topviewBoardUrl: result.boardUrl } : {}),
          },
        },
      });
      setShow(updateDirectorTake(showRef.current, clip.id, prepared.take.id, {
        status: 'done',
        jobId: ('jobId' in result ? result.jobId : undefined) ?? jobId,
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

  const generateStoryboardFrame = useCallback(async (
    frameId: string,
    requestedModelId?: DirectorShow['storyboardModelId'],
  ): Promise<void> => {
    const currentPlan = storyboardPlan(showRef.current).find((frame) => frame.id === frameId);
    if (!currentPlan) return;
    const modelId = requestedModelId ?? showRef.current.storyboardModelId ?? HIGGSFIELD_MODELS.nanoBanana;
    const modelOption = storyboardModelOption(modelId);
    const prompt = currentPlan.prompt.trim();
    if (!prompt) {
      setShow(upsertStoryboardFrame(showRef.current, currentPlan, {
        status: 'failed',
        error: 'Write a storyboard prompt before generating this frame.',
      }));
      return;
    }
    setShow(upsertStoryboardFrame(showRef.current, currentPlan, {
      prompt,
      status: 'generating',
      error: undefined,
    }));
    try {
      const referenceSet = storyboardReferences(showRef.current, currentPlan.clip, elementsRef.current);
      const referenceUrls = referenceSet.references.map((reference) => reference.url);
      const dimensions = storyboardRunpodDimensions(showRef.current.aspectRatio);
      const result = modelOption.provider === 'runpod'
        ? await (async () => {
            if (!isRunpodGenerationSessionReady() || !modelOption.sessionModel) {
              throw new Error('Start a RunPod Generation Session in Settings before rendering this storyboard model.');
            }
            if (!getRunpodSessionImageModels().includes(modelOption.sessionModel)) {
              throw new Error(`${modelOption.shortLabel} was not included in this RunPod session. End it when you are finished, select the model in Settings, then start a new session.`);
            }

            const existingFrame = currentPlan.saved?.imageUrl?.trim();
            const qwenRequest = modelOption.sessionModel === 'qwen-image-edit'
              ? storyboardQwenRequest(prompt, referenceSet.references, existingFrame)
              : undefined;
            if (modelOption.requiresSourceImage && !qwenRequest?.referenceImages.length) {
              throw new Error('Qwen Image Edit needs an existing storyboard frame or a linked Element image to use as its source.');
            }
            const generationPrompt = qwenRequest?.prompt
              ?? storyboardPromptWithoutImageReferences(prompt);
            const priorJobId = currentPlan.saved?.jobId?.trim();
            const priorError = currentPlan.saved?.error?.toLowerCase() ?? '';
            const resumeJobId = priorJobId && (
              currentPlan.saved?.status === 'generating'
              || priorError.includes('invalid image-generation task')
              || priorError.includes('still working')
              || priorError.includes('could not read the result')
              || priorError.includes('proxy read timeout')
            ) ? priorJobId : undefined;
            return await generateSessionImageAndWait({
              model: modelOption.sessionModel,
              prompt: generationPrompt,
              width: dimensions.width,
              height: dimensions.height,
              ...(qwenRequest?.referenceImages.length
                ? { referenceImages: qwenRequest.referenceImages }
                : {}),
            }, {
              ...(resumeJobId ? { resumeJobId } : {}),
              onJobId: (jobId) => {
                const latest = storyboardPlan(showRef.current).find((frame) => frame.id === frameId) ?? currentPlan;
                setShow(upsertStoryboardFrame(showRef.current, latest, {
                  prompt,
                  status: 'generating',
                  jobId,
                  error: undefined,
                }));
              },
            });
          })()
        : await (async () => {
            const generationPrompt = storyboardPromptWithReferences(prompt, referenceSet.references);
            const inputs: Record<string, unknown> = {
              prompt: generationPrompt,
              aspect_ratio: showRef.current.aspectRatio,
              resolution: '2k',
              ...(referenceUrls.length > 0 ? { input_images: referenceUrls } : {}),
            };
            return await runStoryboardWithRetry(() => runWorkflow({
              nodeId: `storyboard-${currentPlan.id}`,
              nodeType: modelId === HIGGSFIELD_MODELS.gptImage ? 'hf-gpt-image-2' : 'hf-nano-banana-pro',
              modelId,
              outputType: 'image',
              inputs,
            }));
          })();
      const url = storyboardResultUrl(result);
      if (!url) throw new Error(`${modelOption.provider === 'runpod' ? 'RunPod' : 'Higgsfield'} finished but returned no storyboard image.`);

      const latestPlan = storyboardPlan(showRef.current).find((frame) => frame.id === frameId) ?? currentPlan;
      const clipLabel = latestPlan.clipLabel;
      const planned = planDirectorFolders({
        folders: foldersRef.current,
        scene: latestPlan.scene,
        clip: latestPlan.clip,
        variantKey: `storyboard-${latestPlan.beat.n}`,
        clipLabel,
      });
      foldersRef.current = [...foldersRef.current, ...planned.foldersToAdd];
      for (const folder of planned.foldersToAdd) dispatch({ type: 'ADD_FOLDER', folder });
      for (const folder of planned.foldersToRename) {
        foldersRef.current = foldersRef.current.map((entry) => (
          entry.id === folder.id ? { ...entry, ...folder } : entry
        ));
        dispatch({ type: 'UPDATE_FOLDER', folder });
      }
      const asset: Asset = {
        id: generateId(),
        name: `${clipLabel} · S${latestPlan.beat.n} storyboard`,
        type: 'image',
        url,
        sourceUrl: url,
        thumbnailUrl: url,
        createdAt: timestamp(),
        folderId: planned.clipId,
        metadata: {
          generatedVia: 'director-storyboard',
          generationProvider: modelOption.provider,
          generationModel: result && typeof result === 'object' && 'model' in result && typeof result.model === 'string'
            ? result.model
            : modelOption.shortLabel,
          directorSceneId: latestPlan.scene.id,
          directorClipId: latestPlan.clip.id,
          directorBeatN: latestPlan.beat.n,
          storyboardFrameId: latestPlan.id,
          ...(modelOption.provider === 'higgsfield'
            ? { higgsfieldModel: modelId }
            : { runpodSessionModel: modelOption.sessionModel }),
          storyboardReferenceIds: referenceSet.references.map((reference) => reference.id),
          storyboardReferenceNames: referenceSet.references.map((reference) => reference.name),
        },
      };
      dispatch({ type: 'ADD_ASSET', asset });
      setShow(upsertStoryboardFrame(showRef.current, latestPlan, {
        prompt,
        modelId,
        status: 'ready',
        imageUrl: url,
        assetId: asset.id,
        jobId: result && typeof result === 'object' && 'jobId' in result && typeof result.jobId === 'string'
          ? result.jobId
          : undefined,
        error: undefined,
        generatedAt: timestamp(),
        generatedSourceHash: latestPlan.sourceHash,
        generatedPrompt: prompt,
      }));
    } catch (error) {
      const latestPlan = storyboardPlan(showRef.current).find((frame) => frame.id === frameId) ?? currentPlan;
      setShow(upsertStoryboardFrame(showRef.current, latestPlan, {
        prompt,
        status: 'failed',
        error: storyboardGenerationErrorMessage(error, modelOption.provider),
      }));
    }
  }, [dispatch, setShow]);

  const runStoryboard = useCallback((frameIds: string[]) => {
    const queue = [...new Set(frameIds)];
    if (queue.length === 0) return;
    const modelId = showRef.current.storyboardModelId ?? HIGGSFIELD_MODELS.nanoBanana;
    const provider = storyboardModelOption(modelId).provider;
    const workerCount = provider === 'runpod' ? 1 : Math.min(2, queue.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (queue.length > 0) {
        const frameId = queue.shift();
        if (frameId) await generateStoryboardFrame(frameId, modelId);
      }
    });
    void Promise.all(workers);
  }, [generateStoryboardFrame]);

  const recoverLiveTakes = useCallback(async () => {
    if (!window.electronAPI?.higgsfield?.generate || recoverInFlight.current) return;
    if (directorJobIsRunning(showRef.current, 'generate')) return;
    const live: Array<{ clipId: string; take: (typeof showRef.current.clips)[number]['takes'][number] }> = [];
    for (const clip of showRef.current.clips) {
      for (const take of clip.takes) {
        if (getDirectorAdapter(take.adapterId).provider !== 'higgsfield') continue;
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

  useEffect(() => {
    if (show.mode !== 'generate') return;
    const clip = selectedClip(show);
    const staging = clip?.staging;
    if (!clip || !staging || staging.diagramUrl) return;
    if (staging.status !== 'failed') return;
    if (stagingRecovered.current.has(clip.id)) return;
    stagingRecovered.current.add(clip.id);
    void fetchStagingDiagram();
  }, [fetchStagingDiagram, show.mode, show.selectedClipId, show]);

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
      storyboardFrames: [],
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
              {tab.id === 'storyboard' && storyboardFrameCount > 0 && <span className="director-tab__stab-badge">{storyboardFrameCount}</span>}
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
          <DirectorShotlistTab show={show} elements={state.elements} sceneFilter={sceneFilter} expandRequest={expandRequest} syncing={cascade.running} onChange={setShow} onShotlist={startManualShotlist} onStopShotlist={stopShotlist} onSceneNotes={(sceneId, notes) => runSceneNotes(sceneId, notes)} onClipNotes={(clipId, notes) => runClipNotes(clipId, notes)} onReshotBeat={(clipId, beatN) => void runReshotBeat(clipId, beatN)} onReshotClip={(clipId) => void runReshotClip(clipId)} onSelectClip={selectClip} />
        )}
        {show.mode === 'storyboard' && (
          <DirectorStoryboardTab
            show={show}
            assets={state.assets}
            elements={state.elements}
            sceneFilter={sceneFilter}
            expandRequest={expandRequest}
            higgsfieldReady={higgsfieldReady}
            runpodReady={runpodStoryboardSession.ready}
            runpodImageModels={runpodStoryboardSession.models}
            onChange={setShow}
            onGenerate={runStoryboard}
          />
        )}
        {show.mode === 'generate' && (
          <DirectorGenerateTab
            show={show} assets={state.assets} preflight={preflight} warnings={warnings}
            selectedBeatN={selectedBeatN} onSelectBeat={setSelectedBeatN}
            onChange={setShow}
            onGenerate={(scope) => void runGenerate(scope)}
            onFetchTake={() => void fetchLiveTake()}
            fetchingTake={fetchingTake}
            onClipNotes={(notes) => {
              const current = selectedClip(showRef.current);
              return current ? runClipNotes(current.id, notes) : Promise.resolve(false);
            }}
            onRemoveAsset={(assetId) => dispatch({ type: 'REMOVE_ASSET', assetId })}
            onSetStagingFrame={(source) => void setStagingFrame(source)}
            onMakeStagingDiagram={() => void makeStagingDiagram()}
            onFetchStagingDiagram={() => void fetchStagingDiagram()}
            onKeepStagingFraming={keepStagingFraming}
            onCancelStagingDiagram={cancelStagingDiagram}
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
