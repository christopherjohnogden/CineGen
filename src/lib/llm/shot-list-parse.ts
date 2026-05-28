export interface ParsedShotEntry {
  number: number;
  label: string;
  type?: string;
  subject?: string;
  action?: string;
  camera?: string;
  audio?: string;
  durationSeconds?: number;
  notes?: string;
  imagePrompt?: string;
  sectionText: string;
}

function parseDurationValue(raw: string): number | undefined {
  const match = raw.match(/(\d+(?:\.\d+)?)/);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.min(15, Math.max(1, Math.round(value)));
}

function extractPromptFromSection(section: string): string | undefined {
  const fieldMatch = section.match(
    /\*\*(?:Image\s+)?[Pp]rompt:\*\*\s*(?:\n)?(?:>\s*)?(?:\*"([^"]+)"\*|\*"([^"]+)"\*|"([^"]+)"|'([^']+)'|([^\n]+))/i,
  );
  if (fieldMatch) {
    const prompt = (fieldMatch[1] || fieldMatch[2] || fieldMatch[3] || fieldMatch[4] || fieldMatch[5] || '').trim();
    return prompt || undefined;
  }
  return undefined;
}

function parseSectionFields(section: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of section.split('\n')) {
    const match = line.trim().match(/^\*\*([^:*]+):\*\*\s*(.+)$/);
    if (!match) continue;
    fields[match[1].trim().toLowerCase()] = match[2].trim();
  }
  return fields;
}

export function parseShotListFromMarkdown(content: string): ParsedShotEntry[] {
  const entries: ParsedShotEntry[] = [];
  const sections = content.split(/^###\s+/m).slice(1);

  for (const section of sections) {
    const lines = section.split('\n');
    const headerLine = lines[0]?.trim() ?? '';
    if (!/(shot|panel|beat|scene|closing|wide|insert|drone|opening)/i.test(headerLine)) {
      continue;
    }

    const headerMatch = headerLine.match(/^(?:Shot|Panel)\s*(\d+)?\s*[—–-]\s*(.+)$/i)
      ?? headerLine.match(/^(.+)$/);
    const numberMatch = headerLine.match(/\b(\d+)\b/);
    const number = Number(headerMatch?.[1] ?? numberMatch?.[1] ?? entries.length + 1);
    const label = (headerMatch?.[2] ?? headerLine).trim();
    const body = lines.slice(1).join('\n');
    const fields = parseSectionFields(body);

    entries.push({
      number: Number.isFinite(number) ? number : entries.length + 1,
      label,
      type: fields.type,
      subject: fields.subject,
      action: fields.action,
      camera: fields.camera,
      audio: fields.audio,
      durationSeconds: parseDurationValue(fields.duration ?? ''),
      notes: fields.notes,
      imagePrompt: extractPromptFromSection(body),
      sectionText: body,
    });
  }

  return entries.sort((a, b) => a.number - b.number);
}

export function isShotListMessage(content: string): boolean {
  const shots = parseShotListFromMarkdown(content);
  if (shots.length < 2) return false;
  return /\b(coverage summary|total shots|est\.?\s*runtime|shot list)\b/i.test(content)
    || shots.length >= 3;
}

export function suggestDurationForShot(shot: ParsedShotEntry): number {
  if (shot.durationSeconds) return shot.durationSeconds;

  const type = `${shot.type ?? ''} ${shot.label} ${shot.camera ?? ''}`.toLowerCase();
  if (/\b(insert|detail|cutaway|reaction|close[- ]?up|ecu)\b/.test(type)) return 3;
  if (/\b(wide|establish|drone|aerial|master)\b/.test(type)) return 5;
  if (/\b(hold|emotional|dialogue|conversation|two[- ]shot)\b/.test(type)) return 8;
  if (/\b(montage|action|chase|sequence)\b/.test(type)) return 6;
  return 5;
}

export function buildFallbackVisualPrompt(shot: ParsedShotEntry): string {
  if (shot.imagePrompt?.trim()) return shot.imagePrompt.trim();
  const parts = [
    shot.subject,
    shot.action,
    shot.camera,
    shot.type ? `${shot.type} shot` : undefined,
  ].filter(Boolean);
  return parts.join('. ').trim() || shot.label;
}
