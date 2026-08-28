import { ALL_MODELS } from '@/lib/fal/models';
import type { ModelDefinition } from '@/types/workflow';

export type ModelProvider = NonNullable<ModelDefinition['provider']>;

export const MODEL_PROVIDER_LABELS: Record<ModelProvider, string> = {
  topview: 'Topview AI',
  higgsfield: 'Higgsfield',
  fal: 'fal.ai',
  kie: 'kie.ai',
  local: 'Local',
  runpod: 'RunPod Serverless',
  pod: 'RunPod Session',
};

const MODEL_PROVIDER_PRIORITY: Record<ModelProvider, number> = {
  topview: 0,
  higgsfield: 1,
  fal: 2,
  kie: 3,
  runpod: 4,
  pod: 5,
  local: 6,
};

export interface ProviderModelOption {
  key: string;
  name: string;
  provider: ModelProvider;
  providerLabel: string;
  label: string;
}

export function modelProvider(model: ModelDefinition): ModelProvider {
  return model.provider ?? 'fal';
}

export function modelProviderLabel(model: ModelDefinition): string {
  return MODEL_PROVIDER_LABELS[modelProvider(model)];
}

export function providerModelOptions(
  categories: Array<ModelDefinition['category']>,
): ProviderModelOption[] {
  const allowed = new Set(categories);
  return Object.entries(ALL_MODELS)
    .filter(([, model]) => allowed.has(model.category))
    .map(([key, model]) => {
      const provider = modelProvider(model);
      const providerLabel = MODEL_PROVIDER_LABELS[provider];
      return {
        key,
        name: model.name,
        provider,
        providerLabel,
        label: `${providerLabel} · ${model.name}`,
      };
    })
    .sort((left, right) => (
      MODEL_PROVIDER_PRIORITY[left.provider] - MODEL_PROVIDER_PRIORITY[right.provider]
      || left.name.localeCompare(right.name)
      || left.key.localeCompare(right.key)
    ));
}

export function compareModelsByProvider(
  left: { type: string } | ModelDefinition,
  right: { type: string } | ModelDefinition,
): number {
  const leftModel = 'type' in left ? ALL_MODELS[left.type] : left;
  const rightModel = 'type' in right ? ALL_MODELS[right.type] : right;
  if (!leftModel || !rightModel) return Number(Boolean(rightModel)) - Number(Boolean(leftModel));
  const providerDifference = MODEL_PROVIDER_PRIORITY[modelProvider(leftModel)]
    - MODEL_PROVIDER_PRIORITY[modelProvider(rightModel)];
  return providerDifference || leftModel.name.localeCompare(rightModel.name);
}
