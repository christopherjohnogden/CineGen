import type { ElementType } from '@/types/elements';

const TYPE_DIRECTION: Record<ElementType, string> = {
  character: [
    'Lock a repeatable identity: approximate age, ancestry or skin tone when supplied, face shape, eyes, nose, mouth, hair, build, and height impression.',
    'Describe wardrobe as a fixed design with exact colors, materials, layers, footwear, accessories, wear, and signature details.',
    'Do not prescribe a camera angle, pose, facial expression, action, or background; CineGen creates multiple reference-sheet views later.',
  ].join(' '),
  location: [
    'Lock a repeatable place: period, geography, architecture, layout, scale, materials, palette, practical lighting, weathering, set dressing, and unmistakable landmarks.',
    'Describe persistent visual facts instead of a single camera angle or temporary action.',
  ].join(' '),
  prop: [
    'Lock a repeatable object: dimensions, silhouette, construction, materials, exact colors, mechanisms, markings, wear, age, and distinctive identifying details.',
    'Do not prescribe a camera angle, hand, person, or background.',
  ].join(' '),
  vehicle: [
    'Lock a repeatable vehicle: category, era, proportions, body shape, materials, paint, trim, wheels or propulsion, interior, wear, markings, and signature modifications.',
    'Do not prescribe a camera angle, driver, motion, or background.',
  ].join(' '),
};

export function elementDescriptionSystemPrompt(params: {
  type: ElementType;
  name: string;
  currentDescription?: string;
}): string {
  const name = params.name.trim() || `Untitled ${params.type}`;
  const current = params.currentDescription?.trim();
  return [
    'You are CineGen\'s visual development assistant.',
    `Help the user define a production-ready ${params.type} named "${name}" for consistent AI image and video generation.`,
    TYPE_DIRECTION[params.type],
    current ? `The current saved description is: ${current}` : 'There is no saved description yet.',
    'Treat every new user message as a request to create or revise the complete description. Preserve earlier details unless the user changes them.',
    'Make sensible visual choices when details are missing. Do not ask follow-up questions.',
    'Return one standalone polished description, normally 70 to 130 words. Use concrete visible details, not story, personality, marketing language, or generation instructions.',
    'Return only the description as plain text. No heading, bullets, quotation marks, markdown, notes, or explanation.',
  ].join(' ');
}

export function cleanElementDescription(value: string): string {
  let result = value.trim();
  result = result.replace(/^```(?:text|markdown)?\s*/i, '').replace(/\s*```$/i, '').trim();
  result = result.replace(/^(?:final\s+)?description\s*:\s*/i, '').trim();
  if (
    result.length >= 2
    && ((result.startsWith('"') && result.endsWith('"')) || (result.startsWith('“') && result.endsWith('”')))
  ) {
    result = result.slice(1, -1).trim();
  }
  return result;
}

export function elementDescriptionStarter(type: ElementType): string {
  if (type === 'character') return 'Explain the character you have in mind—appearance, age, wardrobe, era, and any defining features.';
  if (type === 'location') return 'Explain the place, its era, architecture, materials, lighting, atmosphere, and defining landmarks.';
  if (type === 'prop') return 'Explain the object, its purpose, shape, materials, scale, condition, and signature details.';
  return 'Explain the vehicle, era, body shape, color, materials, condition, interior, and signature modifications.';
}
