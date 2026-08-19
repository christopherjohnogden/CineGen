import { ACTING_AXIOM, ACTING_PROFILE_DOCTRINE, VOICE_DOCTRINE } from '@/lib/director/craft';
import { parseToScreenplay } from '@/lib/director/screenplay';
import { splitScenes } from '@/lib/director/scene-split';
import { detectSceneAssets } from '@/lib/director/scene-assets';
import type { DirectorBreakdownItem } from '@/types/director';

export const ENRICH_CHARACTER_SYSTEM_PROMPT = `You write the acting and voice profile for ONE character in a film.

${ACTING_AXIOM}

${ACTING_PROFILE_DOCTRINE}

${VOICE_DOCTRINE}

Return ONLY JSON:
{ "actingProfile": "the master profile paragraph — observable behaviour", "voice": "the locked voice prompt, in quotes" }
No prose outside the JSON.`;

/** Character name/description + the text of the scenes they appear in, as context. */
export function buildEnrichInput(item: DirectorBreakdownItem, sourceText: string): string {
  const scenes = splitScenes(parseToScreenplay(sourceText));
  const appearsIn = scenes.filter((sc) =>
    detectSceneAssets(sc, [item]).some((h) => h.name === item.name),
  );
  const sceneText = appearsIn
    .map((sc) => `${sc.heading}\n${sc.elements.map((e) => e.text).join('\n')}`)
    .join('\n\n');
  return `CHARACTER: ${item.name}\nDESCRIPTION: ${item.description}\n\nSCENES THEY APPEAR IN:\n${sceneText || '(none found — infer from the description)'}`;
}

export function parseEnrichResult(raw: unknown): { actingProfile?: string; voice?: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: { actingProfile?: string; voice?: string } = {};
  if (typeof r.actingProfile === 'string' && r.actingProfile.trim()) out.actingProfile = r.actingProfile.trim();
  if (typeof r.voice === 'string' && r.voice.trim()) out.voice = r.voice.trim();
  return out;
}
