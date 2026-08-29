import type { Element } from '@/types/elements';
import type { ModelDefinition, WorkflowNodeData } from '@/types/workflow';
import { resolveElementNodeIds } from './node-registry';

export type StoryboarderReferenceKind = 'content' | 'style';

export interface StoryboarderReference {
  url: string;
  kind: StoryboarderReferenceKind;
  label: string;
  elementType?: Element['type'];
}

const ELEMENT_PRIORITY: Record<Element['type'], number> = {
  location: 0,
  character: 1,
  prop: 2,
  vehicle: 3,
};

function uniqueReferences(references: StoryboarderReference[]): StoryboarderReference[] {
  const seen = new Set<string>();
  return references.filter((reference) => {
    const url = reference.url.trim();
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

function nodeImageUrl(data: WorkflowNodeData): string | undefined {
  const activeGeneration = typeof data.activeGeneration === 'number'
    ? data.generations?.[data.activeGeneration]
    : undefined;
  const candidates = [
    activeGeneration,
    data.result?.url,
    data.config?.fileUrl,
    data.config?.url,
    data.config?.imageUrl,
  ];
  return candidates.find((candidate): candidate is string => typeof candidate === 'string' && Boolean(candidate.trim()));
}

/** Resolve connected image and Element nodes into a stable, labelled reference set. */
export function collectStoryboarderReferences(
  sources: WorkflowNodeData[],
  elements: Element[],
  kind: StoryboarderReferenceKind,
): StoryboarderReference[] {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const direct: StoryboarderReference[] = [];
  const connectedElements: Element[] = [];

  for (const source of sources) {
    if (source.type === 'element') {
      for (const elementId of resolveElementNodeIds(source.config)) {
        const element = byId.get(elementId);
        if (element?.images.length) connectedElements.push(element);
      }
      continue;
    }
    const url = nodeImageUrl(source);
    if (url) direct.push({
      url,
      kind,
      label: typeof source.label === 'string' && source.label.trim()
        ? source.label.trim()
        : kind === 'style' ? 'Style reference' : 'Visual reference',
    });
  }

  const orderedElements = [...new Map(connectedElements.map((element) => [element.id, element])).values()]
    .sort((left, right) => ELEMENT_PRIORITY[left.type] - ELEMENT_PRIORITY[right.type]);
  const elementReferences: StoryboarderReference[] = [];
  const maxViews = Math.max(0, ...orderedElements.map((element) => element.images.length));
  // One image from every connected Element is emitted before alternate views,
  // so a character cannot crowd a location or prop out of the reference set.
  for (let imageIndex = 0; imageIndex < maxViews; imageIndex += 1) {
    for (const element of orderedElements) {
      const image = element.images[imageIndex];
      if (!image) continue;
      elementReferences.push({
        url: image.url,
        kind,
        label: element.name,
        elementType: element.type,
      });
    }
  }

  return uniqueReferences([...direct, ...elementReferences]);
}

export function storyboarderReferenceLimit(model: ModelDefinition): number {
  if (model.provider === 'topview') return 16;
  const imageFields = model.inputs.filter((field) => field.portType === 'image');
  if (imageFields.length === 0) return 0;
  const expandable = imageFields.find((field) => field.fieldType === 'element-list');
  if (expandable?.max) return 1 + expandable.max;
  if (imageFields.some((field) => field.multiple || field.falParam.endsWith('s'))) return 16;
  return 1;
}

export function selectStoryboarderReferences(
  content: StoryboarderReference[],
  style: StoryboarderReference[],
  limit: number,
): StoryboarderReference[] {
  if (limit <= 0) return [];
  if (style.length === 0) return uniqueReferences(content).slice(0, limit);
  if (content.length === 0) return uniqueReferences(style).slice(0, limit);
  if (limit === 1) return uniqueReferences(content).slice(0, 1);
  const styleSlots = Math.min(style.length, 4, Math.max(1, limit - 1));
  return uniqueReferences([
    ...content.slice(0, limit - styleSlots),
    ...style.slice(0, styleSlots),
  ]).slice(0, limit);
}

export function storyboarderImagePrompt(
  shotPrompt: string,
  references: StoryboarderReference[],
  styleDirection: string,
): string {
  const content = references
    .map((reference, index) => ({ reference, picture: index + 1 }))
    .filter(({ reference }) => reference.kind === 'content');
  const style = references
    .map((reference, index) => ({ reference, picture: index + 1 }))
    .filter(({ reference }) => reference.kind === 'style');
  const sections = [`FRAME DIRECTION\n${shotPrompt.trim()}`];

  if (content.length) {
    sections.push([
      'CONTINUITY REFERENCES — use every listed picture as an authoritative identity or setting lock:',
      ...content.map(({ reference, picture }) => (
        `Picture ${picture}: ${reference.elementType ? `${reference.elementType} ` : ''}"${reference.label}". Preserve its recognizable identity, design, proportions, wardrobe, materials, colors, and spatial character.`
      )),
      'Combine these references into one coherent photographic frame. Do not omit one reference because another is more visually prominent.',
    ].join('\n'));
  }

  const cleanedStyle = styleDirection.trim();
  if (cleanedStyle || style.length) {
    sections.push([
      'STYLE LOCK',
      ...(cleanedStyle ? [`Written direction: ${cleanedStyle}`] : []),
      ...style.map(({ reference, picture }) => (
        `Picture ${picture}: style reference "${reference.label}". Borrow only its lighting, color science, contrast, lens character, texture, composition language, and atmosphere; do not copy its people, objects, logos, or text.`
      )),
      'Keep this visual language consistent with every other frame in the storyboard.',
    ].join('\n'));
  }

  sections.push('Render one live-action cinematic still. Do not render labels, reference names, picture numbers, mention tags, captions, subtitles, watermarks, or interface text.');
  return sections.join('\n\n');
}
