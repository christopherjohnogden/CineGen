import { memo, useEffect, useRef, useState } from 'react';
import { type NodeProps, useReactFlow } from '@xyflow/react';
import { BaseNode } from './base-node';
import { useWorkspace } from '@/components/workspace/workspace-shell';
import { elevenLabs } from '@/lib/elevenlabs/client';
import { useRunNode } from '@/components/create/workflow-canvas';
import { ElevenLabsConnection } from '@/components/elevenlabs/connection';
import { prepareAudioReference } from '@/lib/cloud/elements';
import { getApiKey } from '@/lib/utils/api-key';
import type { WorkflowNodeData } from '@/types/workflow';

export const ElevenLabsAudioNode = memo(function ElevenLabsAudioNode({ id, data, selected }: NodeProps & { data: WorkflowNodeData }) {
  const { state, dispatch, projectId } = useWorkspace();
  const { updateNodeData, getNode } = useReactFlow();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const runNode = useRunNode();
  const [error, setError] = useState('');
  const config = data.config;
  const character = state.elements.find(el => el.id === config.elementId);
  const update = (patch: Record<string, unknown>) => updateNodeData(id, { config: { ...config, ...patch } });
  useEffect(() => {
    const requestId = data.result?.audioRequestId;
    if (!requestId || data.result?.status !== 'running') return;
    let stopped = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const job = await elevenLabs.job(requestId);
        if (stopped) return;
        failures = 0;
        const latest = getNode(id)?.data as WorkflowNodeData | undefined;
        if (!latest || latest.result?.audioRequestId !== requestId) return;
        if (job.status === 'complete' && job.url) {
          updateNodeData(id, { isRunning: false, result: { status: 'complete', url: job.url, audioRequestId: requestId } });
          dispatch({ type: 'ADD_ASSET', asset: { id: job.assetId, name: latest.label || 'ElevenLabs audio', type: 'audio', url: job.url, createdAt: new Date().toISOString() } });
          return;
        }
        if (job.status === 'error') { updateNodeData(id, { isRunning: false, result: { ...latest.result, status: 'error', error: job.error } }); return; }
      } catch {
        if (++failures >= 3 && !stopped) {
          const latest = getNode(id)?.data as WorkflowNodeData | undefined;
          if (latest?.result?.audioRequestId === requestId) updateNodeData(id, { isRunning: false, result: { ...latest.result, status: 'error', error: 'Could not check this take. Reconnect and check again to recover the same audio.' } });
          return;
        }
      }
      if (!stopped) timer = setTimeout(() => void check(), 5000);
    };
    timer = setTimeout(() => void check(), 5000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [data.result?.audioRequestId, data.result?.status, dispatch, getNode, id, updateNodeData]);
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
  const running = busy || data.isRunning || data.result?.status === 'running';
  const audioUrl = data.result?.url || String(config.audioUrl || '');
  const pending = !!data.result?.audioRequestId && data.result?.status !== 'complete';
  return <BaseNode nodeType="elevenLabsAudio" title={data.label || 'ElevenLabs Audio'} selected={!!selected} isRunning={!!running} meta={running ? 'Creating audio' : audioUrl ? 'Audio ready' : 'Voice & sound'}>
    <div className="elevenlabs-audio nodrag nowheel"><fieldset disabled={!!running} className="elevenlabs-audio__fields">
      <div className="character-voice__row"><label>Audio type<select className="element-modal__input" value={String(config.kind || 'speech')} onChange={e => update({ kind: e.target.value })}><option value="speech">Speech / dialogue</option><option value="sound">Sound effect</option></select></label><label>Character<select className="element-modal__input" value={String(config.elementId || '')} onChange={e => update({ elementId: e.target.value, voiceId: '' })}><option value="">No character</option>{state.elements.filter(el => el.type === 'character').map(el => <option key={el.id} value={el.id}>{el.name}</option>)}</select></label></div>
      <ElevenLabsConnection disabled={!!running} showVoices={config.kind !== 'sound'} voiceId={String(config.voiceId || character?.voice?.voiceId || '')} onVoice={voice => update({ voiceId: voice.id, voiceName: voice.name })} />
      {config.kind === 'sound' && <label>Duration (seconds)<input className="element-modal__input" type="number" min="0.5" max="30" step="0.5" value={String(config.durationSeconds || '')} placeholder="Automatic" onChange={e => update({ durationSeconds: e.target.value ? Number(e.target.value) : undefined })} /></label>}
      {character?.voice?.description && <p className="character-voice__hint">{character.voice.description}</p>}
      <label> {config.kind === 'sound' ? 'Sound brief' : 'Dialogue'}<textarea className="element-modal__textarea" rows={4} value={String(config.text || '')} onChange={e => update({ text: e.target.value })} placeholder={config.kind === 'sound' ? 'Describe the sound, setting and duration…' : 'Only the words the character should say…'} /></label>
      <label>Performance direction<textarea className="element-modal__textarea" rows={2} value={String(config.direction || '')} onChange={e => update({ direction: e.target.value })} placeholder="Delivery, emotion, pacing…" /></label>
      </fieldset>
      {audioUrl && <div className="elevenlabs-audio__result"><span>YOUR AUDIO</span><audio controls preload="metadata" src={audioUrl} aria-label="ElevenLabs audio result" /></div>}
      <button type="button" className="character-voice__primary elevenlabs-audio__generate" disabled={!!running || !String(config.text || '').trim()} onClick={() => { setError(''); void runNode(id); }}>{running ? 'Generating audio…' : pending ? 'Check / recover this take' : audioUrl ? 'Generate another take' : 'Generate audio'}</button>
      {pending && !running && <button type="button" className="character-voice__secondary" onClick={() => updateNodeData(id, { result: { status: 'idle', ...(audioUrl ? { url: audioUrl } : {}) } })}>Start a new take</button>}
      <input ref={input} hidden type="file" accept="audio/*,.mp3,.wav,.m4a" onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
      <button type="button" className="character-voice__secondary" disabled={!!running} onClick={() => input.current?.click()}>{busy ? 'Saving audio…' : 'Use an audio file instead'}</button>
      <p className="character-voice__hint">Generate and listen here. Connect the audio output to a video’s audio reference. Uses your ElevenLabs credits.</p>
      {data.result?.error && <p role="alert" className="character-voice__error">{data.result.error}</p>}
      {error && <p role="alert" className="character-voice__error">{error}</p>}
    </div>
  </BaseNode>;
});
