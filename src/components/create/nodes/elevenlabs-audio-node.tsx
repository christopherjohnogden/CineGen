import { memo, useRef, useState } from 'react';
import { type NodeProps, useReactFlow } from '@xyflow/react';
import { BaseNode } from './base-node';
import { useWorkspace } from '@/components/workspace/workspace-shell';
import { elevenLabsAudioBrief } from '@/lib/elevenlabs/audio-brief';
import { prepareAudioReference } from '@/lib/cloud/elements';
import { getApiKey } from '@/lib/utils/api-key';
import type { WorkflowNodeData } from '@/types/workflow';

export const ElevenLabsAudioNode = memo(function ElevenLabsAudioNode({ id, data, selected }: NodeProps & { data: WorkflowNodeData }) {
  const { state, dispatch, projectId } = useWorkspace();
  const { updateNodeData, getNode } = useReactFlow();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const config = data.config;
  const character = state.elements.find(el => el.id === config.elementId);
  const update = (patch: Record<string, unknown>) => updateNodeData(id, { config: { ...config, ...patch } });
  async function copy() {
    setError('');
    try { await navigator.clipboard.writeText(elevenLabsAudioBrief(config, character, { nodeId: id, spaceId: state.activeSpaceId, projectId })); setMessage('Brief copied. Paste it into Claude with ElevenLabs connected.'); }
    catch { setError('Could not copy the brief. Try again.'); }
  }
  async function upload(file?: File) {
    if (!file) return;
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name)) { setError('Choose an audio file.'); return; }
    setBusy(true); setError('');
    try {
      const assetId = crypto.randomUUID();
      const uploaded = await window.electronAPI.elements.upload({ buffer: await file.arrayBuffer(), name: file.name, type: file.type || 'audio/mpeg' }, getApiKey());
      const url = await prepareAudioReference(uploaded.url, projectId, assetId);
      dispatch({ type: 'ADD_ASSET', asset: { id: assetId, name: file.name, type: 'audio', url, createdAt: new Date().toISOString() } });
      const latest = getNode(id)?.data as WorkflowNodeData | undefined;
      if (latest) updateNodeData(id, { config: { ...latest.config, audioUrl: url, audioAssetId: assetId }, result: { status: 'complete', url } });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Audio could not be saved.'); }
    finally { setBusy(false); }
  }
  return <BaseNode nodeType="elevenLabsAudio" title={data.label || 'ElevenLabs Audio'} selected={!!selected} meta={config.audioUrl ? 'Audio ready' : 'Voice & sound'}>
    <div className="elevenlabs-audio nodrag nowheel">
      <div className="character-voice__row"><label>Audio type<select className="element-modal__input" value={String(config.kind || 'speech')} onChange={e => update({ kind: e.target.value })}><option value="speech">Speech / dialogue</option><option value="sound">Sound effect</option></select></label><label>Character<select className="element-modal__input" value={String(config.elementId || '')} onChange={e => update({ elementId: e.target.value })}><option value="">No character</option>{state.elements.filter(el => el.type === 'character').map(el => <option key={el.id} value={el.id}>{el.name}</option>)}</select></label></div>
      {character?.voice?.description && <p className="character-voice__hint">{character.voice.description}</p>}
      <label> {config.kind === 'sound' ? 'Sound brief' : 'Dialogue'}<textarea className="element-modal__textarea" rows={4} value={String(config.text || '')} onChange={e => update({ text: e.target.value })} placeholder={config.kind === 'sound' ? 'Describe the sound, setting and duration…' : 'Only the words the character should say…'} /></label>
      <label>Performance direction<textarea className="element-modal__textarea" rows={2} value={String(config.direction || '')} onChange={e => update({ direction: e.target.value })} placeholder="Delivery, emotion, pacing…" /></label>
      {typeof config.audioUrl === 'string' && config.audioUrl && <audio controls preload="metadata" src={config.audioUrl} aria-label="ElevenLabs audio result" />}
      <button type="button" className="character-voice__primary" onClick={copy}>Copy ElevenLabs audio brief</button>
      <input ref={input} hidden type="file" accept="audio/*,.mp3,.wav,.m4a" onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
      <button type="button" className="character-voice__secondary" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Saving audio…' : 'Upload finished audio'}</button>
      <p className="character-voice__hint">{message || 'Copy the brief for your ElevenLabs MCP. Claude can save the result here. Connect the audio output to a video’s audio reference.'}</p>
      {error && <p role="alert" className="character-voice__error">{error}</p>}
    </div>
  </BaseNode>;
});
