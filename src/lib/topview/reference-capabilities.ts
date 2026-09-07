type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};

/** A provider transport's limit is not a global CineGen/model prompt limit. */
export function topviewPromptMaxCharacters(schema: unknown): number | undefined {
  const top = record(schema);
  const request = record(record(top.properties).req ?? top);
  const maximum = record(record(request.properties).prompt).maxLength;
  return typeof maximum === 'number' && Number.isInteger(maximum) && maximum > 0 ? maximum : undefined;
}

export function assertTopviewCanvasPrompt(prompt: unknown, schema: unknown): void {
  const maximum = topviewPromptMaxCharacters(schema);
  const length = Array.from(String(prompt ?? '')).length;
  if (maximum !== undefined && length > maximum) {
    throw new Error(`Topview's Canvas audio-reference route accepts up to ${maximum.toLocaleString('en-US')} prompt characters; this prompt has ${length.toLocaleString('en-US')}. CineGen preserved the full prompt and did not submit a generation. Do not shorten or rewrite it without the user's approval.`);
  }
}

/** Input audio is independent of nativeAudio, which controls generated sound. */
export function topviewAcceptsAudioReferences(model: RecordValue): boolean {
  const parameters = record(record(model.raw).parameters ?? model.parameters);
  const hybrid = record(parameters.supportHybridUploadsRef);
  if (hybrid.audios === false || hybrid.maxAudios === 0) return false;
  if (hybrid.audios === true || Number(hybrid.maxAudios) > 0 || Number(parameters.maxRefAudioCount) > 0) return true;
  const fields = record(model.submitParameterOptions);
  if (Object.hasOwn(fields, 'inputAudios') || Object.hasOwn(record(model.defaultSubmitParameters), 'inputAudios')) return true;
  // The compact MCP catalog omits media capabilities. These models are also
  // documented in Topview's Omni Reference API (checked 2026-09-07).
  return [model.submitModel, model.displayName, model.name].some(value =>
    typeof value === 'string' && /seedance[-\s]+2[.\-](?:5|0)(?:\b|[-\s])/i.test(value));
}

/** Select a transport before submission; never retry a paid task on another route. */
export function topviewVideoSubmitRoute(schema: unknown, request: RecordValue, hasApiConnection: boolean, hasCanvasConnection = false): 'mcp' | 'api' | 'canvas-mcp' {
  if (request.taskType !== 'omni_reference' || !Array.isArray(request.inputAudios) || !request.inputAudios.length) return 'mcp';
  const top = record(schema);
  const requestSchema = record(record(top.properties).req ?? top);
  if (Object.hasOwn(record(requestSchema.properties), 'inputAudios')) return 'mcp';
  if (hasApiConnection) return 'api';
  if (hasCanvasConnection && /seedance[-\s]+2[.\-]5(?:\b|[-\s])/i.test(String(request.model ?? ''))) return 'canvas-mcp';
  throw new Error('Seedance 2.5 supports audio references, but this Topview MCP-plan connection does not expose them. An API connection with separate Topview API credits is required for audio-reference generation. No generation was submitted; your audio was not discarded.');
}

/** The documented REST endpoint takes the same media groups, without MCP routing fields. */
export function topviewAudioApiRequest(request: RecordValue): RecordValue {
  const { taskType: _taskType, ...body } = request;
  return body;
}
