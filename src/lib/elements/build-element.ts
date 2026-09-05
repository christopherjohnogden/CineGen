import type { Element, ElementVariation, ElementVariationKind } from '@/types/elements';
import { materializeElementLooks } from './variations';
import { buildIndividualPrompts, generateSingleImage, elementGenerationModelOptions } from './reference-generation';
import { prepareElementReferences } from '@/lib/cloud/elements';

export interface ReferenceBuild {
  mode: 'generate' | 'guide' | 'upload';
  model?: string;
  provider?: string;
  prompt?: string;
  guideImages?: string[];
  uploadUrls?: string[];
  workingLook?: string;
  views?: number;
}
export interface ElementBuildRequest {
  elementId?: string;
  name?: string;
  type?: Element['type'];
  description?: string;
  reference: ReferenceBuild;
  variations?: Array<{ name: string; kind: ElementVariationKind; description: string; reference: ReferenceBuild }>;
}
export async function buildElementDraft(
  request: ElementBuildRequest,
  existing: Element | undefined,
  projectId: string,
  progress: (draft: Element) => void = () => {},
): Promise<Element> {
  const now = new Date().toISOString();
  let draft = materializeElementLooks(structuredClone(existing ?? {
    id: crypto.randomUUID(), name: request.name ?? '', type: request.type ?? 'character',
    description: request.description ?? '', images: [], createdAt: now, updatedAt: now,
  }));
  draft = { ...draft, name: request.name ?? draft.name, type: request.type ?? draft.type, description: request.description ?? draft.description };
  if (!draft.name.trim()) throw new Error('An Element name is required.');
  const validate = (ref: ReferenceBuild) => {
    if (ref.mode === 'upload') {
      if (!ref.uploadUrls?.length) throw new Error('uploadUrls is required for uploaded references.');
    } else {
      if (!ref.model) throw new Error('Choose an image model from cinegen_element_models.');
      const option = elementGenerationModelOptions().find(model => model.key === ref.model);
      if (!option || (ref.provider && option.provider !== ref.provider)) throw new Error('Unknown or mismatched Element image model/provider.');
      if (ref.mode === 'guide' && !ref.guideImages?.length) throw new Error('guideImages is required for guided generation.');
    }
  };
  const names = (request.variations ?? []).map(look => look.name);
  if (new Set(names).size !== names.length || names.some(name => draft.variations!.some(look => look.name === name) || (!existing && name === request.reference.workingLook))) throw new Error('Continuity look names must be unique.');
  validate(request.reference);
  for (const variation of request.variations ?? []) validate(variation.reference);
  const build = async (look: ElementVariation, ref: ReferenceBuild, anchors: string[]) => {
    if (ref.mode === 'upload') {
      look.images = ref.uploadUrls!.map(url => ({ id: crypto.randomUUID(), url, createdAt: now, source: 'upload' }));
    } else {
      const prompts = buildIndividualPrompts(draft.type, [draft.description, look.kind === 'baseline' ? '' : look.description, ref.prompt].filter(Boolean).join('. ')).slice(0, ref.views ?? 7);
      let anchor: string | undefined;
      let previous: string | undefined;
      look.images = [];
      for (const prompt of prompts) {
        const refs = [...new Set([...anchors, ...(ref.guideImages ?? []), ...(anchor ? [anchor] : []), ...(previous ? [previous] : [])])];
        const image = await generateSingleImage(prompt, ref.model!, refs.length ? refs : undefined);
        anchor ??= image.referenceValue ?? image.url;
        previous = image.referenceValue ?? image.url;
        look.images.push({ id: crypto.randomUUID(), url: image.url, createdAt: new Date().toISOString(), source: 'generated' });
        progress(structuredClone(draft));
      }
    }
    look.updatedAt = new Date().toISOString();
    draft.images = draft.variations!.find(look => look.id === draft.activeVariationId)!.images;
    draft = await prepareElementReferences(draft, projectId);
    progress(structuredClone(draft));
  };
  const working = request.reference.workingLook;
  if (working && !existing) draft.variations![0].name = working;
  const look = working ? draft.variations!.find(look => look.id === working || look.name === working) : draft.variations!.find(look => look.id === draft.activeVariationId);
  if (!look) throw new Error('Unknown working look. Read the Element before choosing a look.');
  const baselineImages = look.images.map(image => image.url);
  await build(look, request.reference, baselineImages);
  for (const requested of request.variations ?? []) {
    if (draft.variations!.some(look => look.name === requested.name)) throw new Error(`A look named ${requested.name} already exists.`);
    const look: ElementVariation = { id: crypto.randomUUID(), name: requested.name, kind: requested.kind, description: requested.description, images: [], sourceVariationId: draft.activeVariationId, createdAt: now, updatedAt: now };
    draft.variations!.push(look);
    await build(look, requested.reference, draft.images.map(image => image.url));
  }
  draft.updatedAt = new Date().toISOString();
  return draft;
}
