import type { ModelDefinition, ModelInputField } from '@/types/workflow';

/**
 * Which input of a model plays which role.
 *
 * Model catalogues name the same thing a dozen ways (`image_url`, `init_image`,
 * `reference_images`, `first_frame`), so every surface that has to fill a model
 * in — the Studio composer, the MCP tools — resolves fields through here rather
 * than matching ids of its own.
 */

export function isPromptField(field: ModelInputField): boolean {
  return field.fieldType === 'port'
    && field.portType === 'text'
    && /prompt|text/i.test(`${field.id} ${field.falParam} ${field.label}`);
}

export function promptFieldFor(model: ModelDefinition): ModelInputField | undefined {
  return model.inputs.find((field) => isPromptField(field) && field.id === 'prompt')
    ?? model.inputs.find(isPromptField);
}

export function isImageField(field: ModelInputField): boolean {
  if (field.fieldType !== 'port' && field.fieldType !== 'element-list') return false;
  if (field.portType === 'image') return true;
  if (field.portType !== 'media') return false;
  return field.mediaRole === 'image'
    || field.mediaRole === 'start_image'
    || field.mediaRole === 'end_image'
    || /image|frame|photo|reference/i.test(`${field.id} ${field.falParam} ${field.label}`);
}

export function isExplicitStartField(field: ModelInputField): boolean {
  if (!isImageField(field)) return false;
  if (field.mediaRole === 'start_image') return true;
  return /(^|[_\s-])(start|first)([_\s-]|$)/i.test(`${field.id} ${field.falParam} ${field.label}`);
}

export function isExplicitEndField(field: ModelInputField): boolean {
  if (!isImageField(field)) return false;
  if (field.mediaRole === 'end_image') return true;
  return /(^|[_\s-])(end|last)([_\s-]|$)/i.test(`${field.id} ${field.falParam} ${field.label}`);
}

export function startFieldFor(model: ModelDefinition): ModelInputField | undefined {
  const imageFields = model.inputs.filter(isImageField);
  return imageFields.find((field) => field.mediaRole === 'start_image')
    ?? imageFields.find(isExplicitStartField)
    ?? imageFields.find((field) => (
      field.fieldType === 'port'
      && field.mediaRole !== 'end_image'
      && /^(image|image_url|image_input|init_image|source_image)$/i.test(field.id)
    ));
}

export function endFieldFor(model: ModelDefinition): ModelInputField | undefined {
  const imageFields = model.inputs.filter(isImageField);
  return imageFields.find((field) => field.mediaRole === 'end_image')
    ?? imageFields.find(isExplicitEndField);
}

export function referenceFieldFor(model: ModelDefinition): ModelInputField | undefined {
  const imageFields = model.inputs.filter((field) => (
    isImageField(field) && !isExplicitStartField(field) && !isExplicitEndField(field)
  ));
  return imageFields.find((field) => field.fieldType === 'element-list')
    ?? imageFields.find((field) => field.mediaRole === 'image' && field.multiple)
    ?? imageFields.find((field) => field.multiple)
    ?? imageFields.find((field) => field.mediaRole === 'image')
    ?? imageFields[0];
}
