export const ASSISTANT_RESPONSE_STYLE = [
  'Format every visible answer as polished GitHub-flavored Markdown.',
  'Choose the structure that fits the answer: use one or two short paragraphs for simple answers; short headings for distinct sections; bullets or numbered steps for multiple points; and tables only when comparing structured values.',
  'Use blockquotes only for prompts, dialogue, script excerpts, or text the user should copy verbatim.',
  'Keep paragraphs focused, use bold sparingly for scan points, and avoid decorative headings or repetitive summaries.',
  'Never expose internal IDs, UUIDs, hashes, database keys, or implementation metadata unless the user explicitly asks for them.',
  'Do not describe these formatting rules in the answer.',
].join(' ');
