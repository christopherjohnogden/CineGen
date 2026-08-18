import type { Screenplay, ScreenplayElement } from '@/lib/director/screenplay';

export interface AssistantEdit {
  op: 'replace' | 'insert-after' | 'delete';
  targetElementId?: string;
  elements?: ScreenplayElement[];
}
export interface AssistantResponse { reply: string; edits?: AssistantEdit[] }

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
        return { reply: obj.reply, edits: edits && edits.length ? edits : undefined };
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
