

import { useState, useCallback, useEffect, useMemo } from 'react';
import type { ElementType, ElementImage } from '@/types/elements';
import {
  getApiKey,
  getKieApiKey,
  getPodUrl,
  getRunpodApiKey,
  getRunpodEndpointId,
} from '@/lib/utils/api-key';
import { runWorkflow } from '@/lib/cloud/funding';
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
}

type Phase = 'idle' | 'generating' | 'review';
type CharacterStage = 'casting' | 'wardrobe' | 'sheet';

interface CharacterOption {
  image: ElementImage;
  referenceValue?: string;
  castingProfileIndex?: number;
}

const COMMON_SUFFIX = 'Use a clean, neutral plain background. Photographic style with even, consistent lighting, natural controlled shadows, and sharp details.';

const REFERENCE_LOCK_INSTRUCTION = [
  'Treat every provided reference image as authoritative continuity for the same subject.',
  'Preserve the exact identity, face, body proportions, silhouette, colors, materials, clothing or construction details, markings, wear, and lighting language.',
  'Change only the requested camera angle, framing, or detail view. Do not redesign, add labels or text, or replace defining features.',
].join(' ');

const CHARACTER_CASTING_SUFFIX = [
  'Create a professional full-body front casting photograph of one adult person, standing naturally and looking toward camera.',
  'The face must be fully visible and distinctive. Use simple neutral fitted casting clothes with no logos so identity, age, build, posture, and facial features are easy to judge.',
  'Plain warm-gray studio background, soft even light, realistic skin texture, photographic live-action film casting reference. One person only. No text, labels, collage, or split screen.',
].join(' ');

const CASTING_IDENTITY_PROFILES = [
  'Lean, wiry proportions; a long angular face; narrow jaw; deep-set eyes; prominent cheekbones; an asymmetrical nose; and untamed medium-length hair.',
  'Solid, broad-shouldered proportions; a wide square face; strong jaw; heavy brow; wider-set eyes; a blunt nose; and dense short textured hair.',
  'Lanky proportions; a long oval face; high forehead; close-set observant eyes; a prominent curved nose; thinner lips; and a receding, tousled hairline.',
  'Compact proportions; a rounder face; softer jaw; fuller cheeks; hooded eyes; a short broad nose; and tightly cropped wavy or curly hair.',
  'Athletic proportions; a diamond-shaped face; defined cheekbones; wide-set eyes; a straight narrow nose; an uneven hairline; and shaggy layered hair.',
] as const;

function characterCastingPrompt(description: string, optionIndex: number, profileIndex: number): string {
  return [
    `Independent casting audition ${optionIndex + 1} for this role: ${description}.`,
    'Invent a completely new human identity, not a variation of a previous actor. Preserve any age, gender, and role requirements in the brief, but make the facial identity unmistakably different.',
    `Required visual differentiation for this audition: ${CASTING_IDENTITY_PROFILES[profileIndex % CASTING_IDENTITY_PROFILES.length]}`,
    'Do not default to the same conventionally handsome face. Preserve natural asymmetry, individual skin details, and believable imperfections that make this person castable and recognizable.',
    CHARACTER_CASTING_SUFFIX,
  ].join(' ');
}

function characterWardrobePrompt(description: string, wardrobe: string, optionIndex: number): string {
  return [
    `Wardrobe test ${optionIndex + 1} for the exact person in the provided casting reference.`,
    `Keep their identity, face, hair, age, body, proportions, and skin completely unchanged. Dress them in: ${wardrobe}.`,
    `The role brief is: ${description}. Show a professional full-body front wardrobe fitting on a plain warm-gray studio background.`,
    'The clothing must fit naturally and be fully visible. Do not change the actor, add another person, add text, or create a collage.',
  ].join(' ');
}

interface GeneratedElementImage {
  url: string;
  referenceValue?: string;
}

function orderedGeneratedPanels(panels: (ElementImage | null)[]): ElementImage[] {
  const kept = panels.filter((panel): panel is ElementImage => panel !== null);
  // Prefer the front portrait as the character card thumbnail when the complete
  // seven-panel sheet is available. Preserve the generation order otherwise.
  const portraitIndex = 4;
  if (kept.length > portraitIndex) {
    const [portrait] = kept.splice(portraitIndex, 1);
    kept.unshift(portrait);
  }
  return kept;
}

function buildIndividualPrompts(type: ElementType, description: string): string[] {
  switch (type) {
    case 'character':
      return [
        `Full-body front view of ${description} standing in a relaxed A-pose. ${COMMON_SUFFIX}`,
        `Full-body left profile view of ${description} standing in a relaxed A-pose, facing left. ${COMMON_SUFFIX}`,
        `Full-body right profile view of ${description} standing in a relaxed A-pose, facing right. ${COMMON_SUFFIX}`,
        `Full-body back view of ${description} standing in a relaxed A-pose, seen from behind. ${COMMON_SUFFIX}`,
        `Highly detailed close-up front portrait of ${description}, head and shoulders. ${COMMON_SUFFIX}`,
        `Highly detailed close-up left profile portrait of ${description}, head and shoulders, facing left. ${COMMON_SUFFIX}`,
        `Highly detailed close-up right profile portrait of ${description}, head and shoulders, facing right. ${COMMON_SUFFIX}`,
      ];

    case 'location':
      return [
        `Wide establishing front/entrance view of ${description}. ${COMMON_SUFFIX}`,
        `Wide establishing view of ${description} from a 45-degree left angle. ${COMMON_SUFFIX}`,
        `Wide establishing view of ${description} from a 45-degree right angle. ${COMMON_SUFFIX}`,
        `Aerial overhead view of ${description}. ${COMMON_SUFFIX}`,
        `Detailed close-up of key architectural or environmental detail of ${description}. ${COMMON_SUFFIX}`,
        `Detailed close-up of textures and materials of ${description}. ${COMMON_SUFFIX}`,
        `Atmospheric mood shot of ${description} showing time-of-day lighting. ${COMMON_SUFFIX}`,
      ];

    case 'prop':
      return [
        `Front view of ${description} on a neutral background. ${COMMON_SUFFIX}`,
        `Left side view of ${description}, rotated 90 degrees. ${COMMON_SUFFIX}`,
        `Right side view of ${description}, rotated 90 degrees. ${COMMON_SUFFIX}`,
        `Back view of ${description} on a neutral background. ${COMMON_SUFFIX}`,
        `Top-down view of ${description} showing full detail. ${COMMON_SUFFIX}`,
        `Detailed close-up of key detail or mechanism of ${description}. ${COMMON_SUFFIX}`,
        `Detailed close-up of texture and material surface of ${description}. ${COMMON_SUFFIX}`,
      ];

    case 'vehicle':
      return [
        `Front head-on view of ${description} on a neutral background. ${COMMON_SUFFIX}`,
        `Left profile view (driver side) of ${description}. ${COMMON_SUFFIX}`,
        `Right profile view (passenger side) of ${description}. ${COMMON_SUFFIX}`,
        `Rear view of ${description} on a neutral background. ${COMMON_SUFFIX}`,
        `Three-quarter front hero angle view of ${description}. ${COMMON_SUFFIX}`,
        `Interior cockpit view of ${description}. ${COMMON_SUFFIX}`,
        `Detailed close-up of a key defining feature of ${description} (engine, wheels, or signature detail). ${COMMON_SUFFIX}`,
      ];
  }
}

function buildPanelLabels(type: ElementType): string[] {
  switch (type) {
    case 'character':
      return ['Front', 'Left Profile', 'Right Profile', 'Back', 'Front Portrait', 'Left Portrait', 'Right Portrait'];
    case 'location':
      return ['Front/Entrance', 'Left Angle', 'Right Angle', 'Aerial', 'Key Detail', 'Textures', 'Atmosphere'];
    case 'prop':
      return ['Front', 'Left Side', 'Right Side', 'Back', 'Top-Down', 'Detail', 'Texture'];
    case 'vehicle':
      return ['Front', 'Left Profile', 'Right Profile', 'Rear', 'Hero Angle', 'Interior', 'Key Detail'];
  }
}


function extractResultUrl(result: unknown, path: string): string | undefined {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current: unknown = result;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : undefined;
}

async function generateSingleImage(
  prompt: string,
  modelKey: string,
  referenceUrls?: string[],
): Promise<GeneratedElementImage> {
  const model = getModelDefinition(modelKey);
  if (!model || model.outputType !== 'image') throw new Error('The selected image model is unavailable.');
  const refs = referenceUrls ?? [];
  const isEdit = refs.length > 0;

  const inputs: Record<string, unknown> = {
    prompt: isEdit
      ? `${prompt} ${REFERENCE_LOCK_INSTRUCTION}`
      : prompt,
  };

  const resolutionField = model.inputs.find((field) => field.id === 'resolution');
  if (resolutionField) inputs.resolution = resolutionField.options?.some((option) => option.value === '1K') ? '1K' : resolutionField.default;
  const aspectField = model.inputs.find((field) => field.id === 'aspect_ratio');
  if (aspectField) inputs.aspect_ratio = aspectField.options?.some((option) => option.value === '1:1') ? '1:1' : aspectField.default;
  const imageSizeField = model.inputs.find((field) => field.id === 'image_size');
  if (imageSizeField) inputs.image_size = imageSizeField.options?.some((option) => option.value === 'square_hd') ? 'square_hd' : imageSizeField.default;
  if (model.inputs.some((field) => field.id === 'seed')) inputs.seed = Math.floor(Math.random() * 999999);

  if (isEdit) {
    if (model.provider === 'topview') {
      inputs.image_urls = refs;
    } else {
      const imageField = model.inputs.find((field) => field.portType === 'image' && field.fieldType === 'port');
      const extraField = model.inputs.find((field) => field.portType === 'image' && field.fieldType === 'element-list');
      if (imageField) {
        inputs[imageField.falParam] = imageField.multiple || imageField.falParam.endsWith('s') ? refs : refs[0];
      }
      if (extraField && !(imageField?.multiple || imageField?.falParam.endsWith('s'))) {
        inputs[extraField.falParam] = refs.slice(1);
      }
    }
  }

  const data = await runWorkflow({
    apiKey: getApiKey(),
    kieKey: getKieApiKey(),
    runpodKey: getRunpodApiKey(),
    runpodEndpointId: getRunpodEndpointId(modelKey),
    podUrl: getPodUrl(),
    nodeId: 'element-gen',
    nodeType: modelKey,
    modelId: isEdit ? model.altId ?? model.id : model.id,
    outputType: 'image',
    inputs,
  });
  const result = (data as Record<string, unknown>)?.data ?? data;
  const url = extractResultUrl(result, model.responseMapping.path);
  if (!url) throw new Error(`${model.name} finished without returning an image.`);
  const referenceValue = typeof (result as Record<string, unknown>)?.referenceValue === 'string'
    ? String((result as Record<string, unknown>).referenceValue)
    : undefined;
  return { url, referenceValue };
}

const PREFERRED_ELEMENT_MODELS: Partial<Record<ModelProvider, string>> = {
  topview: 'topview-image-gpt-image-2',
  higgsfield: 'hf-nano-banana-pro',
  fal: 'nano-banana-pro',
  kie: 'kie-nano-banana-pro',
  runpod: 'runpod-sdxl',
  pod: 'pod-sdxl',
};

function preferredElementModel(
  options: ProviderModelOption[],
  provider: ModelProvider,
): ProviderModelOption | undefined {
  const preferredKey = PREFERRED_ELEMENT_MODELS[provider];
  return options.find((option) => option.provider === provider && option.key === preferredKey)
    ?? options.find((option) => option.provider === provider);
}

function elementGenerationModelOptions(): ProviderModelOption[] {
  return providerModelOptions(['image', 'image-edit']).filter((option) => {
    const model = getModelDefinition(option.key);
    if (!model || model.outputType !== 'image') return false;
    const hasPrompt = model.inputs.some((field) => field.id === 'prompt' || field.falParam === 'prompt');
    if (!hasPrompt) return false;
    return model.inputs
      .filter((field) => field.required)
      .every((field) => field.id === 'prompt' || field.falParam === 'prompt');
  });
}

export function ElementGenerate({
  elementType,
  description,
  onGenerated,
  onPendingGeneratedChange,
  onBusyChange,
  onCharacterWorkflowStateChange,
  referenceImages,
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
  const [wardrobeDescription, setWardrobeDescription] = useState('');
  const [wardrobeCount, setWardrobeCount] = useState(1);
  const [wardrobeOptions, setWardrobeOptions] = useState<(CharacterOption | null)[]>([]);
  const [selectedWardrobeIndex, setSelectedWardrobeIndex] = useState<number | null>(null);
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

  const handleGenerateCasting = useCallback(async (regenerateIndex?: number) => {
    if (!desc || !selectedModelOption) return;
    const total = regenerateIndex === undefined ? castingCount : Math.max(castingOptions.length, castingCount);
    const next = regenerateIndex === undefined
      ? new Array<CharacterOption | null>(total).fill(null)
      : Array.from({ length: total }, (_, index) => castingOptions[index] ?? null);
    const targets = regenerateIndex === undefined
      ? Array.from({ length: total }, (_, index) => index)
      : [regenerateIndex];
    if (regenerateIndex !== undefined) next[regenerateIndex] = null;

    setCharacterBusy(true);
    setCharacterError(null);
    setCastingOptions([...next]);
    if (regenerateIndex === undefined || selectedCastingIndex === regenerateIndex) setSelectedCastingIndex(null);
    setCharacterProgress({ done: 0, total: targets.length, label: 'Auditioning actors' });

    let failures = 0;
    for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
      const index = targets[targetIndex];
      const previousProfileIndex = castingOptions[index]?.castingProfileIndex;
      const profileIndex = regenerateIndex === undefined
        ? ((previousProfileIndex ?? index) + (castingOptions.some(Boolean) ? 1 : 0)) % CASTING_IDENTITY_PROFILES.length
        : ((previousProfileIndex ?? index) + 1) % CASTING_IDENTITY_PROFILES.length;
      try {
        const generated = await generateSingleImage(
          characterCastingPrompt(desc, index, profileIndex),
          selectedModel,
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
  }, [castingCount, castingOptions, desc, selectedCastingIndex, selectedModel, selectedModelOption]);

  const handleGenerateWardrobe = useCallback(async (regenerateIndex?: number) => {
    const actor = selectedCastingIndex === null ? null : castingOptions[selectedCastingIndex];
    const wardrobe = wardrobeDescription.trim();
    if (!actor || !wardrobe || !selectedModelOption) return;
    const total = regenerateIndex === undefined ? wardrobeCount : Math.max(wardrobeOptions.length, wardrobeCount);
    const next = regenerateIndex === undefined
      ? new Array<CharacterOption | null>(total).fill(null)
      : Array.from({ length: total }, (_, index) => wardrobeOptions[index] ?? null);
    const targets = regenerateIndex === undefined
      ? Array.from({ length: total }, (_, index) => index)
      : [regenerateIndex];
    if (regenerateIndex !== undefined) next[regenerateIndex] = null;

    setCharacterBusy(true);
    setCharacterError(null);
    setWardrobeOptions([...next]);
    if (regenerateIndex === undefined || selectedWardrobeIndex === regenerateIndex) setSelectedWardrobeIndex(null);
    setCharacterProgress({ done: 0, total: targets.length, label: 'Fitting wardrobe' });
    const actorReference = actor.referenceValue ?? actor.image.url;

    let failures = 0;
    for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
      const index = targets[targetIndex];
      try {
        const generated = await generateSingleImage(
          characterWardrobePrompt(desc, wardrobe, index),
          selectedModel,
          [actorReference],
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
  }, [castingOptions, desc, selectedCastingIndex, selectedModel, selectedModelOption, selectedWardrobeIndex, wardrobeCount, wardrobeDescription, wardrobeOptions]);

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
      setWardrobeOptions([]);
      setSelectedWardrobeIndex(null);
      setWardrobeDescription('');
    }
  };

  return (
    <div className="element-generate">
      {/* Input row — visible in idle */}
      {phase === 'idle' && elementType !== 'character' && (
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

      {elementType === 'character' && (
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
                  <h4>Find the actor</h4>
                  <p>Generate distinct people from the casting brief, then select the face and body that fit the role.</p>
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
                  {castingOptions.some(Boolean) ? `Cast ${castingCount} new actors` : `Generate ${castingCount} ${castingCount === 1 ? 'actor' : 'actors'}`}
                </button>
              </div>

              {castingOptions.length > 0 && (
                <div className="character-casting__options">
                  {castingOptions.map((option, index) => (
                    <div key={option?.image.id ?? index} className={`character-casting__option ${selectedCastingIndex === index ? 'character-casting__option--selected' : ''}`}>
                      {option ? (
                        <>
                          <button type="button" className="character-casting__option-select" onClick={() => setSelectedCastingIndex(index)}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={option.image.url} alt={`Casting option ${index + 1}`} />
                            <span>Option {index + 1}</span>
                          </button>
                          <button type="button" className="character-casting__option-regen" onClick={() => void handleGenerateCasting(index)} disabled={isBusy} title={`Regenerate casting option ${index + 1}`}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
                          </button>
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
                  ))}
                </div>
              )}

              {selectedCastingIndex !== null && castingOptions[selectedCastingIndex] && (
                <div className="character-casting__approval">
                  <div><strong>Actor selected</strong><span>Next, design this actor’s wardrobe without changing their identity.</span></div>
                  <button type="button" className="element-generate__btn" onClick={() => { setCharacterStage('wardrobe'); setCharacterError(null); }}>
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
                    <button type="button" className="element-generate__regen-all-btn" onClick={() => { setCharacterStage('casting'); setCharacterError(null); }} disabled={isBusy}>Choose a different actor</button>
                    <button type="button" className="element-generate__regen-all-btn" onClick={() => handleBuildCharacterSheet(false)} disabled={isBusy}>Use current look</button>
                    <button type="button" className="element-generate__btn" onClick={() => void handleGenerateWardrobe()} disabled={!wardrobeDescription.trim() || isBusy}>
                      Generate {wardrobeCount} {wardrobeCount === 1 ? 'look' : 'looks'}
                    </button>
                  </div>
                </div>
              </div>

              {wardrobeOptions.length > 0 && (
                <div className="character-casting__options character-casting__options--wardrobe">
                  {wardrobeOptions.map((option, index) => (
                    <div key={option?.image.id ?? index} className={`character-casting__option ${selectedWardrobeIndex === index ? 'character-casting__option--selected' : ''}`}>
                      {option ? (
                        <>
                          <button type="button" className="character-casting__option-select" onClick={() => setSelectedWardrobeIndex(index)}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={option.image.url} alt={`Wardrobe look ${index + 1}`} />
                            <span>Look {index + 1}</span>
                          </button>
                          <button type="button" className="character-casting__option-regen" onClick={() => void handleGenerateWardrobe(index)} disabled={isBusy} title={`Regenerate wardrobe look ${index + 1}`}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
                          </button>
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
                  ))}
                </div>
              )}

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
