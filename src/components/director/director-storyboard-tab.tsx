import { useEffect, useMemo, useState } from 'react';
import type { Asset } from '@/types/project';
import type { Element } from '@/types/elements';
import type { DirectorShow, DirectorStoryboardModelId } from '@/types/director';
import { CustomSelect } from '@/components/ui/custom-select';
import {
  STORYBOARD_MODELS,
  storyboardModelLabel,
  storyboardModelOption,
  storyboardPlan,
  storyboardReferences,
  upsertStoryboardFrame,
  type StoryboardPlanFrame,
} from '@/lib/director/storyboard';
import { toFileUrl } from '@/lib/utils/file-url';

interface DirectorStoryboardTabProps {
  show: DirectorShow;
  assets: Asset[];
  elements: Element[];
  sceneFilter: string | null;
  expandRequest: { clipId: string; n: number } | null;
  higgsfieldReady: boolean;
  runpodReady: boolean;
  runpodImageModels: readonly string[];
  onChange: (show: DirectorShow) => void;
  onGenerate: (frameIds: string[]) => void;
}

export function DirectorStoryboardTab({
  show,
  assets,
  elements,
  sceneFilter,
  expandRequest,
  higgsfieldReady,
  runpodReady,
  runpodImageModels,
  onChange,
  onGenerate,
}: DirectorStoryboardTabProps) {
  const plan = useMemo(() => storyboardPlan(show), [show]);
  const [inspectorId, setInspectorId] = useState<string | null>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [confirmBatch, setConfirmBatch] = useState(false);
  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const referencesByClipId = useMemo(() => new Map(
    show.clips.map((clip) => [clip.id, storyboardReferences(show, clip, elements)]),
  ), [elements, show]);
  const visible = sceneFilter && show.scenes.some((scene) => scene.id === sceneFilter)
    ? plan.filter((frame) => frame.scene.id === sceneFilter)
    : plan;
  const readyCount = plan.filter((frame) => Boolean(frame.saved?.imageUrl)).length;
  const generatingCount = plan.filter((frame) => frame.saved?.status === 'generating').length;
  const needsGeneration = plan.filter((frame) => !frame.saved?.imageUrl || frame.stale);
  const selectedModel = show.storyboardModelId ?? 'nano_banana_2';
  const selectedModelOption = storyboardModelOption(selectedModel);
  const selectedModelReady = selectedModelOption.provider === 'runpod'
    ? runpodReady && Boolean(selectedModelOption.sessionModel && runpodImageModels.includes(selectedModelOption.sessionModel))
    : true;
  const providerStatus = selectedModelOption.provider === 'runpod'
    ? selectedModelReady
      ? `${storyboardModelLabel(selectedModel)} ready on this RunPod session`
      : runpodReady
        ? `${storyboardModelLabel(selectedModel)} was not included in this session`
        : 'Start a RunPod Generation Session in Settings'
    : higgsfieldReady ? 'Higgsfield connected' : 'Higgsfield or owner funding';
  const providerConnected = selectedModelOption.provider === 'runpod' ? selectedModelReady : higgsfieldReady;
  const providerLabel = selectedModelOption.provider === 'runpod' ? 'RunPod Session' : 'Higgsfield';

  useEffect(() => {
    if (!expandRequest || show.mode !== 'storyboard') return;
    requestAnimationFrame(() => {
      document.querySelector(`[data-storyboard-clip="${expandRequest.clipId}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [expandRequest, show.mode]);

  useEffect(() => {
    if (!viewerId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setViewerId(null);
      if (event.key === 'ArrowLeft') stepViewer(-1);
      if (event.key === 'ArrowRight') stepViewer(1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const imageSourcesFor = (frame: StoryboardPlanFrame): string[] => {
    const asset = frame.saved?.assetId ? assetById.get(frame.saved.assetId) : undefined;
    return [...new Set([
      asset?.fileRef,
      asset?.thumbnailUrl,
      asset?.url,
      asset?.sourceUrl,
      frame.saved?.imageUrl,
    ].map(toFileUrl).filter(Boolean))];
  };

  const imageFor = (frame: StoryboardPlanFrame): string | undefined => imageSourcesFor(frame)[0];

  const frameHasRequiredSource = (frame: StoryboardPlanFrame): boolean => (
    !selectedModelOption.requiresSourceImage
    || Boolean(imageFor(frame))
    || (referencesByClipId.get(frame.clip.id)?.references.length ?? 0) > 0
  );
  const canGenerateFrame = (frame: StoryboardPlanFrame): boolean => selectedModelReady && frameHasRequiredSource(frame);
  const sourceEligibleNeeds = needsGeneration.filter(frameHasRequiredSource);
  const generatableNeeds = selectedModelReady ? sourceEligibleNeeds : [];
  const sourceBlockedCount = selectedModelOption.requiresSourceImage
    ? needsGeneration.length - sourceEligibleNeeds.length
    : 0;

  const generatedVisible = visible.filter((frame) => Boolean(imageFor(frame)));
  const viewerIndex = generatedVisible.findIndex((frame) => frame.id === viewerId);
  const viewer = viewerIndex >= 0 ? generatedVisible[viewerIndex] : undefined;
  const inspectorIndex = visible.findIndex((frame) => frame.id === inspectorId);
  const inspector = inspectorIndex >= 0 ? visible[inspectorIndex] : undefined;
  const inspectorReferences = inspector
    ? referencesByClipId.get(inspector.clip.id) ?? { references: [], missingElementTags: [] }
    : { references: [], missingElementTags: [] };
  const inspectorImage = inspector ? imageFor(inspector) : undefined;

  function stepViewer(delta: number) {
    if (generatedVisible.length === 0) return;
    const current = generatedVisible.findIndex((frame) => frame.id === viewerId);
    const next = (Math.max(0, current) + delta + generatedVisible.length) % generatedVisible.length;
    setViewerId(generatedVisible[next].id);
  }

  useEffect(() => {
    if (!inspectorId || viewerId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setInspectorId(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [inspectorId, viewerId]);

  useEffect(() => {
    if (inspectorId && !plan.some((frame) => frame.id === inspectorId)) setInspectorId(null);
  }, [inspectorId, plan]);

  function stepInspector(delta: number) {
    if (visible.length === 0) return;
    const current = visible.findIndex((frame) => frame.id === inspectorId);
    const next = (Math.max(0, current) + delta + visible.length) % visible.length;
    setInspectorId(visible[next].id);
  }

  const updatePrompt = (frame: StoryboardPlanFrame, prompt: string, customPrompt = true) => {
    onChange(upsertStoryboardFrame(show, frame, { prompt, customPrompt }));
  };

  if (plan.length === 0) {
    return (
      <div className="director-tab__stage dstory-stage">
        <div className="dstory-empty">
          <div className="dstory-empty__aperture" aria-hidden><span /></div>
          <span className="director-tab__label">Storyboard</span>
          <h2>Shotlist first, then see the film</h2>
          <p>Every numbered multishot becomes one storyboard frame, organized inside its scene and clip.</p>
          <button type="button" className="director-tab__btn director-tab__btn--accent" onClick={() => onChange({ ...show, mode: 'shotlist' })}>
            Go to Shotlist
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="director-tab__stage dstory-stage">
      <div className={`dstory-route dstory-route--${selectedModelOption.provider}`} aria-label="Storyboard image renderer">
        <div className="dstory-route__identity">
          <span className="dstory-route__eyebrow">Storyboard image renderer</span>
          <div className="dstory-route__title">
            <strong>{providerLabel}</strong>
            <span aria-hidden>→</span>
            <span>{storyboardModelLabel(selectedModel)}</span>
          </div>
          <div className="dstory-provider" role="status" aria-live="polite">
            <span className={`dstory-provider__dot${providerConnected ? ' dstory-provider__dot--on' : ''}`} />
            {providerStatus}{sourceBlockedCount > 0 ? ` · ${sourceBlockedCount} frame${sourceBlockedCount === 1 ? '' : 's'} need a source` : ''}
          </div>
        </div>
        <label className="dstory-model">
          <span className="director-tab__label">Provider &amp; model</span>
          <CustomSelect
            value={selectedModel}
            options={STORYBOARD_MODELS.map(({ value, label }) => ({ value, label }))}
            onChange={(value) => onChange({ ...show, storyboardModelId: value as DirectorStoryboardModelId })}
            className="dstory-model__select"
            disabled={generatingCount > 0}
          />
        </label>
        <button
          type="button"
          className={`director-tab__btn director-tab__btn--accent${generatingCount ? ' director-tab__btn--busy' : ''}`}
          disabled={generatableNeeds.length === 0 || generatingCount > 0}
          onClick={() => setConfirmBatch(true)}
        >
          {generatingCount > 0
            ? `Rendering ${generatingCount}`
            : generatableNeeds.length > 0
              ? `Generate ${generatableNeeds.length} frames`
              : needsGeneration.length > 0
                ? selectedModelReady ? 'Source image needed' : 'Session not ready'
                : 'Storyboard complete'}
        </button>
      </div>

      <header className="dstory-head">
        <div className="dstory-head__copy">
          <span className="director-tab__label">Previsualization desk</span>
          <h2>Preview the finished film, frame by frame</h2>
          <p>{plan.length} live-action frames across {show.scenes.length} scenes. Every frame uses the shot's camera language, linked Elements, and Look Bible.</p>
          <div className="dstory-progress" aria-label={`${readyCount} of ${plan.length} storyboard frames ready`}>
            <span style={{ transform: `scaleX(${plan.length > 0 ? readyCount / plan.length : 0})` }} />
          </div>
          <span className="dstory-progress__label">
            {readyCount} ready · {plan.length - readyCount} remaining{generatingCount ? ` · ${generatingCount} rendering` : ''}
          </span>
        </div>
      </header>

      {confirmBatch && (
        <div className="dstory-confirm" role="alertdialog" aria-labelledby="dstory-confirm-title">
          <div>
            <strong id="dstory-confirm-title">Generate {generatableNeeds.length} storyboard frames?</strong>
            <span>
              {selectedModelOption.provider === 'runpod' ? 'Your shared RunPod session' : 'Higgsfield'} will render each missing or outdated frame with {storyboardModelLabel(selectedModel)}.
              {selectedModelOption.requiresSourceImage ? ' Qwen uses the existing frame or first linked reference as its edit source.' : ''}
            </span>
          </div>
          <div className="dstory-confirm__actions">
            <button type="button" className="director-tab__btn" onClick={() => setConfirmBatch(false)}>Cancel</button>
            <button type="button" className="director-tab__btn director-tab__btn--accent" onClick={() => {
              setConfirmBatch(false);
              onGenerate(generatableNeeds.map((frame) => frame.id));
            }}>Start storyboard</button>
          </div>
        </div>
      )}

      <div className="dstory-scenes">
        {show.scenes.filter((scene) => visible.some((frame) => frame.scene.id === scene.id)).map((scene) => {
          const sceneFrames = visible.filter((frame) => frame.scene.id === scene.id);
          const sceneReady = sceneFrames.filter((frame) => Boolean(imageFor(frame))).length;
          return (
            <section key={scene.id} className="dstory-scene">
              <div className="dstory-scene__head">
                <div>
                  <span className="dstory-scene__number">Scene {scene.number}</span>
                  <h3>{scene.label}</h3>
                </div>
                <span className="dstory-scene__count">{sceneReady}/{sceneFrames.length} frames</span>
              </div>
              <div className="dstory-clips">
                {show.clips.filter((clip) => clip.sceneId === scene.id && !clip.altOf).map((clip) => {
                  const clipFrames = sceneFrames.filter((frame) => frame.clip.id === clip.id);
                  if (clipFrames.length === 0) return null;
                  return (
                    <article key={clip.id} className="dstory-clip" data-storyboard-clip={clip.id}>
                      <div className="dstory-clip__head">
                        <div className="dstory-clip__title">
                          <span>{clipFrames[0].clipLabel}</span>
                          <h4>{clip.title}</h4>
                        </div>
                        <span>{clipFrames.length} shot{clipFrames.length === 1 ? '' : 's'} · {clip.seconds}s</span>
                      </div>
                      <div className="dstory-grid">
                        {clipFrames.map((frame, index) => {
                          const saved = frame.saved;
                          const imageSources = imageSourcesFor(frame);
                          const image = imageSources[0];
                          const working = saved?.status === 'generating';
                          const rendererModel = (image || working) && saved?.modelId ? saved.modelId : selectedModel;
                          const rendererOption = storyboardModelOption(rendererModel);
                          const rendererProvider = rendererOption.provider === 'runpod' ? 'RunPod Session' : 'Higgsfield';
                          const referenceSet = referencesByClipId.get(frame.clip.id) ?? { references: [], missingElementTags: [] };
                          const elementReferences = referenceSet.references.filter((reference) => reference.source === 'element');
                          const lookReferences = referenceSet.references.filter((reference) => reference.source === 'look-bible');
                          return (
                            <article key={frame.id} className={`dstory-card${frame.stale ? ' dstory-card--stale' : ''}${frame.id === inspectorId ? ' dstory-card--selected' : ''}`} style={{ '--story-index': index } as React.CSSProperties}>
                              <button
                                type="button"
                                className="dstory-card__open"
                                onClick={() => setInspectorId(frame.id)}
                                aria-label={`Open prompt for ${frame.clipLabel} shot ${frame.beat.n}`}
                              />
                              <div className="dstory-card__visual" style={{ aspectRatio: show.aspectRatio.replace(':', ' / ') }}>
                                {image ? (
                                  <div className="dstory-card__image">
                                    <StoryboardImage sources={imageSources} alt={`${frame.clipLabel} shot ${frame.beat.n}: ${frame.beat.text}`} />
                                  </div>
                                ) : working ? (
                                  <div className="dstory-card__skeleton" aria-label="Rendering storyboard frame"><span /><span /><span /></div>
                                ) : (
                                  <div className="dstory-card__blank" aria-hidden>
                                    <span className="dstory-card__reticle" />
                                    <span>Frame {frame.beat.n}</span>
                                  </div>
                                )}
                                <div className="dstory-card__slate">
                                  <span>{frame.clipLabel}.{frame.beat.n}</span>
                                  <span>{frame.beat.from}–{frame.beat.to}</span>
                                </div>
                                {frame.stale && <span className="dstory-card__flag">Outdated</span>}
                                {saved?.status === 'failed' && <span className="dstory-card__flag dstory-card__flag--error">Needs retry</span>}
                              </div>
                              <div className="dstory-card__body">
                                <strong>{frame.beat.cam || frame.beat.framing || `Shot ${frame.beat.n}`}</strong>
                                <p>{frame.beat.text.replace(/\s*Hard cut\.\s*$/i, '')}</p>
                                <div className="dstory-refs">
                                  <div className="dstory-refs__summary">
                                    <span>Reference lock</span>
                                    <strong>
                                      {elementReferences.length > 0 ? `${elementReferences.length} Element${elementReferences.length === 1 ? '' : 's'}` : 'No linked Elements'}
                                      {lookReferences.length > 0 ? ` · ${lookReferences.length} Look` : ''}
                                    </strong>
                                  </div>
                                  {referenceSet.references.length > 0 && (
                                    <div className="dstory-refs__images">
                                      {referenceSet.references.slice(0, 5).map((reference) => (
                                        <span key={`${reference.source}-${reference.id}`} title={`${reference.source === 'element' ? 'Element' : 'Look Bible'}: ${reference.name}`}>
                                          <img src={reference.url} alt={`${reference.name} reference`} />
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                  {referenceSet.missingElementTags.length > 0 && (
                                    <span className="dstory-refs__missing">
                                      Add images for {referenceSet.missingElementTags.join(', ')} to lock their appearance.
                                    </span>
                                  )}
                                </div>
                                {saved?.error && <span className="dstory-card__error">{saved.error}</span>}
                                <div className="dstory-card__renderer">
                                  <span>{image ? 'Frame model' : working ? 'Rendering with' : 'Next render'}</span>
                                  <strong>{rendererProvider} · {storyboardModelLabel(rendererModel)}</strong>
                                </div>
                                <div className="dstory-card__actions">
                                  <button type="button" disabled={working || !canGenerateFrame(frame)} onClick={() => onGenerate([frame.id])}>
                                    {image ? 'Regenerate' : working ? 'Rendering' : selectedModelOption.requiresSourceImage && !canGenerateFrame(frame) ? 'Source needed' : 'Generate'}
                                  </button>
                                </div>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {inspector && (
        <aside className="dstory-inspector" aria-labelledby="dstory-inspector-title">
          <header className="dstory-inspector__head">
            <div>
              <span className="dstory-inspector__eyebrow">Scene {inspector.scene.number} · {inspector.clipLabel}.{inspector.beat.n}</span>
              <h2 id="dstory-inspector-title">Shot prompt</h2>
            </div>
            <button type="button" className="dstory-inspector__close" onClick={() => setInspectorId(null)} aria-label="Close shot prompt">Close</button>
          </header>

          <div className="dstory-inspector__scroll">
            <button
              type="button"
              className="dstory-inspector__preview"
              style={{ aspectRatio: show.aspectRatio.replace(':', ' / ') }}
              disabled={!inspectorImage}
              onClick={() => setViewerId(inspector.id)}
              aria-label={inspectorImage ? `View ${inspector.clipLabel} shot ${inspector.beat.n} full screen` : 'Storyboard frame has not been generated'}
            >
              {inspectorImage ? (
                <StoryboardImage sources={imageSourcesFor(inspector)} alt={`${inspector.clipLabel} shot ${inspector.beat.n}`} />
              ) : (
                <div className="dstory-card__blank" aria-hidden><span className="dstory-card__reticle" /><span>Frame {inspector.beat.n}</span></div>
              )}
              <div className="dstory-card__slate">
                <span>{inspector.clipLabel}.{inspector.beat.n}</span>
                <span>{inspector.beat.from}–{inspector.beat.to}</span>
              </div>
            </button>

            <section className="dstory-inspector__shot">
              <span>Camera</span>
              <strong>{inspector.beat.cam || inspector.beat.framing || `Shot ${inspector.beat.n}`}</strong>
              <p>{inspector.beat.text.replace(/\s*Hard cut\.\s*$/i, '')}</p>
            </section>

            <label className="dstory-inspector__prompt" htmlFor={`dstory-inspector-prompt-${inspector.id}`}>
              <span>Generation prompt</span>
              <textarea
                id={`dstory-inspector-prompt-${inspector.id}`}
                value={inspector.prompt}
                onChange={(event) => updatePrompt(inspector, event.target.value)}
              />
              <small>{inspector.prompt.trim().split(/\s+/).filter(Boolean).length} words · Next render: {providerLabel} · {storyboardModelLabel(selectedModel)}</small>
            </label>

            <section className="dstory-inspector__references">
              <div className="dstory-inspector__section-head">
                <span>Reference lock</span>
                <strong>{inspectorReferences.references.length} supplied</strong>
              </div>
              {inspectorReferences.references.length > 0 ? (
                <div className="dstory-inspector__reference-grid">
                  {inspectorReferences.references.map((reference) => (
                    <div key={`${reference.source}-${reference.id}`}>
                      <img src={reference.url} alt={`${reference.name} reference`} />
                      <span>{reference.name}</span>
                      <small>{reference.source === 'element' ? reference.type : 'Look Bible'}</small>
                    </div>
                  ))}
                </div>
              ) : <p>No Element or Look Bible images are linked to this shot.</p>}
              {inspectorReferences.missingElementTags.length > 0 && (
                <p className="dstory-inspector__missing">Missing images: {inspectorReferences.missingElementTags.join(', ')}</p>
              )}
            </section>
          </div>

          <footer className="dstory-inspector__foot">
            <div className="dstory-inspector__nav" aria-label="Browse shot prompts">
              <button type="button" onClick={() => stepInspector(-1)}>Previous</button>
              <span>{inspectorIndex + 1} / {visible.length}</span>
              <button type="button" onClick={() => stepInspector(1)}>Next</button>
            </div>
            <div className="dstory-inspector__actions">
              <button type="button" disabled={!inspector.saved?.customPrompt} onClick={() => updatePrompt(inspector, inspector.derivedPrompt, false)}>Reset prompt</button>
              <button type="button" className="director-tab__btn director-tab__btn--accent" disabled={inspector.saved?.status === 'generating' || !canGenerateFrame(inspector)} onClick={() => onGenerate([inspector.id])}>
                {inspector.saved?.status === 'generating' ? 'Rendering' : inspectorImage ? 'Regenerate frame' : 'Generate frame'}
              </button>
            </div>
          </footer>
        </aside>
      )}

      {viewer && (
        <div className="dstory-viewer" role="dialog" aria-modal="true" aria-label={`${viewer.clipLabel} shot ${viewer.beat.n}`} onMouseDown={(event) => {
          if (event.target === event.currentTarget) setViewerId(null);
        }}>
          <div className="dstory-viewer__frame">
            <StoryboardImage sources={imageSourcesFor(viewer)} alt={`${viewer.clipLabel} shot ${viewer.beat.n}: ${viewer.beat.text}`} />
            <div className="dstory-viewer__caption">
              <div>
                <span>{viewer.clipLabel}.{viewer.beat.n} · Scene {viewer.scene.number}</span>
                <strong>{viewer.beat.cam || viewer.beat.framing || viewer.clip.title}</strong>
                <p>{viewer.beat.text.replace(/\s*Hard cut\.\s*$/i, '')}</p>
              </div>
              <span>{viewerIndex + 1} / {generatedVisible.length}</span>
            </div>
          </div>
          <button type="button" className="dstory-viewer__close" onClick={() => setViewerId(null)}>Close</button>
          {generatedVisible.length > 1 && (
            <>
              <button type="button" className="dstory-viewer__nav dstory-viewer__nav--prev" onClick={() => stepViewer(-1)}>Previous</button>
              <button type="button" className="dstory-viewer__nav dstory-viewer__nav--next" onClick={() => stepViewer(1)}>Next</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Try the durable project copy first, then fall back through thumbnails/provider URLs. */
function StoryboardImage({ sources, alt }: { sources: string[]; alt: string }) {
  const sourceKey = sources.join('\n');
  const [sourceIndex, setSourceIndex] = useState(0);

  useEffect(() => setSourceIndex(0), [sourceKey]);

  const source = sources[sourceIndex];
  if (!source) return null;
  return (
    <img
      src={source}
      alt={alt}
      onError={() => setSourceIndex((current) => current + 1)}
    />
  );
}
