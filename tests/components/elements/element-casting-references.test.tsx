import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ElementImage } from '@/types/elements';
import type { ModelDefinition } from '@/types/workflow';

const model = vi.hoisted(() => ({
  id: 'gpt-image-2',
  altId: 'gpt-image-2-edit',
  nodeType: 'topview-image-gpt-image-2',
  name: 'GPT Image 2',
  category: 'image',
  provider: 'topview',
  outputType: 'image',
  responseMapping: { path: 'url' },
  inputs: [
    { id: 'prompt', portType: 'text', label: 'Prompt', required: true, falParam: 'prompt', fieldType: 'port' },
    { id: 'aspect_ratio', portType: 'text', label: 'Aspect', required: false, falParam: 'aspect_ratio', fieldType: 'select', options: [{ value: '1:1', label: '1:1' }] },
  ],
}) as unknown as ModelDefinition);

const runWorkflow = vi.hoisted(() => vi.fn(async () => ({ url: 'https://media.example/out.png' })));

vi.mock('@/lib/cloud/funding', () => ({ runWorkflow }));
vi.mock('@/lib/fal/models', () => ({ getModelDefinition: () => model }));
vi.mock('@/lib/workflows/provider-model-options', () => ({
  MODEL_PROVIDER_LABELS: { topview: 'Topview AI' },
  providerModelOptions: () => [{ key: 'topview-image-gpt-image-2', label: 'Topview AI · GPT Image 2', provider: 'topview', name: 'GPT Image 2' }],
}));
vi.mock('@/components/create/use-topview-model-catalog', () => ({ useTopviewModelCatalogVersion: () => 1 }));
vi.mock('@/lib/utils/api-key', () => ({
  getApiKey: () => '', getKieApiKey: () => '', getPodUrl: () => '',
  getRunpodApiKey: () => '', getRunpodEndpointId: () => '',
}));

import { ElementGenerate } from '@/components/elements/element-generate';

/** What an uploaded reference looks like with no fal key: a local file, not a blob. */
const UPLOADED: ElementImage = {
  id: 'ref-1',
  url: 'local-media://file/Users/chris/Library/CineGen/media/elements/alien.png',
  createdAt: '2026-09-02T00:00:00.000Z',
  source: 'upload',
};

const BRIEF = 'An alien mascot in a number 67 college football jersey.';

function renderGenerate(referenceImages: ElementImage[]) {
  return render(
    <ElementGenerate
      elementType="character"
      description={BRIEF}
      onGenerated={vi.fn()}
      referenceImages={referenceImages}
    />,
  );
}

function lastCall() {
  const call = runWorkflow.mock.calls.at(-1)?.[0] as { inputs: Record<string, unknown> } | undefined;
  if (!call) throw new Error('runWorkflow was never called.');
  return { inputs: call.inputs, prompt: String(call.inputs.prompt ?? '') };
}

describe('casting from uploaded reference images', () => {
  beforeEach(() => { runWorkflow.mockClear(); });
  afterEach(cleanup);

  it('sends the uploaded images to the provider as references', async () => {
    renderGenerate([UPLOADED]);

    fireEvent.click(screen.getByRole('button', { name: /^Generate \d+ takes?$/ }));

    await waitFor(() => expect(runWorkflow).toHaveBeenCalled());
    // The user's complaint was that their images never reached the model.
    expect(lastCall().inputs.image_urls).toEqual([UPLOADED.url]);
  });

  it('asks for the subject in the references instead of a newly invented identity', async () => {
    renderGenerate([UPLOADED]);

    fireEvent.click(screen.getByRole('button', { name: /^Generate \d+ takes?$/ }));
    await waitFor(() => expect(runWorkflow).toHaveBeenCalled());
    const { prompt } = lastCall();

    expect(prompt).toContain('authoritative subject');
    expect(prompt).toContain('Reproduce that exact subject');
    // The blind-casting instructions are what made it return strangers.
    expect(prompt).not.toContain('Invent a completely new human identity');
    expect(prompt).not.toContain('unmistakably different');
    // A non-human subject must not be turned into a person.
    expect(prompt).not.toContain('one adult person');
    expect(prompt).toContain('do not replace a non-human subject with a human interpretation');
  });

  it('still runs a blind casting call when no references were uploaded', async () => {
    renderGenerate([]);

    fireEvent.click(screen.getByRole('button', { name: /^Generate \d+ actors?$/ }));
    await waitFor(() => expect(runWorkflow).toHaveBeenCalled());
    const { inputs, prompt } = lastCall();

    expect(inputs.image_urls).toBeUndefined();
    expect(prompt).toContain('Invent a completely new human identity');
  });

  it('says it is rendering the subject, not casting strangers, once references exist', () => {
    const view = renderGenerate([UPLOADED]);
    expect(screen.getByRole('heading', { name: 'Render the subject' })).toBeInTheDocument();
    expect(screen.getByText(/Your reference images are the subject/)).toBeInTheDocument();

    view.unmount();
    renderGenerate([]);
    expect(screen.getByRole('heading', { name: 'Find the actor' })).toBeInTheDocument();
  });
});
