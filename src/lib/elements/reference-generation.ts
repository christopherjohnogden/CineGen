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



export const COMMON_SUFFIX = 'Use a clean, neutral plain background. Photographic style with even, consistent lighting, natural controlled shadows, and sharp details.';

export const REFERENCE_LOCK_INSTRUCTION = [
  'Treat every provided reference image as authoritative continuity for the same subject.',
  'Preserve the exact identity, face, body proportions, silhouette, colors, materials, clothing or construction details, markings, wear, and lighting language.',
  'Change only the requested camera angle, framing, or detail view. Do not redesign, add labels or text, or replace defining features.',
].join(' ');

export const CHARACTER_CASTING_SUFFIX = [
  'Create a professional full-body front casting photograph of one adult person, standing naturally and looking toward camera.',
  'The face must be fully visible and distinctive. Use simple neutral fitted casting clothes with no logos so identity, age, build, posture, and facial features are easy to judge.',
  'Plain warm-gray studio background, soft even light, realistic skin texture, photographic live-action film casting reference. One person only. No text, labels, collage, or split screen.',
].join(' ');

export const CASTING_IDENTITY_PROFILES = [
  'Lean, wiry proportions; a long angular face; narrow jaw; deep-set eyes; prominent cheekbones; an asymmetrical nose; and untamed medium-length hair.',
  'Solid, broad-shouldered proportions; a wide square face; strong jaw; heavy brow; wider-set eyes; a blunt nose; and dense short textured hair.',
  'Lanky proportions; a long oval face; high forehead; close-set observant eyes; a prominent curved nose; thinner lips; and a receding, tousled hairline.',
  'Compact proportions; a rounder face; softer jaw; fuller cheeks; hooded eyes; a short broad nose; and tightly cropped wavy or curly hair.',
  'Athletic proportions; a diamond-shaped face; defined cheekbones; wide-set eyes; a straight narrow nose; an uneven hairline; and shaggy layered hair.',
] as const;

export const CHARACTER_CASTING_REFERENCE_SUFFIX = [
  'Photograph the subject full body from the front, standing naturally and facing camera, with the face or head fully visible.',
  'Plain warm-gray studio background, soft even light, one subject only. No text, labels, collage, or split screen.',
].join(' ');

/**
 * Casting from uploaded references is the opposite job to a blind casting call.
 *
 * The blind prompt orders the model to invent a completely new identity and
 * hands it a differentiation profile — a face deliberately unlike the last one.
 * With references attached that fought the images and returned strangers, which
 * read as the references never being sent. Here the subject already exists, so
 * every option is that same subject and only the take changes.
 */
export function characterCastingFromReferencePrompt(description: string, optionIndex: number): string {
  return [
    'The attached reference images are the authoritative subject for this casting sheet.',
    'Reproduce that exact subject: the same head and face shape, features, markings, skin or surface colour and texture, proportions, hair, wardrobe, and any equipment or insignia.',
    'Do not invent a new identity, do not replace a non-human subject with a human interpretation, and do not redesign any defining feature.',
    `Supporting brief, for context only: ${description}.`,
    `This is take ${optionIndex + 1}. Keep the subject identical and vary only the pose, expression, and head angle a little.`,
    CHARACTER_CASTING_REFERENCE_SUFFIX,
  ].join(' ');
}

export function characterCastingPrompt(description: string, optionIndex: number, profileIndex: number): string {
  return [
    `Independent casting audition ${optionIndex + 1} for this role: ${description}.`,
    'Invent a completely new human identity, not a variation of a previous actor. Preserve any age, gender, and role requirements in the brief, but make the facial identity unmistakably different.',
    `Required visual differentiation for this audition: ${CASTING_IDENTITY_PROFILES[profileIndex % CASTING_IDENTITY_PROFILES.length]}`,
    'Do not default to the same conventionally handsome face. Preserve natural asymmetry, individual skin details, and believable imperfections that make this person castable and recognizable.',
    CHARACTER_CASTING_SUFFIX,
  ].join(' ');
}

export function characterWardrobePrompt(description: string, wardrobe: string, optionIndex: number): string {
  return [
    `Wardrobe test ${optionIndex + 1} for the exact person in the provided casting reference.`,
    `Keep their identity, face, hair, age, body, proportions, and skin completely unchanged. Dress them in: ${wardrobe}.`,
    `The role brief is: ${description}. Show a professional full-body front wardrobe fitting on a plain warm-gray studio background.`,
    'The clothing must fit naturally and be fully visible. Do not change the actor, add another person, add text, or create a collage.',
  ].join(' ');
}

export function characterCastingCorrectionPrompt(description: string, correction: string): string {
  return [
    `Create a corrected replacement casting image for this role: ${description}.`,
    'Use the provided rejected image as the authoritative source. Preserve the exact same actor identity, face, hair, age, body proportions, clothing, background, lighting, and photographic treatment unless the correction explicitly asks to change one of them.',
    `The previous result was rejected for this reason. Mandatory correction: ${correction}.`,
    'Make the requested correction clearly visible. Do not repeat the rejected detail. Treat negative directions such as do not show, remove, hide, or exclude as strict constraints.',
    'The correction is production direction, not visible content. Do not add the note as text, a label, caption, sign, or watermark in the image.',
    CHARACTER_CASTING_SUFFIX,
  ].join(' ');
}

export function characterWardrobeCorrectionPrompt(
  description: string,
  wardrobe: string,
  optionIndex: number,
  correction: string,
): string {
  return [
    characterWardrobePrompt(description, wardrobe, optionIndex),
    'Use the provided rejected wardrobe image as the primary visual source and the actor reference as the identity source. Preserve everything that is not explicitly named below.',
    `The previous result was rejected for this reason. Mandatory correction: ${correction}.`,
    'Make the requested correction clearly visible. Do not repeat the rejected detail. Treat negative directions such as do not show, remove, hide, or exclude as strict constraints.',
    'The correction is production direction, not visible content. Do not render it as text, a label, caption, sign, or watermark.',
  ].join(' ');
}

export interface GeneratedElementImage {
  url: string;
  referenceValue?: string;
}

export function orderedGeneratedPanels(panels: (ElementImage | null)[]): ElementImage[] {
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

export function buildIndividualPrompts(type: ElementType, description: string): string[] {
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

export function buildPanelLabels(type: ElementType): string[] {
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


export function extractResultUrl(result: unknown, path: string): string | undefined {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current: unknown = result;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : undefined;
}

export async function generateSingleImage(
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

export const PREFERRED_ELEMENT_MODELS: Partial<Record<ModelProvider, string>> = {
  topview: 'topview-image-gpt-image-2',
  higgsfield: 'hf-nano-banana-pro',
  fal: 'nano-banana-pro',
  kie: 'kie-nano-banana-pro',
  runpod: 'runpod-sdxl',
  pod: 'pod-sdxl',
};

export function preferredElementModel(
  options: ProviderModelOption[],
  provider: ModelProvider,
): ProviderModelOption | undefined {
  const preferredKey = PREFERRED_ELEMENT_MODELS[provider];
  return options.find((option) => option.provider === provider && option.key === preferredKey)
    ?? options.find((option) => option.provider === provider);
}

export function elementGenerationModelOptions(): ProviderModelOption[] {
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

