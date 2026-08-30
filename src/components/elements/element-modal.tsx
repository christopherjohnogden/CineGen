import { useCallback, useMemo, useState } from 'react';
import type {
  Element,
  ElementImage,
  ElementType,
  ElementVariation,
  ElementVariationKind,
} from '@/types/elements';
import {
  createBaselineVariation,
  variationKindLabel,
} from '@/lib/elements/variations';
import { ElementImageUpload } from './element-image-upload';
import { ElementGenerate } from './element-generate';
import { ElementDescriptionAssistant } from './element-description-assistant';

const ELEMENT_TYPES: Array<{ id: ElementType; label: string; department: string; brief: string }> = [
  { id: 'character', label: 'Character', department: 'Casting', brief: 'Identity, performance presence, wardrobe and physical continuity.' },
  { id: 'location', label: 'Location', department: 'Locations', brief: 'Architecture, layout, dressing, weather and time-of-day states.' },
  { id: 'prop', label: 'Prop', department: 'Art department', brief: 'Hero object design, materials, handling details and condition changes.' },
  { id: 'vehicle', label: 'Vehicle', department: 'Picture vehicles', brief: 'Make, silhouette, interior, finish and damage continuity.' },
];

const VARIATION_KINDS: Array<{ id: ElementVariationKind; label: string; hint: string }> = [
  { id: 'wardrobe', label: 'Wardrobe', hint: 'New outfit, uniform or disguise' },
  { id: 'condition', label: 'Condition', hint: 'Damage, dirt, blood or wear' },
  { id: 'time', label: 'Time / Scene', hint: 'Age, season, weather or dressing' },
  { id: 'custom', label: 'Custom', hint: 'Another scripted continuity state' },
];

type ElementModalStep = 'brief' | 'reference' | 'continuity' | 'review';

const MODAL_STEPS: Array<{ id: ElementModalStep; number: string; label: string }> = [
  { id: 'brief', number: '01', label: 'Creative brief' },
  { id: 'reference', number: '02', label: 'Build reference' },
  { id: 'continuity', number: '03', label: 'Continuity looks' },
  { id: 'review', number: '04', label: 'Approve element' },
];

function ElementTypeIcon({ type }: { type: ElementType }) {
  if (type === 'character') return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3" /><path d="M6.5 19c.6-4 2.4-6 5.5-6s4.9 2 5.5 6" /></svg>;
  if (type === 'location') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19 9.2 9l3.2 5 2.1-3.2L20 19H4Z" /><path d="m7.8 11.8 1.5 1 1.3-1.2" /></svg>;
  if (type === 'prop') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8.5h14v10H5zM5 8.5l3-4h8l3 4" /><path d="M10 4.5 8.5 8.5M15.5 4.5 14 8.5" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 15.5v-4l2-4h10l3 4v4H4Z" /><circle cx="7.5" cy="16.5" r="1.8" /><circle cx="16.5" cy="16.5" r="1.8" /><path d="M6 11.5h11" /></svg>;
}

function variationThumbnail(variation: ElementVariation): string | undefined {
  return variation.images[0]?.url;
}

interface ElementSaveData {
  name: string;
  type: ElementType;
  description: string;
  images: ElementImage[];
  variations: ElementVariation[];
  activeVariationId: string;
}

interface ElementModalProps {
  element?: Element;
  defaults?: { name?: string; type?: ElementType; description?: string };
  onSave: (data: ElementSaveData) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export function ElementModal({ element, defaults, onSave, onDelete, onClose }: ElementModalProps) {
  const initialVariations = useMemo<ElementVariation[]>(() => {
    if (element?.variations?.length) return element.variations.map((variation) => ({ ...variation, images: [...variation.images] }));
    const now = new Date().toISOString();
    return [createBaselineVariation(element?.images ?? [], now, crypto.randomUUID())];
  }, [element]);

  const [step, setStep] = useState<ElementModalStep>('brief');
  const [name, setName] = useState(element?.name ?? defaults?.name ?? '');
  const [type, setType] = useState<ElementType>(element?.type ?? defaults?.type ?? 'character');
  const [description, setDescription] = useState(element?.description ?? defaults?.description ?? '');
  const [variations, setVariations] = useState<ElementVariation[]>(initialVariations);
  const [activeVariationId, setActiveVariationId] = useState(
    element?.activeVariationId && initialVariations.some((variation) => variation.id === element.activeVariationId)
      ? element.activeVariationId
      : initialVariations[0].id,
  );
  const [selectedVariationId, setSelectedVariationId] = useState(activeVariationId);
  const [pendingGeneratedImages, setPendingGeneratedImages] = useState<ElementImage[]>([]);
  const [generationBusy, setGenerationBusy] = useState(false);
  const [characterWorkflowState, setCharacterWorkflowState] = useState<'idle' | 'in-progress' | 'ready'>('idle');
  const [activeImageTab, setActiveImageTab] = useState<'upload' | 'generate'>('generate');
  const [newVariationOpen, setNewVariationOpen] = useState(false);
  const [newVariationName, setNewVariationName] = useState('');
  const [newVariationKind, setNewVariationKind] = useState<ElementVariationKind>('condition');
  const [newVariationDescription, setNewVariationDescription] = useState('');

  const selectedVariation = variations.find((variation) => variation.id === selectedVariationId) ?? variations[0];
  const selectedSource = selectedVariation.sourceVariationId
    ? variations.find((variation) => variation.id === selectedVariation.sourceVariationId)
    : undefined;
  const generationReferences = selectedVariation.images.length > 0
    ? selectedVariation.images
    : selectedSource?.images ?? [];
  const selectedType = ELEMENT_TYPES.find((entry) => entry.id === type) ?? ELEMENT_TYPES[0];
  const isContinuityVariation = selectedVariation.kind !== 'baseline';

  const updateVariation = useCallback((variationId: string, updates: Partial<ElementVariation>) => {
    setVariations((current) => current.map((variation) => variation.id === variationId
      ? { ...variation, ...updates, updatedAt: new Date().toISOString() }
      : variation));
  }, []);

  const handleAddImages = useCallback((newImages: ElementImage[]) => {
    setVariations((current) => current.map((variation) => {
      if (variation.id !== selectedVariationId) return variation;
      const images = [...variation.images, ...newImages].filter((image, index, all) => (
        all.findIndex((candidate) => candidate.id === image.id || candidate.url === image.url) === index
      ));
      return { ...variation, images, updatedAt: new Date().toISOString() };
    }));
    setPendingGeneratedImages([]);
  }, [selectedVariationId]);

  const handleRemoveImage = useCallback((imageId: string) => {
    setVariations((current) => current.map((variation) => variation.id === selectedVariationId
      ? { ...variation, images: variation.images.filter((image) => image.id !== imageId), updatedAt: new Date().toISOString() }
      : variation));
  }, [selectedVariationId]);

  const createVariation = useCallback(() => {
    const trimmedName = newVariationName.trim();
    const trimmedDescription = newVariationDescription.trim();
    if (!trimmedName || !trimmedDescription) return;
    const now = new Date().toISOString();
    const variation: ElementVariation = {
      id: crypto.randomUUID(),
      name: trimmedName,
      kind: newVariationKind,
      description: trimmedDescription,
      images: [],
      sourceVariationId: selectedVariationId,
      createdAt: now,
      updatedAt: now,
    };
    setVariations((current) => [...current, variation]);
    setSelectedVariationId(variation.id);
    setPendingGeneratedImages([]);
    setNewVariationOpen(false);
    setNewVariationName('');
    setNewVariationDescription('');
    setStep('reference');
    setActiveImageTab('generate');
  }, [newVariationDescription, newVariationKind, newVariationName, selectedVariationId]);

  const deleteVariation = useCallback((variationId: string) => {
    if (variations.length <= 1) return;
    const next = variations.filter((variation) => variation.id !== variationId);
    setVariations(next);
    if (selectedVariationId === variationId) setSelectedVariationId(next[0].id);
    if (activeVariationId === variationId) setActiveVariationId(next[0].id);
  }, [activeVariationId, selectedVariationId, variations]);

  const materializedVariations = useMemo(() => variations.map((variation) => {
    if (variation.id !== selectedVariationId || pendingGeneratedImages.length === 0) return variation;
    const images = [...variation.images, ...pendingGeneratedImages].filter((image, index, all) => (
      all.findIndex((candidate) => candidate.id === image.id || candidate.url === image.url) === index
    ));
    return { ...variation, images, updatedAt: new Date().toISOString() };
  }), [pendingGeneratedImages, selectedVariationId, variations]);

  const handleSave = () => {
    if (!name.trim()) return;
    const active = materializedVariations.find((variation) => variation.id === activeVariationId) ?? materializedVariations[0];
    onSave({
      name: name.trim(),
      type,
      description: description.trim(),
      images: active.images,
      variations: materializedVariations,
      activeVariationId: active.id,
    });
  };

  const stepIndex = MODAL_STEPS.findIndex((entry) => entry.id === step);
  const nextStep = () => setStep(MODAL_STEPS[Math.min(stepIndex + 1, MODAL_STEPS.length - 1)].id);
  const previousStep = () => setStep(MODAL_STEPS[Math.max(stepIndex - 1, 0)].id);
  const primaryDisabled = !name.trim()
    || generationBusy
    || (type === 'character' && step === 'reference' && !isContinuityVariation && activeImageTab === 'generate' && characterWorkflowState === 'in-progress');

  return (
    <div className="element-modal__backdrop" onClick={onClose}>
      <div className="element-modal element-studio" onClick={(event) => event.stopPropagation()}>
        <header className="element-modal__header element-studio__header">
          <div>
            <span className="element-studio__kicker">Production design</span>
            <h3 className="element-modal__title">{element ? `Edit ${element.name}` : 'Create a movie element'}</h3>
            <p>Approve one identity, then manage every scripted continuity state beneath it.</p>
          </div>
          <button className="element-modal__close" onClick={onClose} type="button" aria-label="Close element studio">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>

        <div className="element-studio__workspace">
          <aside className="element-studio__rail" aria-label="Element creation steps">
            <div className="element-studio__department">
              <span className="element-studio__department-icon"><ElementTypeIcon type={type} /></span>
              <span><small>{selectedType.department}</small><strong>{name.trim() || 'Untitled element'}</strong></span>
            </div>
            <nav className="element-studio__steps">
              {MODAL_STEPS.map((entry, index) => (
                <button
                  key={entry.id}
                  type="button"
                  className={`${step === entry.id ? 'is-active' : ''}${index < stepIndex ? ' is-complete' : ''}`}
                  onClick={() => setStep(entry.id)}
                >
                  <span>{entry.number}</span>
                  <strong>{entry.label}</strong>
                </button>
              ))}
            </nav>
            <div className="element-studio__rail-note">
              <span>Generation rule</span>
              <p>Only the approved look—or the look selected on a Spaces node—is passed to image and video models.</p>
            </div>
          </aside>

          <main className="element-modal__body element-studio__body">
            {step === 'brief' && (
              <section className="element-studio__section">
                <div className="element-studio__section-heading">
                  <span>01 / Creative brief</span>
                  <h4>Define what must remain recognizable</h4>
                  <p>This is the source-of-truth description shared by casting, art, wardrobe and continuity.</p>
                </div>

                <div className="element-modal__field">
                  <label className="element-modal__label" htmlFor="element-name">Production name</label>
                  <input id="element-name" className="element-modal__input" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Mara Voss, Apartment 4B, Getaway Sedan" />
                  <small className="element-studio__helper">Use the name the crew and script will recognize.</small>
                </div>

                <div className="element-modal__field">
                  <label className="element-modal__label">Department</label>
                  <div className="element-modal__type-grid element-studio__type-grid">
                    {ELEMENT_TYPES.map((entry) => (
                      <button key={entry.id} type="button" className={`element-modal__type-btn ${type === entry.id ? 'element-modal__type-btn--active' : ''}`} onClick={() => setType(entry.id)}>
                        <span className="element-studio__type-icon"><ElementTypeIcon type={entry.id} /></span>
                        <span><strong>{entry.label}</strong><small>{entry.department}</small></span>
                      </button>
                    ))}
                  </div>
                  <small className="element-studio__helper">{selectedType.brief}</small>
                </div>

                <div className="element-modal__field">
                  <label className="element-modal__label" htmlFor="element-description">{type === 'character' ? 'Casting brief' : 'Design brief'}</label>
                  <textarea id="element-description" className="element-modal__textarea element-studio__brief" value={description} onChange={(event) => setDescription(event.target.value)} placeholder={type === 'character' ? 'Describe age range, physical presence, face, build, movement and defining features. Keep wardrobe out until casting is approved.' : 'Describe silhouette, materials, scale, color, era and the details that must stay consistent.'} rows={5} />
                  <ElementDescriptionAssistant name={name} type={type} description={description} onApply={setDescription} />
                </div>
              </section>
            )}

            {step === 'reference' && (
              <section className="element-studio__section">
                <div className="element-studio__section-heading element-studio__section-heading--split">
                  <div>
                    <span>02 / Build reference</span>
                    <h4>{isContinuityVariation ? `Build “${selectedVariation.name}”` : type === 'character' ? 'Cast, fit and photograph the role' : 'Build the approved reference sheet'}</h4>
                    <p>{isContinuityVariation ? 'Use the source look as an identity lock and change only the scripted state below.' : 'Upload approved art or generate a controlled multi-view sheet.'}</p>
                  </div>
                  <div className="element-studio__look-switcher">
                    <label htmlFor="element-current-look">Working look</label>
                    <select id="element-current-look" value={selectedVariationId} onChange={(event) => { setSelectedVariationId(event.target.value); setPendingGeneratedImages([]); }}>
                      {variations.map((variation) => <option key={variation.id} value={variation.id}>{variation.name}</option>)}
                    </select>
                  </div>
                </div>

                {isContinuityVariation && (
                  <div className="element-studio__continuity-brief">
                    <span>{variationKindLabel(selectedVariation.kind)}</span>
                    <strong>{selectedVariation.name}</strong>
                    <p>{selectedVariation.description}</p>
                    {selectedSource && <small>Identity locked to: {selectedSource.name}</small>}
                  </div>
                )}

                <div className="element-modal__image-tabs element-studio__source-tabs">
                  <button type="button" className={`element-modal__image-tab ${activeImageTab === 'generate' ? 'element-modal__image-tab--active' : ''}`} onClick={() => setActiveImageTab('generate')}>Generate reference</button>
                  <button type="button" className={`element-modal__image-tab ${activeImageTab === 'upload' ? 'element-modal__image-tab--active' : ''}`} onClick={() => setActiveImageTab('upload')}>Upload approved art</button>
                </div>

                {activeImageTab === 'upload' ? (
                  <ElementImageUpload onUpload={handleAddImages} />
                ) : (
                  <ElementGenerate
                    elementType={type}
                    description={isContinuityVariation
                      ? `${description}. Continuity state: ${selectedVariation.name}. ${selectedVariation.description}. Keep every other defining feature identical to the approved source look.`
                      : description}
                    onGenerated={handleAddImages}
                    onPendingGeneratedChange={setPendingGeneratedImages}
                    onBusyChange={setGenerationBusy}
                    onCharacterWorkflowStateChange={setCharacterWorkflowState}
                    referenceImages={generationReferences}
                    continuityMode={isContinuityVariation}
                  />
                )}

                {selectedVariation.images.length > 0 && (
                  <div className="element-studio__reference-pack">
                    <div className="element-studio__reference-pack-head"><strong>Approved reference pack</strong><span>{selectedVariation.images.length} views</span></div>
                    <div className="element-modal__image-grid">
                      {selectedVariation.images.map((image) => (
                        <div key={image.id} className="element-modal__image-item">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={image.url} alt="" className="element-modal__image-thumb" />
                          <button type="button" className="element-modal__image-remove" onClick={() => handleRemoveImage(image.id)} aria-label="Remove reference image">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}

            {step === 'continuity' && (
              <section className="element-studio__section">
                <div className="element-studio__section-heading element-studio__section-heading--split">
                  <div>
                    <span>03 / Continuity looks</span>
                    <h4>Track the story, not duplicate elements</h4>
                    <p>Every look stays attached to {name.trim() || 'this element'}. Choose the default here, or override it on an individual Spaces node.</p>
                  </div>
                  <button type="button" className="element-studio__secondary-action" onClick={() => setNewVariationOpen((open) => !open)}>Add scripted look</button>
                </div>

                {newVariationOpen && (
                  <div className="element-studio__variation-form">
                    <div className="element-studio__variation-form-head"><strong>New continuity look</strong><span>Derived from {selectedVariation.name}</span></div>
                    <div className="element-studio__variation-kind-grid">
                      {VARIATION_KINDS.map((kind) => (
                        <button key={kind.id} type="button" className={newVariationKind === kind.id ? 'is-active' : ''} onClick={() => setNewVariationKind(kind.id)}>
                          <strong>{kind.label}</strong><small>{kind.hint}</small>
                        </button>
                      ))}
                    </div>
                    <div className="element-studio__variation-fields">
                      <label><span>Look name</span><input value={newVariationName} onChange={(event) => setNewVariationName(event.target.value)} placeholder="e.g. After the alley fight" /></label>
                      <label><span>What changes in the story?</span><textarea value={newVariationDescription} onChange={(event) => setNewVariationDescription(event.target.value)} placeholder="Shirt torn at the right shoulder, split lip, shallow scratches on both forearms. Identity and all other wardrobe details remain unchanged." rows={3} /></label>
                    </div>
                    <div className="element-studio__variation-form-actions">
                      <button type="button" onClick={() => setNewVariationOpen(false)}>Cancel</button>
                      <button type="button" className="element-studio__secondary-action" disabled={!newVariationName.trim() || !newVariationDescription.trim()} onClick={createVariation}>Create look and build references</button>
                    </div>
                  </div>
                )}

                <div className="element-studio__variation-list">
                  {variations.map((variation, index) => {
                    const thumbnail = variationThumbnail(variation);
                    const active = activeVariationId === variation.id;
                    return (
                      <article key={variation.id} className={`element-studio__variation-row${active ? ' is-active' : ''}`}>
                        <button type="button" className="element-studio__variation-preview" onClick={() => { setSelectedVariationId(variation.id); setStep('reference'); }}>
                          {thumbnail ? <img src={thumbnail} alt="" /> : <span>{String(index + 1).padStart(2, '0')}</span>}
                        </button>
                        <div className="element-studio__variation-copy">
                          <span>{variationKindLabel(variation.kind)}{active ? ' · Default look' : ''}</span>
                          <input value={variation.name} onChange={(event) => updateVariation(variation.id, { name: event.target.value })} aria-label="Look name" />
                          <textarea value={variation.description} onChange={(event) => updateVariation(variation.id, { description: event.target.value })} rows={2} aria-label="Look description" />
                        </div>
                        <div className="element-studio__variation-actions">
                          <span>{variation.images.length} approved views</span>
                          {!active && <button type="button" onClick={() => setActiveVariationId(variation.id)}>Make default</button>}
                          <button type="button" onClick={() => { setSelectedVariationId(variation.id); setStep('reference'); }}>{variation.images.length ? 'Edit references' : 'Build references'}</button>
                          {variation.kind !== 'baseline' && <button type="button" className="is-danger" onClick={() => deleteVariation(variation.id)}>Remove</button>}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            )}

            {step === 'review' && (
              <section className="element-studio__section">
                <div className="element-studio__section-heading">
                  <span>04 / Approve element</span>
                  <h4>Ready for the production library</h4>
                  <p>The default look is used by Director. Spaces can choose any continuity look without creating a duplicate element.</p>
                </div>

                <div className="element-studio__review">
                  <div className="element-studio__review-hero">
                    {materializedVariations.find((variation) => variation.id === activeVariationId)?.images[0]?.url
                      ? <img src={materializedVariations.find((variation) => variation.id === activeVariationId)!.images[0].url} alt={name} />
                      : <div className="element-studio__review-empty"><ElementTypeIcon type={type} /><span>Add a reference image before production use</span></div>}
                    <div><span>{selectedType.department}</span><h4>{name || 'Untitled element'}</h4><p>{description || 'No creative brief yet.'}</p></div>
                  </div>
                  <div className="element-studio__review-looks">
                    <div className="element-studio__review-looks-head"><strong>Continuity manifest</strong><span>{variations.length} {variations.length === 1 ? 'look' : 'looks'}</span></div>
                    {materializedVariations.map((variation) => (
                      <button key={variation.id} type="button" className={activeVariationId === variation.id ? 'is-active' : ''} onClick={() => setActiveVariationId(variation.id)}>
                        {variation.images[0]?.url ? <img src={variation.images[0].url} alt="" /> : <span className="element-studio__review-look-empty" />}
                        <span><strong>{variation.name}</strong><small>{variationKindLabel(variation.kind)} · {variation.images.length} views</small></span>
                        <em>{activeVariationId === variation.id ? 'Default' : 'Set default'}</em>
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            )}
          </main>
        </div>

        <footer className="element-modal__footer element-studio__footer">
          <div>
            {element && onDelete && <button type="button" className="element-modal__delete-btn" onClick={onDelete}>Delete element</button>}
            <span className="element-studio__footer-status">{variations.length} continuity {variations.length === 1 ? 'look' : 'looks'} · {variations.reduce((total, variation) => total + variation.images.length, 0)} approved views</span>
          </div>
          <div className="element-modal__footer-right">
            {stepIndex > 0 ? <button type="button" className="element-modal__cancel-btn" onClick={previousStep}>Back</button> : <button type="button" className="element-modal__cancel-btn" onClick={onClose}>Cancel</button>}
            {step === 'review' ? (
              <button type="button" className="element-modal__save-btn" onClick={handleSave} disabled={primaryDisabled}>{element ? 'Save element' : 'Add to production'}</button>
            ) : (
              <button type="button" className="element-modal__save-btn" onClick={nextStep} disabled={primaryDisabled}>
                {generationBusy ? 'Generating…' : step === 'brief' ? 'Build reference' : step === 'reference' ? 'Manage continuity' : 'Review element'}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
