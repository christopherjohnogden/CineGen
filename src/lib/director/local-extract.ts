// Deterministic, zero-LLM breakdown extraction.
//
// The breakdown is fundamentally a tagging job: this is a character, this is a prop,
// this is a location. Most of it is already structural (a beat's `location` IS the
// location) or decidable from two cheap signals:
//   1. A capitalized token mid-sentence is a person's name  -> character ("Bryan").
//   2. A noun phrase's HEAD noun decides its kind via lexicon ("a red car" -> vehicle).
// This runs instantly and can be trusted as the source of truth; an LLM pass may add
// what the lexicons miss, but must never delete what this found.

import type { BreakdownKind } from '@/types/director';
import type { BeatSheet } from '@/lib/director/beatsheet';
import { parseHeading, type ScriptScene } from '@/lib/director/scene-split';

export interface ExtractedItem {
  kind: BreakdownKind;
  name: string;
  /** Where it came from — 'field' is structural (exact), 'prose' is heuristic. */
  source: 'field' | 'prose';
  /** Head noun the phrase was classified by; variants of one thing share it. */
  head?: string;
  /** Locations only — parsed off the scene heading. */
  intExt?: string;
  /** Locations only — parsed off the scene heading. */
  timeOfDay?: string;
}

// ── Lexicons ────────────────────────────────────────────────────────────────
// Head nouns that decide an item's kind. Singular forms; matching is plural-aware.

const PERSON_NOUNS = new Set([
  'warrior', 'soldier', 'rider', 'fighter', 'combatant', 'knight', 'guard', 'archer',
  'man', 'woman', 'boy', 'girl', 'child', 'person', 'people', 'crowd', 'ranks', 'army',
  'king', 'queen', 'prince', 'princess', 'captain', 'general', 'officer', 'priest',
  'doctor', 'nurse', 'scientist', 'driver', 'pilot', 'sailor', 'hunter', 'thief',
  'alien', 'creature', 'beast', 'monster', 'villager', 'stranger', 'figure', 'bystander',
]);

const VEHICLE_NOUNS = new Set([
  'horse', 'car', 'truck', 'van', 'bus', 'motorcycle', 'bike', 'bicycle', 'ship',
  'boat', 'plane', 'aircraft', 'jet', 'helicopter', 'train', 'wagon', 'cart',
  'chariot', 'mount', 'steed', 'tank', 'rover', 'shuttle', 'craft',
]);

const PROP_NOUNS = new Set([
  // carried / wielded
  'spear', 'sword', 'shield', 'axe', 'bow', 'arrow', 'knife', 'dagger', 'gun', 'rifle',
  'pistol', 'staff', 'wand', 'banner', 'flag', 'torch', 'lantern', 'rope', 'chain',
  'book', 'letter', 'map', 'key', 'phone', 'radio', 'bag', 'box', 'crate',
  'bottle', 'cup', 'glass', 'vial', 'flare', 'tool', 'hammer', 'blade', 'weapon',
  // worn ('ring' is omitted: "a ring of soldiers" is far commoner than jewelry)
  'armor', 'armour', 'helmet', 'cloak', 'coat', 'jacket', 'robe', 'mask', 'gloves',
  'boots', 'crown', 'necklace', 'belt', 'uniform', 'dress', 'hat',
  // set dressing / furniture
  'sofa', 'couch', 'armchair', 'chair', 'table', 'desk', 'shelf', 'bookshelf', 'lamp',
  'curtain', 'rug', 'carpet', 'bed', 'mirror', 'painting', 'clock', 'door', 'window',
]);

/** Camera/craft vocabulary that must never become a prop, even though it names objects. */
const CRAFT_STOPWORDS = new Set([
  'camera', 'shot', 'frame', 'angle', 'lens', 'dolly', 'pan', 'zoom', 'crane', 'gimbal',
  'close-up', 'closeup', 'wide', 'framing', 'focus', 'take', 'cut', 'scene', 'beat',
]);

/** Words that are capitalized but are not names. */
const NOT_NAMES = new Set([
  'int', 'ext', 'day', 'night', 'dusk', 'dawn', 'morning', 'evening', 'afternoon',
  'continuous', 'later', 'same', 'action', 'shot', 'beat', 'the', 'a', 'an',
  // pronouns and common sentence openers ("He sprints…", "Meanwhile…")
  'he', 'she', 'they', 'it', 'we', 'you', 'then', 'there', 'here', 'now', 'meanwhile',
  'everyone', 'everybody', 'someone', 'somebody', 'anyone', 'anything',
  'something', 'everything', 'nothing', 'nobody',
  // ambient nouns that open screenplay sentences but are never people
  'dust', 'rain', 'snow', 'wind', 'thunder', 'lightning', 'smoke', 'fog', 'mist',
  'fire', 'water', 'blood', 'silence', 'music', 'sound', 'light', 'lights',
  'darkness', 'shadow', 'shadows', 'sunlight', 'moonlight',
]);

/** Tokens that terminate a backwards modifier walk. */
const PHRASE_STOPPERS = new Set([
  'a', 'an', 'the', 'his', 'her', 'its', 'their', 'my', 'your', 'our', 'this', 'that',
  'these', 'those', 'of', 'in', 'on', 'at', 'to', 'from', 'with', 'by', 'for', 'into',
  'across', 'behind', 'over', 'under', 'around', 'past', 'toward', 'towards', 'against',
  'and', 'or', 'but', 'as', 'is', 'are', 'was', 'were', 'be', 'been',
  'dozens', 'hundreds', 'thousands', 'some', 'many', 'few', 'both', 'each', 'other',
  'one', 'two', 'three', 'four', 'five', 'several', 'all', 'who', 'which', 'up',
]);

const MAX_MODIFIERS = 2;

function singular(word: string): string {
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith('ses') || word.endsWith('xes') || word.endsWith('ches') || word.endsWith('shes')) {
    return word.slice(0, -2);
  }
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function kindForHead(word: string): BreakdownKind | undefined {
  const w = singular(word.toLowerCase());
  if (CRAFT_STOPWORDS.has(w) || CRAFT_STOPWORDS.has(word.toLowerCase())) return undefined;
  if (PERSON_NOUNS.has(w)) return 'character';
  if (VEHICLE_NOUNS.has(w)) return 'vehicle';
  if (PROP_NOUNS.has(w)) return 'prop';
  return undefined;
}

/** Title-case a phrase for display: "red car" -> "Red Car". */
export function titleCase(phrase: string): string {
  return phrase
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.split('-').map((p) => (p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : p)).join('-'))
    .join(' ');
}

/** Split prose into sentences so we can tell sentence-initial capitals from names. */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

/** Tokens with punctuation preserved as `,` markers so a modifier walk stops at a clause
 *  break ("lands in a crouch, spear already spinning" must not yield "crouch spear"). */
function tokens(sentence: string): string[] {
  return sentence
    .replace(/([,;:()"])/g, ' , ')
    .split(/\s+/)
    .map((t) => t.replace(/[.!?]+$/, ''))
    .filter(Boolean);
}

/** Looks like a conjugated verb ("drives", "walks", "is", "was") — never a modifier. */
export function verbLike(word: string): boolean {
  return word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('ous') && !word.endsWith('us');
}

/**
 * Proper names appearing MID-sentence in prose, where a capital is unambiguous.
 * Used as corpus evidence: once "Bryan" is a confirmed name anywhere, a
 * sentence-initial "Bryan" elsewhere is a name too.
 */
export function properNamesIn(text: string): Set<string> {
  const names = new Set<string>();
  for (const sentence of sentences(text)) {
    tokens(sentence).forEach((tok, i) => {
      if (i === 0) return;
      const bare = tok.replace(/[^A-Za-z'’-]/g, '');
      const lower = bare.toLowerCase();
      if (/^[A-Z][a-z'’-]+$/.test(bare) && !NOT_NAMES.has(lower)
        && !PHRASE_STOPPERS.has(lower) && !kindForHead(bare)) {
        names.add(bare.replace(/['’]s$/, '').toLowerCase());
      }
    });
  }
  return names;
}

/**
 * Pull characters/props/vehicles out of a line of prose.
 * - A capitalized token that is NOT sentence-initial is a person's name -> character.
 * - A sentence-INITIAL capital is a name too when corroborated: it is a known name
 *   (dialogue cue / seen mid-sentence elsewhere) or a verb follows it — action-line
 *   subjects lead their sentences ("Jacob drives ...").
 * - Otherwise a head noun in a lexicon names the item, with up to MAX_MODIFIERS
 *   adjectives walked backwards ("a red car" -> "red car").
 */
export function extractFromProse(text: string, knownNames?: Set<string>): ExtractedItem[] {
  const out: ExtractedItem[] = [];
  for (const sentence of sentences(text)) {
    const toks = tokens(sentence);
    toks.forEach((tok, i) => {
      const bare = tok.replace(/[^A-Za-z'’-]/g, '');
      if (!bare) return;

      // 1. Proper noun -> a person's name ("Jacob's" counts, possessive stripped).
      const isCapitalized = /^[A-Z][a-z'’-]+$/.test(bare);
      const lower = bare.toLowerCase();
      if (isCapitalized && !NOT_NAMES.has(lower) && !PHRASE_STOPPERS.has(lower) && !kindForHead(bare)) {
        const name = bare.replace(/['’]s$/, '');
        if (i > 0) {
          out.push({ kind: 'character', name, source: 'prose' });
          return;
        }
        const next = toks[i + 1]?.replace(/[^A-Za-z'’-]/g, '') ?? '';
        const corroborated = (knownNames?.has(name.toLowerCase()) ?? false)
          || (/^[a-z]/.test(next) && verbLike(next.toLowerCase()));
        if (!lower.endsWith('ly') && corroborated) {
          out.push({ kind: 'character', name, source: 'prose' });
          return;
        }
      }

      // 2. Head noun in a lexicon -> kind, with backwards modifier walk.
      const kind = kindForHead(bare);
      if (!kind) return;
      const head = singular(bare.toLowerCase());
      const parts: string[] = [bare.toLowerCase()];
      for (let j = i - 1; j >= 0 && parts.length <= MAX_MODIFIERS; j--) {
        const raw = toks[j];
        if (raw === ',') break; // clause boundary
        const prevBare = raw.replace(/[^A-Za-z'’-]/g, '');
        const prev = prevBare.toLowerCase();
        if (!prev || PHRASE_STOPPERS.has(prev) || CRAFT_STOPWORDS.has(prev)) break;
        // A capitalized name is its own entity, never a modifier ("Jacob's spear").
        if (/^[A-Z]/.test(prevBare) && !kindForHead(prevBare)) break;
        // A preceding person-noun is a compound modifier ("alien warrior", "human warrior"),
        // but any other lexicon noun is a separate thing — stop there.
        const prevKind = kindForHead(prev);
        if (prevKind && !(kind === 'character' && prevKind === 'character')) break;
        // Verbs are not modifiers ("Jacob drives green sofa" must not yield "Drives Green Sofa").
        if (!prevKind && verbLike(prev)) break;
        parts.unshift(prev);
        if (prevKind) break; // compound head consumed; don't keep walking
      }
      out.push({ kind, name: titleCase(parts.join(' ')), source: 'prose', head });
    });
  }
  return out;
}

const wordSet = (s: string) => new Set(s.trim().toLowerCase().split(/\s+/));
const isSubset = (a: Set<string>, b: Set<string>) => [...a].every((w) => b.has(w));

/**
 * Collapse duplicates within a kind. A name whose words are a SUBSET of another's is the
 * same thing described less fully — "Horse" ⊂ "Massive Black Horse", "Alien" ⊂ "Alien
 * Warrior" — so the richer name wins. Names with disjoint modifiers stay separate, which
 * is what keeps "Alien Warrior" and "Armored Human Warrior" as two different characters.
 */
export function dedupe(items: ExtractedItem[]): ExtractedItem[] {
  const kept: ExtractedItem[] = [];
  for (const it of items) {
    const words = wordSet(it.name);
    let merged = false;
    for (let i = 0; i < kept.length; i++) {
      const k = kept[i];
      if (k.kind !== it.kind) continue;
      const kw = wordSet(k.name);
      if (isSubset(kw, words)) { kept[i] = { ...k, name: it.name }; merged = true; break; } // richer wins
      if (isSubset(words, kw)) { merged = true; break; }                                    // already covered
    }
    if (!merged) kept.push(it);
  }
  return kept;
}

/** "JOHN (V.O.)" / "SARAH (CONT'D)" → "John" / "Sarah". Undefined for junk cues. */
export function characterFromCue(text: string): string | undefined {
  const bare = text.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  if (!bare || bare.length > 30 || !/[A-Za-z]/.test(bare)) return undefined;
  return titleCase(bare);
}

/**
 * Everything a parsed screenplay yields with zero inference for locations (the
 * heading IS the location) and speaking characters (a dialogue cue IS a character),
 * plus heuristic characters/props/vehicles from the action prose.
 *
 * Locations are deduped by exact name only — "Battlefield" and "Battlefield
 * Clearing" are two different places, so the subset-merging `dedupe` must not
 * see them.
 */
export function extractFromScreenplay(scenes: ScriptScene[]): ExtractedItem[] {
  // Corpus pass first: names confirmed ANYWHERE (dialogue cues, mid-sentence
  // capitals) corroborate sentence-initial capitals everywhere else, so
  // "Jacob drives off." still yields Jacob even at the start of a sentence.
  const knownNames = new Set<string>();
  for (const scene of scenes) {
    for (const el of scene.elements) {
      if (el.type === 'character') {
        const name = characterFromCue(el.text);
        if (!name) continue;
        knownNames.add(name.toLowerCase());
        const first = name.split(/\s+/)[0];
        if (first) knownNames.add(first.toLowerCase());
      } else if (el.type === 'action') {
        for (const name of properNamesIn(el.text)) knownNames.add(name);
      }
    }
  }

  const locations: ExtractedItem[] = [];
  const seenLocations = new Set<string>();
  const rest: ExtractedItem[] = [];
  for (const scene of scenes) {
    const meta = parseHeading(scene.heading);
    const place = titleCase(meta.place.replace(/\s*[-—–]\s*/g, ' ').trim());
    if (place && !seenLocations.has(place.toLowerCase())) {
      seenLocations.add(place.toLowerCase());
      locations.push({
        kind: 'location', name: place, source: 'field',
        intExt: meta.intExt, timeOfDay: meta.timeOfDay,
      });
    }
    for (const el of scene.elements) {
      if (el.type === 'character') {
        const name = characterFromCue(el.text);
        if (name) rest.push({ kind: 'character', name, source: 'field' });
      } else if (el.type === 'action') {
        rest.push(...extractFromProse(el.text, knownNames));
      }
    }
  }
  return [...locations, ...dedupe(rest)];
}

/**
 * Everything a beat sheet yields with zero inference for locations (they are a field)
 * plus heuristic characters/props/vehicles from the action and shot prose.
 */
export function extractFromBeatSheet(bs: BeatSheet): ExtractedItem[] {
  const items: ExtractedItem[] = [];
  for (const beat of bs.beats) {
    const loc = beat.location.trim();
    if (loc) items.push({ kind: 'location', name: loc, source: 'field' });
  }
  // Corpus pass: a name seen mid-sentence in ANY beat corroborates
  // sentence-initial capitals in every beat.
  const knownNames = new Set<string>();
  for (const beat of bs.beats) {
    for (const name of properNamesIn(beat.action)) knownNames.add(name);
    for (const name of properNamesIn(beat.shot)) knownNames.add(name);
  }
  for (const beat of bs.beats) {
    if (beat.action.trim()) items.push(...extractFromProse(beat.action, knownNames));
    if (beat.shot.trim()) items.push(...extractFromProse(beat.shot, knownNames));
  }
  return dedupe(items);
}
