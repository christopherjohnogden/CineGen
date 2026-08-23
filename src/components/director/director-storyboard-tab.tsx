import { useEffect, useMemo, useState } from 'react';
import type { Asset } from '@/types/project';
import type { Element } from '@/types/elements';
import type { DirectorShow, DirectorStoryboardModelId } from '@/types/director';
import { CustomSelect } from '@/components/ui/custom-select';
import {
  STORYBOARD_MODELS,
  storyboardModelLabel,
  storyboardPlan,
  storyboardReferences,
  upsertStoryboardFrame,
  type StoryboardPlanFrame,
} from '@/lib/director/storyboard';

interface DirectorStoryboardTabProps {
  show: DirectorShow;
  assets: Asset[];
  elements: Element[];
  sceneFilter: string | null;
  expandRequest: { clipId: string; n: number } | null;
  higgsfieldReady: boolean;
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
  onChange,
  onGenerate,
}: DirectorStoryboardTabProps) {
  const plan = useMemo(() => storyboardPlan(show), [show]);
  const [openPromptIds, setOpenPromptIds] = useState<Set<string>>(new Set());
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

  const imageFor = (frame: StoryboardPlanFrame): string | undefined => {
    const asset = frame.saved?.assetId ? assetById.get(frame.saved.assetId) : undefined;
    return asset?.thumbnailUrl || asset?.url || frame.saved?.imageUrl;
  };

  const generatedVisible = visible.filter((frame) => Boolean(imageFor(frame)));
  const viewerIndex = generatedVisible.findIndex((frame) => frame.id === viewerId);
  const viewer = viewerIndex >= 0 ? generatedVisible[viewerIndex] : undefined;

  function stepViewer(delta: number) {
    if (generatedVisible.length === 0) return;
    const current = generatedVisible.findIndex((frame) => frame.id === viewerId);
    const next = (Math.max(0, current) + delta + generatedVisible.length) % generatedVisible.length;
    setViewerId(generatedVisible[next].id);
  }

  const togglePrompt = (id: string) => {
    setOpenPromptIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
        <div className="dstory-head__controls">
          <label className="dstory-model">
            <span className="director-tab__label">Image model</span>
            <CustomSelect
              value={selectedModel}
              options={STORYBOARD_MODELS.map(({ value, label }) => ({ value, label }))}
              onChange={(value) => onChange({ ...show, storyboardModelId: value as DirectorStoryboardModelId })}
              className="dstory-model__select"
            />
          </label>
          <div className="dstory-provider">
            <span className={`dstory-provider__dot${higgsfieldReady ? ' dstory-provider__dot--on' : ''}`} />
            {higgsfieldReady ? 'Higgsfield connected' : 'Higgsfield or owner funding'}
          </div>
          <button
            type="button"
            className={`director-tab__btn director-tab__btn--accent${generatingCount ? ' director-tab__btn--busy' : ''}`}
            disabled={needsGeneration.length === 0 || generatingCount > 0}
            onClick={() => setConfirmBatch(true)}
          >
            {generatingCount > 0 ? `Rendering ${generatingCount}` : needsGeneration.length > 0 ? `Generate ${needsGeneration.length} frames` : 'Storyboard complete'}
          </button>
        </div>
      </header>

      {confirmBatch && (
        <div className="dstory-confirm" role="alertdialog" aria-labelledby="dstory-confirm-title">
          <div>
            <strong id="dstory-confirm-title">Generate {needsGeneration.length} storyboard frames?</strong>
            <span>Higgsfield will render each missing or outdated frame with {storyboardModelLabel(selectedModel)}.</span>
          </div>
          <div className="dstory-confirm__actions">
            <button type="button" className="director-tab__btn" onClick={() => setConfirmBatch(false)}>Cancel</button>
            <button type="button" className="director-tab__btn director-tab__btn--accent" onClick={() => {
              setConfirmBatch(false);
              onGenerate(needsGeneration.map((frame) => frame.id));
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
                          const image = imageFor(frame);
                          const promptOpen = openPromptIds.has(frame.id);
                          const working = saved?.status === 'generating';
                          const referenceSet = referencesByClipId.get(frame.clip.id) ?? { references: [], missingElementTags: [] };
                          const elementReferences = referenceSet.references.filter((reference) => reference.source === 'element');
                          const lookReferences = referenceSet.references.filter((reference) => reference.source === 'look-bible');
                          return (
                            <div key={frame.id} className={`dstory-card${frame.stale ? ' dstory-card--stale' : ''}`} style={{ '--story-index': index } as React.CSSProperties}>
                              <div className="dstory-card__visual" style={{ aspectRatio: show.aspectRatio.replace(':', ' / ') }}>
                                {image ? (
                                  <button type="button" className="dstory-card__image" onClick={() => setViewerId(frame.id)} aria-label={`Open ${frame.clipLabel} shot ${frame.beat.n}`}>
                                    <img src={image} alt={`${frame.clipLabel} shot ${frame.beat.n}: ${frame.beat.text}`} />
                                  </button>
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
                                <div className="dstory-card__actions">
                                  <button type="button" onClick={() => togglePrompt(frame.id)}>{promptOpen ? 'Close prompt' : 'Edit prompt'}</button>
                                  <button type="button" disabled={working} onClick={() => onGenerate([frame.id])}>{image ? 'Regenerate' : working ? 'Rendering' : 'Generate'}</button>
                                </div>
                                {promptOpen && (
                                  <div className="dstory-prompt">
                                    <label htmlFor={`dstory-prompt-${frame.id}`}>Storyboard prompt</label>
                                    <textarea id={`dstory-prompt-${frame.id}`} value={frame.prompt} onChange={(event) => updatePrompt(frame, event.target.value)} />
                                    {saved?.customPrompt && (
                                      <button type="button" onClick={() => updatePrompt(frame, frame.derivedPrompt, false)}>Use shotlist wording</button>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
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

      {viewer && (
        <div className="dstory-viewer" role="dialog" aria-modal="true" aria-label={`${viewer.clipLabel} shot ${viewer.beat.n}`} onMouseDown={(event) => {
          if (event.target === event.currentTarget) setViewerId(null);
        }}>
          <div className="dstory-viewer__frame">
            <img src={imageFor(viewer)} alt={`${viewer.clipLabel} shot ${viewer.beat.n}: ${viewer.beat.text}`} />
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
