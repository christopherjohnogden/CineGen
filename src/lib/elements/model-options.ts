import { getModelDefinition } from '@/lib/fal/models';
import { providerModelOptions, type ModelProvider, type ProviderModelOption } from '@/lib/workflows/provider-model-options';

export const PREFERRED_ELEMENT_MODELS: Partial<Record<ModelProvider, string>> = {
  topview: 'topview-image-nano-banana-2',
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

