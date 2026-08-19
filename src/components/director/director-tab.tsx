import { useCallback, useEffect, useRef, useState } from 'react';
import type { DirectorMode, DirectorShow } from '@/types/director';
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
import {
  findMatchingElement,
  itemsMissingElements,
  mergeBreakdownItems,
  parseBreakdownPayload,
} from '@/lib/director/breakdown';
import { mergeShotlist, parseShotlistPayload } from '@/lib/director/shotlist';
import { BREAKDOWN_IDENTIFY_SYSTEM_PROMPT, LOOK_BIBLE_SYSTEM_PROMPT, NOTES_REWRITE_SYSTEM_PROMPT, shotlistSystemPrompt } from '@/lib/director/llm-jobs';
import {
  breakdownJobInput,
  lookBibleJobInput,
  shotlistDensity,
  shotlistJobInput,
} from '@/lib/director/job-inputs';
import { applyWrittenLook } from '@/lib/director/look-bible';
import { ENRICH_CHARACTER_SYSTEM_PROMPT, buildEnrichInput, parseEnrichResult } from '@/lib/director/enrich';
import { parseDirectorLlmProvider, pickInstalledDirectorLlm } from '@/lib/director/cli-provider';
import { runDirectorJsonJob } from '@/lib/director/run-llm';
import { cancelCliCopilotChat } from '@/lib/llm/cli-copilot-client';
import { DirectorLlmPicker, type DirectorCliInfo } from './director-llm-picker';
import {
  CLI_LLM_PROVIDER_IDS,
  type CliLlmProviderId,
} from '@/lib/llm/claude-code-session';
import {
  appendDirectorTake,
  directorJobIsRunning,
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
  prepareDirectorGeneration,
  runtimeSeconds,
} from '@/lib/director/generate';
import { getDirectorAdapter } from '@/lib/director/video-adapter';
import { variantKey } from '@/lib/director/slate';
import { generateId, timestamp } from '@/lib/utils/ids';
import '@/styles/director-tab.css';

const EMPTY_CLI_PROVIDERS: Record<CliLlmProviderId, DirectorCliInfo> = {
  'claude-code': { id: 'claude-code', installed: false },
  codex: { id: 'codex', installed: false },
  gemini: { id: 'gemini', installed: false },
};

export function DirectorTab() {
  const { state, dispatch } = useWorkspace();
  const show = state.director ?? createEmptyDirectorShow();
  const showRef = useRef(show);
  const foldersRef = useRef(state.mediaFolders);
  const enrichingTags = useRef<Set<string>>(new Set());
  showRef.current = show;
  foldersRef.current = state.mediaFolders;

  const [selectedBeatN, setSelectedBeatN] = useState(1);
  const [preflight, setPreflight] = useState('Seedance 2.5');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [cliProviders, setCliProviders] = useState<Record<CliLlmProviderId, DirectorCliInfo>>(EMPTY_CLI_PROVIDERS);
  const [openDrawer, setOpenDrawer] = useState<'setup' | 'look' | null>(null);

  const TABS: { id: DirectorMode; label: string }[] = [
    { id: 'source', label: 'Script' },
    { id: 'breakdown', label: 'Breakdown' },
    { id: 'shotlist', label: 'Shotlist' },
    { id: 'generate', label: 'Generate' },
  ];

  const selectScene = (sceneId: string) => {
    const first = show.clips.find((row) => row.sceneId === sceneId);
    setShow({ ...show, selectedSceneId: sceneId, selectedClipId: first?.id ?? show.selectedClipId });
  };
  const selectClip = (sceneId: string, clipId: string) => {
    setShow({ ...show, selectedSceneId: sceneId, selectedClipId: clipId });
    const target = show.clips.find((row) => row.id === clipId);
    setSelectedBeatN(target?.beats[0]?.n ?? 1);
  };
  const nonAltClipCount = show.clips.filter((clip) => !clip.altOf).length;
  const withRail = show.mode === 'shotlist' || show.mode === 'generate';

  const setShow = useCallback((director: DirectorShow) => {
    dispatch({ type: 'SET_DIRECTOR', director });
  }, [dispatch]);

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
      const nextProvider = pickInstalledDirectorLlm(
        parseDirectorLlmProvider(showRef.current.llmProvider),
        providers,
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
    const clips = clipsForGenerateScope(show.clips, 'queued', show.selectedClipId, show.selectedSceneId);
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
      const result = generationPreflight({
        clipCount: clips.length || show.clips.filter((clip) => !clip.altOf).length,
        seconds: runtimeSeconds(clips.length ? clips : show.clips),
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
    const requestId = setJob('breakdown', 'Breaking down script…');
    try {
      const existing = state.elements.map((element) => `${element.type} ${element.name}`).join(', ');
      const scopeArg = scope === 'all' ? undefined : { sceneIds: scope.sceneIds };
      const payload = await runDirectorJsonJob(
        BREAKDOWN_IDENTIFY_SYSTEM_PROMPT,
        breakdownJobInput(current, existing, scopeArg),
        parseDirectorLlmProvider(current.llmProvider),
        requestId,
        signal,
      );
      if (signal?.aborted) return; // silent — a newer edit superseded this
      const parsed = parseBreakdownPayload(payload);
      setShow({
        ...current,
        breakdown: mergeBreakdownItems(current.breakdown, parsed.items, state.elements),
        scenes: parsed.scenes.length > 0 ? parsed.scenes : current.scenes,
        breakdownApproved: false,
        mode: current.mode, // do NOT force the tab to switch during an auto-run
        jobStatus: null,
        selectedSceneId: parsed.scenes[0]?.id ?? current.selectedSceneId,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      failJob('breakdown', error, 'Breakdown failed');
      throw error; // let the cascade know not to chain shotlist
    }
  }, [failJob, setJob, setShow, state.elements]);

  const linkMissingElements = useCallback((current: DirectorShow, approved: boolean): DirectorShow => {
    const missing = itemsMissingElements(current.breakdown, state.elements);
    const created = new Map<string, string>();
    for (const item of missing) {
      const element: Element = {
        id: generateId(),
        name: item.name,
        type: item.kind,
        description: [item.description, item.blurb].filter(Boolean).join('\n'),
        images: [],
        createdAt: timestamp(),
        updatedAt: timestamp(),
      };
      dispatch({ type: 'ADD_ELEMENT', element });
      created.set(item.id, element.id);
    }
    return {
      ...current,
      breakdownApproved: approved || current.breakdownApproved,
      mode: approved ? 'shotlist' : current.mode,
      breakdown: current.breakdown.map((item) => ({
        ...item,
        elementId: created.get(item.id) ?? item.elementId ?? findMatchingElement(state.elements, item)?.id,
      })),
    };
  }, [dispatch, state.elements]);

  const createMissing = useCallback(() => {
    setShow(linkMissingElements(showRef.current, false));
  }, [linkMissingElements, setShow]);

  const approveBreakdown = useCallback(() => {
    setShow(linkMissingElements(showRef.current, true));
  }, [linkMissingElements, setShow]);

  const runShotlist = useCallback(async (
    scope: { sceneIds: string[] } | 'all' = 'all',
    signal?: AbortSignal,
  ) => {
    const current = showRef.current;
    const sceneOnly = scope !== 'all';
    const scene = sceneOnly ? current.scenes.find((s) => scope.sceneIds.includes(s.id)) : selectedScene(current);
    const requestId = setJob('shotlist', sceneOnly ? `Shotlisting ${scene?.label ?? 'scene'}…` : 'Shotlisting show…');
    try {
      const payload = await runDirectorJsonJob(
        shotlistSystemPrompt(current.clipLengthSec, shotlistDensity(current)),
        shotlistJobInput(current, scene, sceneOnly),
        parseDirectorLlmProvider(current.llmProvider),
        requestId,
        signal,
      );
      if (signal?.aborted) return; // silent — a newer edit superseded this
      const parsed = parseShotlistPayload(payload, sceneOnly ? scene?.id : undefined);
      const merged = mergeShotlist(current.scenes, current.clips, parsed);
      setShow({
        ...current,
        stylePrefix: current.stylePrefix.trim()
          ? current.stylePrefix
          : (parsed.stylePrefix?.trim() ? parsed.stylePrefix : current.stylePrefix),
        scenes: merged.scenes,
        clips: merged.clips,
        mode: current.mode, // do NOT force the tab to switch during an auto-run
        jobStatus: parsed.errors[0] ? { type: 'shotlist', message: parsed.errors[0], error: true } : null,
        selectedClipId: merged.clips[0]?.id ?? current.selectedClipId,
        selectedSceneId: merged.clips[0]?.sceneId ?? current.selectedSceneId,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      failJob('shotlist', error, 'Shotlist failed');
      throw error; // let the cascade know not to chain
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

  const cascade = useDirectorCascade({
    show,
    autoSync: show.autoSync ?? true,
    runBreakdown,
    runShotlist,
    commitSyncState,
  });

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

  const generateOne = useCallback(async (clipId: string) => {
    const current = showRef.current;
    const clip = current.clips.find((entry) => entry.id === clipId);
    const scene = clip ? current.scenes.find((entry) => entry.id === clip.sceneId) : undefined;
    if (!clip || !scene) return;
    // Lazily fill in acting profiles/voices for this clip's characters (best-effort).
    const charTags = current.breakdown
      .filter((b) => b.kind === 'character' && clip.elementTags.includes(b.tag) && !b.enrichedAt && !b.actingProfile?.trim())
      .map((b) => b.tag);
    for (const tag of charTags) await enrichCharacter(tag);
    const fresh = showRef.current; // re-read after enrich commits
    const freshScene = fresh.scenes.find((entry) => entry.id === clip.sceneId) ?? scene;
    const prepared = prepareDirectorGeneration({
      show: fresh,
      scene: freshScene,
      clip,
      folders: foldersRef.current,
    });
    foldersRef.current = [...foldersRef.current, ...prepared.foldersToAdd];
    for (const folder of prepared.foldersToAdd) {
      dispatch({ type: 'ADD_FOLDER', folder });
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
      const result = await window.electronAPI.higgsfield.generate({
        prompt: prepared.request.prompt,
        model: prepared.request.modelId,
        outputType: 'video',
        params: prepared.request.params,
      });
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
      setShow(updateDirectorTake(showRef.current, clip.id, prepared.take.id, { status: 'done' }));
    } catch (error) {
      dispatch({
        type: 'UPDATE_ASSET',
        asset: {
          id: prepared.asset.id,
          name: `${prepared.asset.name} failed`,
          metadata: { generating: false, error: true, generatedVia: 'director' },
        },
      });
      setShow(updateDirectorTake(showRef.current, clip.id, prepared.take.id, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Generation failed',
      }));
    }
  }, [dispatch, setShow, enrichCharacter]);

  const runGenerate = useCallback(async (scope: 'active' | 'queued' | 'scene') => {
    const current = showRef.current;
    const targets = clipsForGenerateScope(current.clips, scope, current.selectedClipId, selectedScene(current)?.id);
    if (targets.length === 0) return;
    setShow({ ...current, mode: 'generate', jobStatus: { type: 'generate', message: `Generating ${targets.length} clip${targets.length === 1 ? '' : 's'}…` } });
    for (const clip of targets) {
      await generateOne(clip.id);
    }
    setShow({ ...showRef.current, jobStatus: null });
  }, [generateOne, setShow]);

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
    if (requestId) {
      void cancelCliCopilotChat(parseDirectorLlmProvider(current.llmProvider), requestId);
    }
    setShow({ ...current, jobStatus: { type: 'look-bible', message: 'Cancelled', error: true } });
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
        {show.jobStatus && <span className="director-tab__status">{show.jobStatus.message}</span>}
        <div className="director-tab__row" style={{ marginLeft: 'auto', alignItems: 'center' }}>
          <button type="button" className="director-tab__btn" onClick={() => setOpenDrawer((d) => d === 'setup' ? null : 'setup')}>⚙ Setup</button>
          <button type="button" className="director-tab__btn" onClick={() => setOpenDrawer((d) => d === 'look' ? null : 'look')}>🎨 Look bible</button>
          <label className="director-tab__autosync" title="Auto-run breakdown + shotlist after edits">
            <input type="checkbox" checked={show.autoSync ?? true}
              onChange={(e) => setShow({ ...show, autoSync: e.target.checked })} />
            <span>Auto-sync{cascade.running ? ' ·…' : cascade.dirty.length ? ` · ${cascade.dirty.length} stale` : ''}</span>
          </label>
          <DirectorLlmPicker
            provider={parseDirectorLlmProvider(show.llmProvider)}
            providers={cliProviders}
            onChange={(llmProvider) => setShow({ ...show, llmProvider })}
          />
        </div>
      </div>

      <div className={`director-tab__drawer${openDrawer === 'setup' ? ' director-tab__drawer--open' : ''}`}>
        <DirectorSetupDrawer show={show} onChange={setShow} />
      </div>
      <div className={`director-tab__drawer${openDrawer === 'look' ? ' director-tab__drawer--open' : ''}`}>
        <div className="director-tab__drawer-inner" style={{ maxWidth: 420 }}>
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
        {withRail && <DirectorStructureRail show={show} onSelectScene={selectScene} onSelectClip={selectClip} />}
        {show.mode === 'source' && (
          <DirectorScriptTab show={show} onChange={setShow} onBreakdown={() => void runBreakdown()} />
        )}
        {show.mode === 'breakdown' && (
          <DirectorBreakdownTab show={show} elements={state.elements} dirtyKeys={cascade.dirty} syncing={cascade.running} onChange={setShow} onApprove={approveBreakdown} onCreateMissing={createMissing} onOpenElements={() => dispatch({ type: 'SET_TAB', tab: 'elements' })} />
        )}
        {show.mode === 'shotlist' && (
          <DirectorShotlistTab show={show} onChange={setShow} onShotlist={(sceneOnly) => void runShotlist(sceneOnly ? { sceneIds: selectedScene(show) ? [selectedScene(show)!.id] : [] } : 'all')} onSelectClip={selectClip} />
        )}
        {show.mode === 'generate' && (
          <DirectorGenerateTab
            show={show} assets={state.assets} preflight={preflight} warnings={warnings}
            selectedBeatN={selectedBeatN} onSelectBeat={setSelectedBeatN}
            onChange={setShow}
            onGenerate={(scope) => void runGenerate(scope)}
            onRewrite={(notes) => void runRewrite(notes)}
            onKeepRewrite={() => { const current = selectedClip(show); if (current) setShow(keepPendingRewrite(show, current.id)); }}
            onDiscardRewrite={() => { const current = selectedClip(show); if (current) setShow(discardPendingRewrite(show, current.id)); }}
          />
        )}
      </div>
    </div>
  );
}
