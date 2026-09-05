import { COMMON_SUFFIX, REFERENCE_LOCK_INSTRUCTION, CHARACTER_CASTING_SUFFIX, CASTING_IDENTITY_PROFILES, CHARACTER_CASTING_REFERENCE_SUFFIX, characterCastingFromReferencePrompt, characterCastingPrompt, characterWardrobePrompt, characterCastingCorrectionPrompt, characterWardrobeCorrectionPrompt, orderedGeneratedPanels, buildIndividualPrompts, buildPanelLabels, extractResultUrl, generateSingleImage, PREFERRED_ELEMENT_MODELS, preferredElementModel, elementGenerationModelOptions } from '@/lib/elements/reference-generation';


import { useState, useCallback, useEffect, useMemo } from 'react';
import type { ElementType, ElementImage } from '@/types/elements';
import { getModelDefinition } from '@/lib/fal/models';
import {
  MODEL_PROVIDER_LABELS,
  providerModelOptions,
  type ModelProvider,
  type ProviderModelOption,
} from '@/lib/workflows/provider-model-options';
import { useTopviewModelCatalogVersion } from '@/components/create/use-topview-model-catalog';

interface ElementGenerateProps {
  elementType: ElementType;
  description: string;
  onGenerated: (images: ElementImage[]) => void;
  /** Successful panels that are still in the review grid and have not been kept explicitly. */
  onPendingGeneratedChange?: (images: ElementImage[]) => void;
  onBusyChange?: (busy: boolean) => void;
  onCharacterWorkflowStateChange?: (state: 'idle' | 'in-progress' | 'ready') => void;
  referenceImages?: ElementImage[];
  /** Skip re-casting and derive a new story state from the locked reference pack. */
  continuityMode?: boolean;
}

type Phase = 'idle' | 'generating' | 'review';
type CharacterStage = 'casting' | 'wardrobe' | 'sheet';

interface CharacterOption {
  image: ElementImage;
  referenceValue?: string;
  castingProfileIndex?: number;
}

interface SavedWardrobeOption {
  actorImageId: string;
  option: CharacterOption;
}

interface CharacterRegenerationEditor {
  stage: 'casting' | 'wardrobe';
  index: number;
  note: string;
}

interface SavedOptionTrayProps {
  title: string;
  description: string;
  itemLabel: string;
  options: CharacterOption[];
  selectedImageId?: string;
  onUse: (option: CharacterOption) => void;
  onRemove: (imageId: string) => void;
}

function SavedOptionTray({
  title,
  description,
  itemLabel,
  options,
  selectedImageId,
  onUse,
  onRemove,
}: SavedOptionTrayProps) {
  if (options.length === 0) return null;

  return (
    <aside className="character-casting__saved" aria-label={title}>
      <div className="character-casting__saved-heading">
        <div>
          <span>{title}</span>
          <small>{description}</small>
        </div>
        <strong>{options.length}</strong>
      </div>
      <div className="character-casting__saved-rail">
        {options.map((option, index) => (
          <article
            key={option.image.id}
            className={`character-casting__saved-card ${selectedImageId === option.image.id ? 'character-casting__saved-card--active' : ''}`}
          >
            <button
              type="button"
              className="character-casting__saved-use"
              onClick={() => onUse(option)}
              title={`Use saved ${itemLabel.toLowerCase()} ${index + 1}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={option.image.url} alt={`Saved ${itemLabel.toLowerCase()} ${index + 1}`} />
              <span>Saved {itemLabel} {index + 1}</span>
            </button>
            <button
              type="button"
              className="character-casting__saved-remove"
              onClick={() => onRemove(option.image.id)}
              aria-label={`Remove saved ${itemLabel.toLowerCase()} ${index + 1}`}
              title="Remove backup"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </article>
        ))}
      </div>
    </aside>
  );
}

interface RegenerationNotesPanelProps {
  targetLabel: string;
  note: string;
  suggestions: string[];
  busy: boolean;
  onNoteChange: (note: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}

function RegenerationNotesPanel({
  targetLabel,
  note,
  suggestions,
  busy,
  onNoteChange,
  onClose,
  onSubmit,
}: RegenerationNotesPanelProps) {
  return (
    <form
      className="character-casting__regen-notes"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="character-casting__regen-notes-heading">
        <div>
          <span>Regenerate with notes</span>
          <strong>{targetLabel}</strong>
        </div>
        <button type="button" onClick={onClose} disabled={busy} aria-label="Close regeneration notes">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <label className="character-casting__regen-notes-field">
        <span>What was wrong, and what must change?</span>
        <textarea
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          placeholder="e.g. Do not show any hands. Keep the same actor, face, wardrobe, lighting, and background."
          rows={3}
          autoFocus
          disabled={busy}
        />
      </label>
      <div className="character-casting__regen-suggestions" aria-label="Common regeneration notes">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onNoteChange(note.trim() ? `${note.trim()} ${suggestion}` : suggestion)}
            disabled={busy}
          >
            {suggestion}
          </button>
        ))}
      </div>
      <div className="character-casting__regen-notes-footer">
        <small>Add a note or choose a quick direction. Only this result is replaced; saved backups are never overwritten.</small>
        <button type="submit" className="element-generate__btn" disabled={busy || !note.trim()}>
          {busy ? 'Regenerating…' : 'Regenerate this image'}
        </button>
      </div>
    </form>
  );
}

export function ElementGenerate({
  elementType,
  description,
  onGenerated,
  onPendingGeneratedChange,
  onBusyChange,
  onCharacterWorkflowStateChange,
  referenceImages,
  continuityMode = false,
}: ElementGenerateProps) {
  const topviewCatalogVersion = useTopviewModelCatalogVersion();
  const modelOptions = useMemo(
    () => elementGenerationModelOptions(),
    [topviewCatalogVersion],
  );
  const initialOption = preferredElementModel(modelOptions, 'topview') ?? modelOptions[0];
  const [selectedProvider, setSelectedProvider] = useState<ModelProvider>(initialOption?.provider ?? 'fal');
  const [selectedModel, setSelectedModel] = useState(initialOption?.key ?? 'nano-banana-pro');
  const [prompt, setPrompt] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [panels, setPanels] = useState<(ElementImage | null)[]>([]);
  const [panelReferenceValues, setPanelReferenceValues] = useState<(string | null)[]>([]);
  const [panelErrors, setPanelErrors] = useState<(string | null)[]>([]);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generateProgress, setGenerateProgress] = useState(0);
  const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(null);
  const [characterStage, setCharacterStage] = useState<CharacterStage>('casting');
  const [castingCount, setCastingCount] = useState(3);
  const [castingOptions, setCastingOptions] = useState<(CharacterOption | null)[]>([]);
  const [selectedCastingIndex, setSelectedCastingIndex] = useState<number | null>(null);
  const [savedCastingOptions, setSavedCastingOptions] = useState<CharacterOption[]>([]);
  const [wardrobeDescription, setWardrobeDescription] = useState('');
  const [wardrobeCount, setWardrobeCount] = useState(1);
  const [wardrobeOptions, setWardrobeOptions] = useState<(CharacterOption | null)[]>([]);
  const [selectedWardrobeIndex, setSelectedWardrobeIndex] = useState<number | null>(null);
  const [savedWardrobeOptions, setSavedWardrobeOptions] = useState<SavedWardrobeOption[]>([]);
  const [regenerationEditor, setRegenerationEditor] = useState<CharacterRegenerationEditor | null>(null);
  const [characterBusy, setCharacterBusy] = useState(false);
  const [characterProgress, setCharacterProgress] = useState({ done: 0, total: 0, label: '' });
  const [characterError, setCharacterError] = useState<string | null>(null);

  useEffect(() => {
    onPendingGeneratedChange?.(orderedGeneratedPanels(panels));
  }, [onPendingGeneratedChange, panels]);

  const desc = prompt.trim() || description.trim();
  const isBusy = phase === 'generating' || regeneratingIndex !== null || characterBusy;
  const labels = buildPanelLabels(elementType);
  const totalPanels = labels.length;
  const providerOptions = useMemo(
    () => [...new Set(modelOptions.map((option) => option.provider))],
    [modelOptions],
  );
  const providerModels = useMemo(
    () => modelOptions.filter((option) => option.provider === selectedProvider),
    [modelOptions, selectedProvider],
  );
  const selectedModelOption = modelOptions.find((option) => option.key === selectedModel);

  useEffect(() => {
    onBusyChange?.(isBusy);
  }, [isBusy, onBusyChange]);

  useEffect(() => {
    if (!onCharacterWorkflowStateChange || elementType !== 'character') return;
    if (panels.some(Boolean)) {
      onCharacterWorkflowStateChange('ready');
    } else if (castingOptions.some(Boolean) || wardrobeOptions.some(Boolean) || characterStage !== 'casting') {
      onCharacterWorkflowStateChange('in-progress');
    } else {
      onCharacterWorkflowStateChange('idle');
    }
  }, [castingOptions, characterStage, elementType, onCharacterWorkflowStateChange, panels, wardrobeOptions]);

  useEffect(() => {
    const current = modelOptions.find((option) => option.key === selectedModel);
    if (current) {
      if (current.provider !== selectedProvider) setSelectedProvider(current.provider);
      return;
    }
    const fallback = preferredElementModel(modelOptions, selectedProvider)
      ?? preferredElementModel(modelOptions, 'topview')
      ?? modelOptions[0];
    if (fallback) {
      setSelectedProvider(fallback.provider);
      setSelectedModel(fallback.key);
    }
  }, [modelOptions, selectedModel, selectedProvider]);

  // Get fal.ai URLs from uploaded reference images (filter out blob: URLs)
  const uploadedRefUrls = useMemo(
    () => (referenceImages ?? []).map((img) => img.url).filter((u) => !u.startsWith('blob:')),
    [referenceImages],
  );

  const selectedActor = selectedCastingIndex === null ? null : castingOptions[selectedCastingIndex];
  const visibleSavedWardrobeOptions = useMemo(
    () => selectedActor
      ? savedWardrobeOptions
        .filter((saved) => saved.actorImageId === selectedActor.image.id)
        .map((saved) => saved.option)
      : [],
    [savedWardrobeOptions, selectedActor],
  );

  const selectCastingOption = useCallback((index: number) => {
    setRegenerationEditor(null);
    if (selectedCastingIndex !== index) {
      setWardrobeOptions([]);
      setSelectedWardrobeIndex(null);
    }
    setSelectedCastingIndex(index);
  }, [selectedCastingIndex]);

  const toggleSavedCastingOption = useCallback((option: CharacterOption) => {
    setSavedCastingOptions((current) => current.some((saved) => saved.image.id === option.image.id)
      ? current.filter((saved) => saved.image.id !== option.image.id)
      : [...current, option]);
  }, []);

  const restoreSavedCastingOption = useCallback((option: CharacterOption) => {
    setRegenerationEditor(null);
    const existingIndex = castingOptions.findIndex((candidate) => candidate?.image.id === option.image.id);
    setWardrobeOptions([]);
    setSelectedWardrobeIndex(null);
    if (existingIndex >= 0) {
      setSelectedCastingIndex(existingIndex);
      return;
    }
    setCastingOptions([option, ...castingOptions]);
    setSelectedCastingIndex(0);
  }, [castingOptions]);

  const toggleSavedWardrobeOption = useCallback((option: CharacterOption) => {
    if (!selectedActor) return;
    setSavedWardrobeOptions((current) => {
      const isSaved = current.some((saved) => saved.option.image.id === option.image.id);
      if (isSaved) return current.filter((saved) => saved.option.image.id !== option.image.id);
      return [...current, { actorImageId: selectedActor.image.id, option }];
    });
  }, [selectedActor]);

  const restoreSavedWardrobeOption = useCallback((option: CharacterOption) => {
    setRegenerationEditor(null);
    const existingIndex = wardrobeOptions.findIndex((candidate) => candidate?.image.id === option.image.id);
    if (existingIndex >= 0) {
      setSelectedWardrobeIndex(existingIndex);
      return;
    }
    setWardrobeOptions([option, ...wardrobeOptions]);
    setSelectedWardrobeIndex(0);
  }, [wardrobeOptions]);

  const handleGenerateCasting = useCallback(async (regenerateIndex?: number, correctionNote?: string) => {
    if (!desc || !selectedModelOption) return;
    const correction = correctionNote?.trim();
    if (regenerateIndex === undefined) setRegenerationEditor(null);
    const total = regenerateIndex === undefined ? castingCount : Math.max(castingOptions.length, castingCount);
    const next = regenerateIndex === undefined
      ? new Array<CharacterOption | null>(total).fill(null)
      : Array.from({ length: total }, (_, index) => castingOptions[index] ?? null);
    const targets = regenerateIndex === undefined
      ? Array.from({ length: total }, (_, index) => index)
      : [regenerateIndex];
    if (regenerateIndex !== undefined && !correction) next[regenerateIndex] = null;

    setCharacterBusy(true);
    setCharacterError(null);
    setCastingOptions([...next]);
    if (!correction && (regenerateIndex === undefined || selectedCastingIndex === regenerateIndex)) setSelectedCastingIndex(null);
    setCharacterProgress({ done: 0, total: targets.length, label: 'Auditioning actors' });

    let failures = 0;
    for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
      const index = targets[targetIndex];
      const previousProfileIndex = castingOptions[index]?.castingProfileIndex;
      const profileIndex = regenerateIndex === undefined
        ? ((previousProfileIndex ?? index) + (castingOptions.some(Boolean) ? 1 : 0)) % CASTING_IDENTITY_PROFILES.length
        : ((previousProfileIndex ?? index) + 1) % CASTING_IDENTITY_PROFILES.length;
      try {
        const rejectedOption = correction ? castingOptions[index] : null;
        const castingReferences = rejectedOption
          ? [rejectedOption.referenceValue ?? rejectedOption.image.url, ...uploadedRefUrls]
          : uploadedRefUrls;
        const castingPrompt = correction
          ? characterCastingCorrectionPrompt(desc, correction)
          : uploadedRefUrls.length > 0
            ? characterCastingFromReferencePrompt(desc, index)
            : characterCastingPrompt(desc, index, profileIndex);
        const generated = await generateSingleImage(
          castingPrompt,
          selectedModel,
          castingReferences.length > 0 ? [...new Set(castingReferences)] : undefined,
        );
        next[index] = {
          image: {
            id: crypto.randomUUID(),
            url: generated.url,
            createdAt: new Date().toISOString(),
            source: 'generated',
          },
          referenceValue: generated.referenceValue,
          castingProfileIndex: profileIndex,
        };
      } catch (error) {
        failures += 1;
        setCharacterError(error instanceof Error ? error.message : 'Casting generation failed.');
      }
      setCastingOptions([...next]);
      setCharacterProgress({ done: targetIndex + 1, total: targets.length, label: 'Auditioning actors' });
    }
    if (failures === targets.length) setCharacterError('No casting options were returned. Try again or choose another image model.');
    setCharacterBusy(false);
    return failures < targets.length;
  }, [castingCount, castingOptions, desc, selectedCastingIndex, selectedModel, selectedModelOption, uploadedRefUrls]);

  const handleGenerateWardrobe = useCallback(async (regenerateIndex?: number, correctionNote?: string) => {
    const actor = selectedCastingIndex === null ? null : castingOptions[selectedCastingIndex];
    const wardrobe = wardrobeDescription.trim();
    if (!actor || !wardrobe || !selectedModelOption) return;
    const correction = correctionNote?.trim();
    if (regenerateIndex === undefined) setRegenerationEditor(null);
    const total = regenerateIndex === undefined ? wardrobeCount : Math.max(wardrobeOptions.length, wardrobeCount);
    const next = regenerateIndex === undefined
      ? new Array<CharacterOption | null>(total).fill(null)
      : Array.from({ length: total }, (_, index) => wardrobeOptions[index] ?? null);
    const targets = regenerateIndex === undefined
      ? Array.from({ length: total }, (_, index) => index)
      : [regenerateIndex];
    if (regenerateIndex !== undefined && !correction) next[regenerateIndex] = null;

    setCharacterBusy(true);
    setCharacterError(null);
    setWardrobeOptions([...next]);
    if (!correction && (regenerateIndex === undefined || selectedWardrobeIndex === regenerateIndex)) setSelectedWardrobeIndex(null);
    setCharacterProgress({ done: 0, total: targets.length, label: 'Fitting wardrobe' });
    const actorReference = actor.referenceValue ?? actor.image.url;

    let failures = 0;
    for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
      const index = targets[targetIndex];
      try {
        const rejectedOption = correction ? wardrobeOptions[index] : null;
        const references = rejectedOption
          ? [rejectedOption.referenceValue ?? rejectedOption.image.url, actorReference, ...uploadedRefUrls]
          : [actorReference, ...uploadedRefUrls];
        const generated = await generateSingleImage(
          correction
            ? characterWardrobeCorrectionPrompt(desc, wardrobe, index, correction)
            : characterWardrobePrompt(desc, wardrobe, index),
          selectedModel,
          [...new Set(references)],
        );
        next[index] = {
          image: {
            id: crypto.randomUUID(),
            url: generated.url,
            createdAt: new Date().toISOString(),
            source: 'generated',
          },
          referenceValue: generated.referenceValue,
        };
      } catch (error) {
        failures += 1;
        setCharacterError(error instanceof Error ? error.message : 'Wardrobe generation failed.');
      }
      setWardrobeOptions([...next]);
      setCharacterProgress({ done: targetIndex + 1, total: targets.length, label: 'Fitting wardrobe' });
    }
    if (failures === targets.length) setCharacterError('No wardrobe options were returned. Try again or choose another image model.');
    setCharacterBusy(false);
    return failures < targets.length;
  }, [castingOptions, desc, selectedCastingIndex, selectedModel, selectedModelOption, selectedWardrobeIndex, uploadedRefUrls, wardrobeCount, wardrobeDescription, wardrobeOptions]);

  const submitCharacterRegeneration = useCallback(async () => {
    if (!regenerationEditor || characterBusy || !regenerationEditor.note.trim()) return;
    const { stage, index, note } = regenerationEditor;
    const succeeded = stage === 'casting'
      ? await handleGenerateCasting(index, note)
      : await handleGenerateWardrobe(index, note);
    if (succeeded) setRegenerationEditor(null);
  }, [characterBusy, handleGenerateCasting, handleGenerateWardrobe, regenerationEditor]);

  const handleGenerate = useCallback(async (
    preserveCompleted = false,
    startingPanels?: (ElementImage | null)[],
    startingReferences?: (string | null)[],
    descriptionOverride?: string,
  ) => {
    const generationDescription = descriptionOverride?.trim() || desc;
    if (!generationDescription) return;
    setPhase('generating');

    const prompts = buildIndividualPrompts(elementType, generationDescription);
    const sourcePanels = startingPanels ?? panels;
    const sourceReferences = startingReferences ?? panelReferenceValues;
    const images: (ElementImage | null)[] = preserveCompleted
      ? Array.from({ length: prompts.length }, (_, index) => sourcePanels[index] ?? null)
      : new Array(prompts.length).fill(null);
    const errors: (string | null)[] = new Array(prompts.length).fill(null);
    const reusableReferences: (string | null)[] = preserveCompleted
      ? Array.from({ length: prompts.length }, (_, index) => sourceReferences[index] ?? null)
      : new Array(prompts.length).fill(null);
    setPanels(images);
    setPanelReferenceValues(reusableReferences);
    setPanelErrors(errors);
    setGenerationError(null);
    setGenerateProgress(images.filter(Boolean).length);

    let generatedRefUrl: string | null = images[0]?.url ?? null;
    let previousResultUrl: string | null = null;
    let anchorReferenceValue: string | null = reusableReferences[0]
      ?? (selectedModelOption?.provider === 'topview' ? images[0]?.url ?? null : null);
    let previousReferenceValue: string | null = null;

    for (let i = 0; i < prompts.length; i++) {
      if (images[i]) continue;
      // User references establish the requested identity. Each later Topview panel
      // also receives the stable first-panel anchor and the immediately previous
      // view so the sheet cannot drift as its camera angle changes.
      const refs: string[] = [...uploadedRefUrls];
      if (i > 0 && selectedModelOption?.provider === 'topview') {
        if (anchorReferenceValue) refs.push(anchorReferenceValue);
        if (previousReferenceValue && previousReferenceValue !== anchorReferenceValue) refs.push(previousReferenceValue);
      } else if (i > 0 && generatedRefUrl) {
        refs.push(generatedRefUrl);
        if (previousResultUrl && previousResultUrl !== generatedRefUrl) refs.push(previousResultUrl);
      }

      try {
        const generated = await generateSingleImage(
          prompts[i],
          selectedModel,
          [...new Set(refs)].length > 0 ? [...new Set(refs)] : undefined,
        );
        const { url, referenceValue } = generated;
        if (i === 0) {
          generatedRefUrl = url;
          anchorReferenceValue = referenceValue ?? url;
        }
        previousResultUrl = url;
        previousReferenceValue = referenceValue ?? (selectedModelOption?.provider === 'topview' ? url : null);
        reusableReferences[i] = referenceValue ?? (selectedModelOption?.provider === 'topview' ? url : null);
        images[i] = {
          id: crypto.randomUUID(),
          url,
          createdAt: new Date().toISOString(),
          source: 'generated',
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Image generation failed.';
        errors[i] = message;
        for (let pending = i + 1; pending < errors.length; pending++) {
          errors[pending] = 'Not attempted because the provider request failed.';
        }
        setPanelErrors([...errors]);
        setGenerationError(message);
        setGenerateProgress(prompts.length);
        break;
      }
      setPanels([...images]);
      setPanelReferenceValues([...reusableReferences]);
      setPanelErrors([...errors]);
      setGenerateProgress(i + 1);
    }

    setPhase('review');
  }, [desc, elementType, panels, panelReferenceValues, selectedModel, selectedModelOption?.provider, uploadedRefUrls]);

  const handleBuildCharacterSheet = useCallback((useWardrobe: boolean) => {
    const actor = selectedCastingIndex === null ? null : castingOptions[selectedCastingIndex];
    const wardrobe = selectedWardrobeIndex === null ? null : wardrobeOptions[selectedWardrobeIndex];
    const chosen = useWardrobe ? wardrobe : actor;
    if (!chosen) return;
    setRegenerationEditor(null);

    const seededPanels: (ElementImage | null)[] = [chosen.image, null, null, null, null, null, null];
    const seededReferences: (string | null)[] = [chosen.referenceValue ?? chosen.image.url, null, null, null, null, null, null];
    const sheetDescription = useWardrobe && wardrobeDescription.trim()
      ? `${desc}. The approved wardrobe is: ${wardrobeDescription.trim()}`
      : desc;
    setCharacterStage('sheet');
    setPanels(seededPanels);
    setPanelReferenceValues(seededReferences);
    setPanelErrors(new Array(seededPanels.length).fill(null));
    setGenerationError(null);
    void handleGenerate(true, seededPanels, seededReferences, sheetDescription);
  }, [castingOptions, desc, handleGenerate, selectedCastingIndex, selectedWardrobeIndex, wardrobeDescription, wardrobeOptions]);

  const handleRegeneratePanel = useCallback(async (index: number) => {
    if (regeneratingIndex !== null) return;
    setRegeneratingIndex(index);

    const regenerationDescription = elementType === 'character' && wardrobeDescription.trim()
      ? `${desc}. The approved wardrobe is: ${wardrobeDescription.trim()}`
      : desc;
    const prompts = buildIndividualPrompts(elementType, regenerationDescription);
    // Use uploaded references + the stable panel-0 identity anchor.
    const refs: string[] = [...uploadedRefUrls];
    if (index !== 0 && selectedModelOption?.provider === 'topview' && (panelReferenceValues[0] || panels[0]?.url)) {
      const anchor = panelReferenceValues[0] || panels[0]?.url;
      if (anchor) refs.push(anchor);
      const previous = panelReferenceValues[index - 1] || panels[index - 1]?.url;
      if (previous && previous !== anchor) refs.push(previous);
    } else if (index !== 0 && panels[0]?.url) {
      refs.push(panels[0].url);
      const previous = panels[index - 1]?.url;
      if (previous && previous !== panels[0].url) refs.push(previous);
    }
    try {
      const generated = await generateSingleImage(prompts[index], selectedModel, [...new Set(refs)].length > 0 ? [...new Set(refs)] : undefined);
      const { url, referenceValue } = generated;
      setPanels((prev) => {
        const next = [...prev];
        next[index] = {
          id: crypto.randomUUID(),
          url,
          createdAt: new Date().toISOString(),
          source: 'generated',
        };
        return next;
      });
      setPanelReferenceValues((prev) => {
        const next = [...prev];
        next[index] = referenceValue ?? (selectedModelOption?.provider === 'topview' ? url : null);
        return next;
      });
      setPanelErrors((prev) => prev.map((error, panelIndex) => panelIndex === index ? null : error));
      setGenerationError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Image generation failed.';
      setPanelErrors((prev) => prev.map((panelError, panelIndex) => panelIndex === index ? message : panelError));
      setGenerationError(message);
    } finally {
      setRegeneratingIndex(null);
    }
  }, [regeneratingIndex, elementType, desc, panels, panelReferenceValues, selectedModel, selectedModelOption?.provider, uploadedRefUrls, wardrobeDescription]);

  const handleRegenerateAll = useCallback(() => {
    const hasCompletedPanel = panels.some(Boolean);
    const hasMissingPanel = panels.some((panel) => !panel);
    const sheetDescription = elementType === 'character' && wardrobeDescription.trim()
      ? `${desc}. The approved wardrobe is: ${wardrobeDescription.trim()}`
      : undefined;
    void handleGenerate(hasCompletedPanel && hasMissingPanel, undefined, undefined, sheetDescription);
  }, [desc, elementType, handleGenerate, panels, wardrobeDescription]);

  const handleKeepAll = () => {
    const kept = orderedGeneratedPanels(panels);
    if (kept.length > 0) {
      onGenerated(kept);
    }
    setPhase('idle');
    setPanels([]);
    setPanelReferenceValues([]);
    setPanelErrors([]);
    setGenerationError(null);
    setGenerateProgress(0);
    if (elementType === 'character') {
      setCharacterStage('casting');
      setCastingOptions([]);
      setSelectedCastingIndex(null);
      setSavedCastingOptions([]);
      setWardrobeOptions([]);
      setSelectedWardrobeIndex(null);
      setSavedWardrobeOptions([]);
      setRegenerationEditor(null);
      setWardrobeDescription('');
    }
  };

  return (
    <div className="element-generate">
      {/* Input row — visible in idle */}
      {phase === 'idle' && (elementType !== 'character' || continuityMode) && (
        <>
          <div className="element-generate__model-controls">
            <label>
              <span>Provider</span>
              <select
                value={selectedProvider}
                onChange={(event) => {
                  const provider = event.target.value as ModelProvider;
                  const firstModel = preferredElementModel(modelOptions, provider);
                  setSelectedProvider(provider);
                  if (firstModel) setSelectedModel(firstModel.key);
                }}
              >
                {providerOptions.map((provider) => (
                  <option key={provider} value={provider}>{MODEL_PROVIDER_LABELS[provider]}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Image model</span>
              <select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
                {providerModels.map((option) => (
                  <option key={option.key} value={option.key}>{option.name}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="element-generate__input-row">
            <input
              className="element-modal__input element-generate__prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={description || 'Describe what to generate...'}
            />
            <button
              type="button"
              className="element-generate__btn"
              onClick={() => void handleGenerate(false)}
              disabled={!desc || !selectedModelOption}
            >
              Generate
            </button>
          </div>
        </>
      )}

      {elementType === 'character' && !continuityMode && (
        <div className="character-casting">
          <div className="character-casting__steps" aria-label="Character creation progress">
            {(['casting', 'wardrobe', 'sheet'] as CharacterStage[]).map((stage, index) => {
              const labelsByStage: Record<CharacterStage, string> = {
                casting: 'Cast actor',
                wardrobe: 'Choose wardrobe',
                sheet: 'Build sheet',
              };
              const stageOrder = ['casting', 'wardrobe', 'sheet'].indexOf(characterStage);
              return (
                <button
                  key={stage}
                  type="button"
                  className={`character-casting__step ${characterStage === stage ? 'character-casting__step--active' : ''} ${index < stageOrder ? 'character-casting__step--done' : ''}`}
                  onClick={() => {
                    if (characterBusy || phase === 'generating') return;
                    setRegenerationEditor(null);
                    if (stage === 'casting') {
                      setPhase('idle');
                      setCharacterStage('casting');
                    } else if (stage === 'wardrobe' && selectedCastingIndex !== null) {
                      setPhase('idle');
                      setCharacterStage('wardrobe');
                    } else if (stage === 'sheet' && panels.some(Boolean)) {
                      setCharacterStage('sheet');
                    }
                  }}
                  disabled={(stage === 'wardrobe' && selectedCastingIndex === null) || (stage === 'sheet' && !panels.some(Boolean))}
                >
                  <span>{index + 1}</span>
                  {labelsByStage[stage]}
                </button>
              );
            })}
          </div>

          {phase === 'idle' && characterStage !== 'sheet' && (
            <div className="element-generate__model-controls character-casting__models">
              <label>
                <span>Provider</span>
                <select
                  value={selectedProvider}
                  onChange={(event) => {
                    const provider = event.target.value as ModelProvider;
                    const firstModel = preferredElementModel(modelOptions, provider);
                    setSelectedProvider(provider);
                    if (firstModel) setSelectedModel(firstModel.key);
                  }}
                >
                  {providerOptions.map((provider) => (
                    <option key={provider} value={provider}>{MODEL_PROVIDER_LABELS[provider]}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Image model</span>
                <select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
                  {providerModels.map((option) => (
                    <option key={option.key} value={option.key}>{option.name}</option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {characterError && phase === 'idle' && (
            <div className="element-generate__error" role="alert">
              <strong>{selectedModelOption?.providerLabel} could not complete this step.</strong>
              <span>{characterError}</span>
            </div>
          )}

          {characterBusy && (
            <div className="character-casting__status">
              <span>{characterProgress.label} ({characterProgress.done}/{characterProgress.total})</span>
              <div className="element-generate__progress">
                <div
                  className="element-generate__progress-bar"
                  style={{ width: `${characterProgress.total > 0 ? (characterProgress.done / characterProgress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}

          {phase === 'idle' && characterStage === 'casting' && (
            <section className="character-casting__stage">
              <div className="character-casting__stage-heading">
                <div>
                  <span className="character-casting__eyebrow">Casting call</span>
                  <h4>{uploadedRefUrls.length > 0 ? 'Render the subject' : 'Find the actor'}</h4>
                  <p>
                    {uploadedRefUrls.length > 0
                      ? 'Your reference images are the subject. Each take renders that same subject; pick the cleanest one to build the sheet from.'
                      : 'Generate distinct people from the casting brief, then select the face and body that fit the role.'}
                  </p>
                </div>
                <div className="character-casting__count" aria-label="Number of casting options">
                  <span>Options</span>
                  {[1, 3, 5].map((count) => (
                    <button
                      key={count}
                      type="button"
                      className={castingCount === count ? 'character-casting__count-btn--active' : ''}
                      onClick={() => setCastingCount(count)}
                      disabled={characterBusy}
                    >
                      {count}
                    </button>
                  ))}
                </div>
              </div>

              <div className="character-casting__primary-row">
                <span>{desc || 'Add a casting brief in the description above.'}</span>
                <button type="button" className="element-generate__btn" onClick={() => void handleGenerateCasting()} disabled={!desc || isBusy || !selectedModelOption}>
                  {uploadedRefUrls.length > 0
                    ? `Generate ${castingCount} ${castingCount === 1 ? 'take' : 'takes'}`
                    : castingOptions.some(Boolean) ? `Cast ${castingCount} new actors` : `Generate ${castingCount} ${castingCount === 1 ? 'actor' : 'actors'}`}
                </button>
              </div>

              {castingOptions.length > 0 && (
                <div className="character-casting__options">
                  {castingOptions.map((option, index) => {
                    const isSaved = !!option && savedCastingOptions.some((saved) => saved.image.id === option.image.id);
                    return (
                      <div key={option?.image.id ?? index} className={`character-casting__option ${selectedCastingIndex === index ? 'character-casting__option--selected' : ''}`}>
                        {option ? (
                          <>
                            <button type="button" className="character-casting__option-select" onClick={() => selectCastingOption(index)}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={option.image.url} alt={`Casting option ${index + 1}`} />
                              <span>Option {index + 1}</span>
                            </button>
                            <div className="character-casting__option-actions">
                              <button
                                type="button"
                                className={`character-casting__option-save ${isSaved ? 'character-casting__option-save--active' : ''}`}
                                onClick={() => toggleSavedCastingOption(option)}
                                aria-pressed={isSaved}
                                title={isSaved ? 'Saved as a backup' : 'Save as a backup'}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill={isSaved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z" /></svg>
                              </button>
                              <button
                                type="button"
                                className="character-casting__option-regen"
                                onClick={() => setRegenerationEditor({ stage: 'casting', index, note: '' })}
                                disabled={isBusy}
                                title={`Regenerate casting option ${index + 1} with notes`}
                                aria-label={`Regenerate casting option ${index + 1} with notes`}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
                              </button>
                            </div>
                          </>
                        ) : characterBusy ? (
                          <div className="character-casting__skeleton"><span /></div>
                        ) : (
                          <button type="button" className="character-casting__retry" onClick={() => void handleGenerateCasting(index)}>
                            <strong>Not generated</strong>
                            <span>Retry this option</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {regenerationEditor?.stage === 'casting' && castingOptions[regenerationEditor.index] && (
                <RegenerationNotesPanel
                  targetLabel={`Casting option ${regenerationEditor.index + 1}`}
                  note={regenerationEditor.note}
                  suggestions={[
                    'Do not show any hands.',
                    'Keep the same face and body.',
                    'Use a neutral expression.',
                    'Remove all text and logos.',
                  ]}
                  busy={characterBusy}
                  onNoteChange={(note) => setRegenerationEditor((current) => current ? { ...current, note } : current)}
                  onClose={() => setRegenerationEditor(null)}
                  onSubmit={() => void submitCharacterRegeneration()}
                />
              )}

              <SavedOptionTray
                title="Saved actors"
                description="Backups stay here while you audition new batches."
                itemLabel="Actor"
                options={savedCastingOptions}
                selectedImageId={selectedCastingIndex === null ? undefined : castingOptions[selectedCastingIndex]?.image.id}
                onUse={restoreSavedCastingOption}
                onRemove={(imageId) => setSavedCastingOptions((current) => current.filter((option) => option.image.id !== imageId))}
              />

              {selectedCastingIndex !== null && castingOptions[selectedCastingIndex] && (
                <div className="character-casting__approval">
                  <div><strong>Actor selected</strong><span>Next, design this actor’s wardrobe without changing their identity.</span></div>
                  <button type="button" className="element-generate__btn" onClick={() => { setRegenerationEditor(null); setCharacterStage('wardrobe'); setCharacterError(null); }}>
                    Continue to wardrobe
                  </button>
                </div>
              )}
            </section>
          )}

          {phase === 'idle' && characterStage === 'wardrobe' && selectedCastingIndex !== null && castingOptions[selectedCastingIndex] && (
            <section className="character-casting__stage">
              <div className="character-casting__wardrobe-layout">
                <div className="character-casting__actor-lock">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={castingOptions[selectedCastingIndex]!.image.url} alt="Selected actor" />
                  <div><span>Identity locked</span><strong>Selected actor</strong></div>
                </div>
                <div className="character-casting__wardrobe-form">
                  <div className="character-casting__stage-heading">
                    <div>
                      <span className="character-casting__eyebrow">Wardrobe fitting</span>
                      <h4>Dress the role</h4>
                      <p>Describe the complete outfit. The selected actor’s face and body stay locked.</p>
                    </div>
                    <div className="character-casting__count" aria-label="Number of wardrobe options">
                      <span>Looks</span>
                      {[1, 3, 5].map((count) => (
                        <button key={count} type="button" className={wardrobeCount === count ? 'character-casting__count-btn--active' : ''} onClick={() => setWardrobeCount(count)} disabled={characterBusy}>{count}</button>
                      ))}
                    </div>
                  </div>
                  <textarea
                    className="element-modal__textarea character-casting__wardrobe-input"
                    value={wardrobeDescription}
                    onChange={(event) => setWardrobeDescription(event.target.value)}
                    placeholder="e.g. Worn charcoal detective suit, pale blue shirt, loosened burgundy tie, dark leather shoes..."
                    rows={3}
                  />
                  <div className="character-casting__wardrobe-actions">
                    <button type="button" className="element-generate__regen-all-btn" onClick={() => { setRegenerationEditor(null); setCharacterStage('casting'); setCharacterError(null); }} disabled={isBusy}>Choose a different actor</button>
                    <button type="button" className="element-generate__regen-all-btn" onClick={() => handleBuildCharacterSheet(false)} disabled={isBusy}>Use current look</button>
                    <button type="button" className="element-generate__btn" onClick={() => void handleGenerateWardrobe()} disabled={!wardrobeDescription.trim() || isBusy}>
                      Generate {wardrobeCount} {wardrobeCount === 1 ? 'look' : 'looks'}
                    </button>
                  </div>
                </div>
              </div>

              {wardrobeOptions.length > 0 && (
                <div className="character-casting__options character-casting__options--wardrobe">
                  {wardrobeOptions.map((option, index) => {
                    const isSaved = !!option && visibleSavedWardrobeOptions.some((saved) => saved.image.id === option.image.id);
                    return (
                      <div key={option?.image.id ?? index} className={`character-casting__option ${selectedWardrobeIndex === index ? 'character-casting__option--selected' : ''}`}>
                        {option ? (
                          <>
                            <button type="button" className="character-casting__option-select" onClick={() => { setRegenerationEditor(null); setSelectedWardrobeIndex(index); }}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={option.image.url} alt={`Wardrobe look ${index + 1}`} />
                              <span>Look {index + 1}</span>
                            </button>
                            <div className="character-casting__option-actions">
                              <button
                                type="button"
                                className={`character-casting__option-save ${isSaved ? 'character-casting__option-save--active' : ''}`}
                                onClick={() => toggleSavedWardrobeOption(option)}
                                aria-pressed={isSaved}
                                title={isSaved ? 'Saved as a backup' : 'Save as a backup'}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill={isSaved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z" /></svg>
                              </button>
                              <button
                                type="button"
                                className="character-casting__option-regen"
                                onClick={() => setRegenerationEditor({ stage: 'wardrobe', index, note: '' })}
                                disabled={isBusy}
                                title={`Regenerate wardrobe look ${index + 1} with notes`}
                                aria-label={`Regenerate wardrobe look ${index + 1} with notes`}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
                              </button>
                            </div>
                          </>
                        ) : characterBusy ? (
                          <div className="character-casting__skeleton"><span /></div>
                        ) : (
                          <button type="button" className="character-casting__retry" onClick={() => void handleGenerateWardrobe(index)}>
                            <strong>Not generated</strong>
                            <span>Retry this look</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {regenerationEditor?.stage === 'wardrobe' && wardrobeOptions[regenerationEditor.index] && (
                <RegenerationNotesPanel
                  targetLabel={`Wardrobe look ${regenerationEditor.index + 1}`}
                  note={regenerationEditor.note}
                  suggestions={[
                    'Do not show any hands.',
                    'Keep the actor’s face unchanged.',
                    'Keep the same outfit and colors.',
                    'Remove all text and logos.',
                  ]}
                  busy={characterBusy}
                  onNoteChange={(note) => setRegenerationEditor((current) => current ? { ...current, note } : current)}
                  onClose={() => setRegenerationEditor(null)}
                  onSubmit={() => void submitCharacterRegeneration()}
                />
              )}

              <SavedOptionTray
                title="Saved wardrobe looks"
                description="These backups belong to the selected actor and survive new fittings."
                itemLabel="Look"
                options={visibleSavedWardrobeOptions}
                selectedImageId={selectedWardrobeIndex === null ? undefined : wardrobeOptions[selectedWardrobeIndex]?.image.id}
                onUse={restoreSavedWardrobeOption}
                onRemove={(imageId) => setSavedWardrobeOptions((current) => current.filter((saved) => saved.option.image.id !== imageId))}
              />

              {selectedWardrobeIndex !== null && wardrobeOptions[selectedWardrobeIndex] && (
                <div className="character-casting__approval">
                  <div><strong>Wardrobe approved</strong><span>Build the final continuity sheet from this exact actor and outfit.</span></div>
                  <button type="button" className="element-generate__btn" onClick={() => handleBuildCharacterSheet(true)} disabled={isBusy}>
                    Build character sheet
                  </button>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* Progress bar during generation */}
      {phase === 'generating' && (
        <div className="element-generate__expand-status">
          <span className="element-generate__phase-label">
            Generating panels ({generateProgress}/{totalPanels}) · {selectedModelOption?.providerLabel} · {selectedModelOption?.name}
          </span>
          <div className="element-generate__progress">
            <div className="element-generate__progress-bar" style={{ width: `${(generateProgress / totalPanels) * 100}%` }} />
          </div>
        </div>
      )}

      {/* Panel grid — visible during generating and review */}
      {(phase === 'generating' || phase === 'review') && (
        <div className="element-generate__results">
          {generationError && (
            <div className="element-generate__error" role="alert">
              <strong>{selectedModelOption?.providerLabel} could not start this generation.</strong>
              <span>{generationError}</span>
            </div>
          )}
          {phase === 'review' && (
            <div className="element-generate__results-header">
              <span className="element-generate__results-label">Hover a panel to regenerate it</span>
              <div className="element-generate__results-actions">
                <button type="button" className="element-generate__regen-all-btn" onClick={handleRegenerateAll} disabled={isBusy}>
                  {panels.some(Boolean) && panels.some((panel) => !panel) ? 'Continue Missing' : 'Regenerate All'}
                </button>
                <button type="button" className="element-generate__keep-all" onClick={handleKeepAll}>
                  Keep All
                </button>
              </div>
            </div>
          )}
          <div className="element-generate__sheet-grid">
            {panels.map((panel, i) => (
              <div key={i} className="element-generate__sheet-cell">
                {panel ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={panel.url} alt={labels[i]} className="element-generate__result-img" />
                    <span className="element-generate__panel-label">{labels[i]}</span>
                    {phase === 'review' && regeneratingIndex !== i && (
                      <div className="element-generate__panel-overlay">
                        <button
                          type="button"
                          className="element-generate__panel-regen-btn"
                          onClick={() => handleRegeneratePanel(i)}
                          disabled={isBusy}
                          title={`Regenerate ${labels[i]}`}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="23 4 23 10 17 10" />
                            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                          </svg>
                        </button>
                      </div>
                    )}
                    {regeneratingIndex === i && (
                      <div className="element-generate__panel-spinner">
                        <div className="element-generate__spinner" />
                      </div>
                    )}
                  </>
                ) : (
                  <div className="element-generate__panel-placeholder">
                    {panelErrors[i] ? (
                      <span className="element-generate__panel-error" title={panelErrors[i] ?? undefined}>
                        <strong>Failed</strong>
                        <small>{panelErrors[i]}</small>
                      </span>
                    ) : phase === 'generating' && i >= generateProgress ? (
                      <span className="element-generate__panel-pending">{labels[i]}</span>
                    ) : phase === 'generating' && i < generateProgress ? (
                      <span className="element-generate__panel-pending">Failed</span>
                    ) : phase === 'review' ? (
                      <span className="element-generate__panel-error">
                        <strong>No image</strong>
                        <small>Use Regenerate All to retry.</small>
                      </span>
                    ) : (
                      <div className="element-generate__spinner" />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
