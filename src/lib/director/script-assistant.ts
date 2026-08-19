import type { Screenplay, ScreenplayElement } from '@/lib/director/screenplay';
import { renumberBeats, type Beat, type BeatSheet } from '@/lib/director/beatsheet';

export interface AssistantEdit {
  op: 'replace' | 'insert-after' | 'delete';
  targetElementId?: string;
  elements?: ScreenplayElement[];
}
export interface BeatEdit {
  op: 'replace' | 'insert-after' | 'delete';
  targetBeatId?: string;
  beats?: Beat[];
}
export interface AssistantResponse { reply: string; edits?: AssistantEdit[]; beatEdits?: BeatEdit[] }

export const SCRIPT_ASSISTANT_SYSTEM_PROMPT = `You are a screenwriting assistant embedded in a script editor.
You can answer questions about the script AND propose edits to it.
The script is given as a list of elements, each with an id, a type (scene|action|character|parenthetical|dialogue|transition) and text.
When the user asks you to change the script, return edits that reference element ids.
Return ONLY JSON with this shape:
{
  "reply": "one short sentence describing what you did or answering the question",
  "edits": [
    { "op": "replace", "targetElementId": "<id>", "elements": [ { "id": "<id>", "type": "dialogue", "text": "..." } ] },
    { "op": "insert-after", "targetElementId": "<id>", "elements": [ { "id": "new1", "type": "action", "text": "..." } ] },
    { "op": "delete", "targetElementId": "<id>" }
  ]
}
Omit "edits" entirely for a pure question/answer. Never invent element ids for replace/delete — use ids from the script. Keep replacements screenplay-formatted.`;

export function buildAssistantMessage(
  doc: Screenplay,
  userText: string,
  selection?: { elementId?: string; sceneIndex?: number },
): string {
  const script = doc.elements.map((e) => `[${e.id}] (${e.type}) ${e.text}`).join('\n');
  const sel = selection?.elementId ? `\nSELECTED ELEMENT: ${selection.elementId}` : '';
  const scene = selection?.sceneIndex != null ? `\nSELECTED SCENE INDEX: ${selection.sceneIndex}` : '';
  return `SCRIPT:\n${script}${sel}${scene}\n\nUSER:\n${userText}`;
}

export const BEATSHEET_ASSISTANT_SYSTEM_PROMPT = `You are a video beat-sheet assistant. A beat sheet has NO dialogue — it is a list of beats, each describing what happens on screen so it can become a video-generation prompt.
Each beat has an id and fields: action (what happens), location, shot (camera/framing/movement), mood (optional).
When the user asks you to write or change beats, return edits referencing beat ids.
Return ONLY JSON with this shape:
{
  "reply": "one short sentence",
  "beatEdits": [
    { "op": "insert-after", "targetBeatId": "<id or omit to append at start>", "beats": [ { "id": "new1", "n": 0, "action": "...", "location": "INT. ...", "shot": "...", "mood": "..." } ] },
    { "op": "replace", "targetBeatId": "<id>", "beats": [ { "id": "<id>", "n": 0, "action": "...", "location": "...", "shot": "..." } ] },
    { "op": "delete", "targetBeatId": "<id>" }
  ]
}
Omit "beatEdits" entirely for a pure question/answer. Write vivid, concrete, film-able action. No dialogue. n will be renumbered automatically — set it to 0.`;

export function buildBeatsheetMessage(
  bs: BeatSheet,
  userText: string,
  selection?: { beatId?: string },
): string {
  const sheet = bs.beats.map((b) =>
    `[${b.id}] BEAT ${b.n} @ ${b.location} | action: ${b.action} | shot: ${b.shot}${b.mood ? ` | ${b.mood}` : ''}`,
  ).join('\n');
  const sel = selection?.beatId ? `\nSELECTED BEAT: ${selection.beatId}` : '';
  return `BEAT SHEET:\n${sheet || '(empty)'}${sel}\n\nUSER:\n${userText}`;
}

function extractJson(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const brace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (brace >= 0 && lastBrace > brace) return raw.slice(brace, lastBrace + 1);
  return null;
}

export function parseAssistantResponse(raw: string): AssistantResponse {
  const json = extractJson(raw);
  if (json) {
    try {
      const obj = JSON.parse(json) as Partial<AssistantResponse>;
      if (obj && typeof obj.reply === 'string') {
        const edits = Array.isArray(obj.edits) ? obj.edits.filter((e): e is AssistantEdit =>
          !!e && (e.op === 'replace' || e.op === 'insert-after' || e.op === 'delete')) : undefined;
        const beatEdits = Array.isArray(obj.beatEdits) ? obj.beatEdits.filter((e): e is BeatEdit =>
          !!e && (e.op === 'replace' || e.op === 'insert-after' || e.op === 'delete')) : undefined;
        return {
          reply: obj.reply,
          edits: edits && edits.length ? edits : undefined,
          beatEdits: beatEdits && beatEdits.length ? beatEdits : undefined,
        };
      }
    } catch { /* fall through to plain reply */ }
  }
  return { reply: raw.trim() };
}

export function applyAssistantEdits(doc: Screenplay, edits: AssistantEdit[]): Screenplay {
  let elements = [...doc.elements];
  for (const edit of edits) {
    const i = edit.targetElementId ? elements.findIndex((e) => e.id === edit.targetElementId) : -1;
    if (edit.op === 'replace' && i >= 0 && edit.elements) {
      elements = [...elements.slice(0, i), ...edit.elements, ...elements.slice(i + 1)];
    } else if (edit.op === 'insert-after' && i >= 0 && edit.elements) {
      elements = [...elements.slice(0, i + 1), ...edit.elements, ...elements.slice(i + 1)];
    } else if (edit.op === 'delete' && i >= 0) {
      elements = [...elements.slice(0, i), ...elements.slice(i + 1)];
    }
  }
  return { elements };
}

export function applyBeatEdits(bs: BeatSheet, edits: BeatEdit[]): BeatSheet {
  let beats = [...bs.beats];
  for (const edit of edits) {
    const i = edit.targetBeatId ? beats.findIndex((b) => b.id === edit.targetBeatId) : -1;
    if (edit.op === 'replace' && i >= 0 && edit.beats) {
      beats = [...beats.slice(0, i), ...edit.beats, ...beats.slice(i + 1)];
    } else if (edit.op === 'insert-after' && edit.beats) {
      const at = i >= 0 ? i + 1 : 0; // no target → prepend
      beats = [...beats.slice(0, at), ...edit.beats, ...beats.slice(at)];
    } else if (edit.op === 'delete' && i >= 0) {
      beats = [...beats.slice(0, i), ...beats.slice(i + 1)];
    }
  }
  return { beats: renumberBeats(beats) };
}
