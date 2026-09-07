import { memo, useEffect, useRef, useState } from 'react';
import { type NodeProps, useReactFlow } from '@xyflow/react';
import { SpeakerLoudIcon, MixerHorizontalIcon, MagicWandIcon, UploadIcon, ReloadIcon, CheckIcon, PlayIcon } from '@radix-ui/react-icons';
import { enhanceAudioText, type AudioEnhanceKind } from '@/lib/elevenlabs/enhance';
import type { ElevenLabsPreview } from '@/lib/elevenlabs/types';
import { BaseNode } from './base-node';
import { useNodeConfigDraft } from './use-node-config-draft';
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
  const [activity, setActivity] = useState('');
  const [notice, setNotice] = useState('');
  const operation = useRef(false);
  const enhancement = useRef<AbortController | null>(null);
  const stateRef = useRef(state); stateRef.current = state;
  useEffect(() => () => enhancement.current?.abort(), []);
  const [config, editDraft] = useNodeConfigDraft(data.config);
  const character = state.elements.find(el => el.id === config.elementId);
  const update = (patch: Record<string, unknown>) => {
    editDraft(patch);
    updateNodeData(id, node => ({ config: { ...(node.data as WorkflowNodeData).config, ...patch } }));
  };
  const edit = (patch: Record<string, unknown>) => { update({ ...patch, enhanceUndo: undefined }); setNotice(''); };
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
  const sound = config.kind === 'sound';
  const designing = !sound && config.voiceMode === 'design';
  const voiceId = String(config.voiceId || character?.voice?.voiceId || '');
  const voiceName = String(config.voiceName || character?.voice?.voiceName || '');
  const voiceDescription = String(config.voiceDescription ?? character?.voice?.description ?? '');
  const previewScript = String(config.voiceSampleText ?? 'Every voice has a story to tell. Take a moment, listen closely, and imagine where this one might lead. Sometimes, the smallest detail makes all the difference.');
  const previewName = String(config.voiceDesignName ?? character?.name ?? 'New voice');
  const previews = (Array.isArray(config.voicePreviews) ? config.voicePreviews : []) as ElevenLabsPreview[];
  const enhanceField = sound ? 'text' : designing ? 'voiceDescription' : 'direction';
  const enhanceInput = designing ? voiceDescription : String(config[enhanceField] || '');
  const enhanceKind: AudioEnhanceKind = sound ? 'sound' : designing ? 'voice' : 'direction';
  const feedbackByKind = config.enhanceFeedback as Partial<Record<AudioEnhanceKind, string>> | undefined;
  const feedback = String(feedbackByKind?.[enhanceKind] || '');
  async function work(label: string, fn: () => Promise<void>) {
    if (operation.current || running) return;
    operation.current = true; setBusy(true); setActivity(label); setError(''); setNotice('');
    try { await fn(); }
    catch (cause) { if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(cause instanceof Error ? cause.message : 'Could not finish this action.'); }
    finally { operation.current = false; setBusy(false); setActivity(''); }
  }
  async function enhance() {
    await work(feedback.trim() ? 'Rewriting prompt…' : 'Enhancing wording…', async () => {
      const controller = new AbortController(); enhancement.current = controller;
      const kind = enhanceKind;
      const instructions = feedback.trim();
      const previous = config.enhancePending as { requestId: string; kind: string; text: string; feedback?: string } | undefined;
      const requestId = previous?.kind === kind && previous.text === enhanceInput && (previous.feedback || '') === instructions ? previous.requestId : crypto.randomUUID();
      update({ enhancePending: { requestId, kind, text: enhanceInput, feedback: instructions } });
      const result = await enhanceAudioText(kind, enhanceInput, controller.signal, requestId, instructions).catch(cause => {
        if (cause?.enhancementFinished) update({ enhancePending: undefined });
        throw cause;
      });
      const latest = getNode(id)?.data as WorkflowNodeData | undefined;
      if (!latest || controller.signal.aborted) return;
      const current = enhanceField === 'voiceDescription' ? String(latest.config.voiceDescription ?? character?.voice?.description ?? '') : String(latest.config[enhanceField] || '');
      const latestFeedback = latest.config.enhanceFeedback as Partial<Record<AudioEnhanceKind, string>> | undefined;
      const latestKind = latest.config.kind === 'sound' ? 'sound' : latest.config.voiceMode === 'design' ? 'voice' : 'direction';
      if (current !== enhanceInput || String(latestFeedback?.[kind] || '').trim() !== instructions || latestKind !== kind || latest.config.elementId !== config.elementId) throw new Error('Your text changed while enhancing. Try again with the new wording.');
      update({ enhancePending: undefined, [enhanceField]: result, enhanceUndo: { field: enhanceField, text: enhanceInput }, enhanceFeedback: { ...latestFeedback, [kind]: '' }, ...(kind === 'direction' ? { directionOpen: true } : {}) });
      setNotice(instructions ? 'Prompt rewritten from your feedback. You can edit it or undo.' : 'Wording refined. You can edit it or undo.');
    });
  }
  async function designVoice() {
    await work('Designing voice previews…', async () => {
      if (voiceDescription.trim().length < 20) throw new Error('Describe the voice in at least 20 characters.');
      if (previewScript.trim().length < 100 || previewScript.trim().length > 1000) throw new Error('Use 100–1,000 characters for the preview script.');
      const result = await elevenLabs.design(voiceDescription, previewScript, String(config.voiceLanguage || 'en'));
      update({ voicePreviews: result.previews, voicePreviewDescription: voiceDescription, voiceSaveDescription: voiceDescription });
      setNotice('Listen to the previews and choose your voice.');
    });
  }
  async function chooseVoice(preview: ElevenLabsPreview) {
    await work('Saving your voice…', async () => {
      const description = String(config.voiceSaveDescription ?? config.voicePreviewDescription ?? voiceDescription);
      if (description.length > 500) throw new Error('Shorten the library description below to 500 characters before saving. Your full design description stays above.');
      const saved = await elevenLabs.saveVoice(preview.id, previewName.trim(), description, preview.viewStateId);
      const latest = getNode(id)?.data as WorkflowNodeData | undefined;
      if (!latest || latest.config.elementId !== config.elementId) return;
      update({ voiceId: saved.id, voiceName: saved.name, voiceMode: 'existing', voicePreviews: [], enhanceUndo: undefined });
      const target = stateRef.current.elements.find(el => el.id === config.elementId);
      if (target && config.saveVoiceToCharacter !== false) dispatch({ type: 'UPDATE_ELEMENT', elementId: target.id, updates: { voice: { ...target.voice, description: String(config.voicePreviewDescription || voiceDescription), provider: 'elevenlabs', voiceId: saved.id, voiceName: saved.name, referenceAudio: { id: crypto.randomUUID(), url: preview.url, createdAt: new Date().toISOString(), source: 'generated' } }, updatedAt: new Date().toISOString() } });
      setNotice(`${saved.name} is ready. Add your dialogue below.`);
    });
  }
  const enhancer = <div className="vox-enhancer">
    <div className="vox-enhancer__heading"><span><MagicWandIcon /> AI prompt enhancer</span><button type="button" role="switch" aria-label="AI prompt enhancer" aria-checked={!!config.enhanceEnabled} className="vox-switch" disabled={!!running} onClick={() => update({ enhanceEnabled: !config.enhanceEnabled })}><span /></button></div>
    {config.enhanceEnabled === true && <div className="vox-enhancer__tools">
      <label>What should change? <span>Optional</span><textarea rows={3} value={feedback} onChange={e => { update({ enhanceFeedback: { ...feedbackByKind, [enhanceKind]: e.target.value } }); setNotice(''); }} placeholder={designing ? 'Too gravelly. Make him sound younger, warmer, and more natural…' : sound ? 'The rain is too intense. Make it softer, with the thunder further away…' : 'It sounds too much like an announcer. Make the delivery quieter and more conversational…'} /></label>
      <button type="button" className="vox-refine-button" disabled={!!running || (!enhanceInput.trim() && !feedback.trim())} onClick={() => void enhance()}><MagicWandIcon /> {feedback.trim() ? 'Rewrite prompt' : 'Enhance wording'}</button>
      <p>{designing ? 'Refines your voice description. Create new previews to hear the change.' : sound ? 'Refines your sound brief. Generate audio to hear the change.' : 'Refines performance direction. Your dialogue stays word for word.'}</p>
    </div>}
    {!!config.enhanceUndo && <button type="button" className="vox-text-button" disabled={!!running} onClick={() => { const previous = config.enhanceUndo as { field: string; text: string }; if (['voiceDescription', 'direction', 'text'].includes(previous.field)) update({ [previous.field]: previous.text, enhanceUndo: undefined }); setNotice('Original wording restored.'); }}><ReloadIcon /> Undo enhancement</button>}
  </div>;
  return <BaseNode nodeType="elevenLabsAudio" className="vox-node" title={data.label || 'ElevenLabs Audio'} selected={!!selected} isRunning={!!running} meta={running ? activity || 'Creating audio' : audioUrl ? 'Audio ready' : 'Voice studio'}>
    <div className="vox-studio nodrag nowheel">
      {running && <div className="vox-prism" role="status">
        <div className="vox-prism__wave" aria-hidden="true">{Array.from({ length: 13 }, (_, index) => <i key={index} />)}</div>
        <strong>{activity || (busy ? 'Saving audio…' : 'Generating audio…')}</strong>
      </div>}
      <fieldset disabled={!!running} className="vox-fields">
        <div className="vox-format" role="group" aria-label="Audio type"><button type="button" aria-pressed={!sound} onClick={() => edit({ kind: 'speech' })}><SpeakerLoudIcon /> Speech</button><button type="button" aria-pressed={sound} onClick={() => edit({ kind: 'sound' })}><MixerHorizontalIcon /> Sound effects</button></div>
        {!sound && <>
          <label className="vox-character">Character <span>Optional</span><select value={String(config.elementId || '')} onChange={e => edit({ elementId: e.target.value, voiceId: '', voiceName: '' })}><option value="">Standalone voice</option>{state.elements.filter(el => el.type === 'character').map(el => <option key={el.id} value={el.id}>{el.name}</option>)}</select></label>
          <div className="vox-modes" role="group" aria-label="Voice source"><button type="button" aria-pressed={!designing} onClick={() => edit({ voiceMode: 'existing' })}>Use a voice</button><button type="button" aria-pressed={designing} onClick={() => edit({ voiceMode: 'design' })}>Design a voice</button></div>
        </>}
        <ElevenLabsConnection compact disabled={!!running} showVoices={!sound && !designing} voiceId={voiceId} voiceName={voiceName} onVoice={voice => edit({ voiceId: voice.id, voiceName: voice.name })} />
        {designing && <section className="vox-design" aria-label="Design a voice">
          <label>Describe the voice<textarea rows={4} value={voiceDescription} onChange={e => edit({ voiceDescription: e.target.value })} placeholder="A warm, low voice. A little gravel, a soft Southern accent, and the calm confidence of someone who has seen it all." /></label>
          {enhancer}
          <div className="vox-row"><label>Voice name<input value={previewName} onChange={e => update({ voiceDesignName: e.target.value })} placeholder="Name your voice" /></label><label>Language<select value={String(config.voiceLanguage || 'en')} onChange={e => update({ voiceLanguage: e.target.value })}><option value="en">English</option><option value="es">Spanish</option><option value="fr">French</option><option value="de">German</option><option value="pt">Portuguese</option><option value="ja">Japanese</option><option value="zh">Chinese</option><option value="ko">Korean</option><option value="it">Italian</option><option value="hi">Hindi</option><option value="ar">Arabic</option></select></label></div>
          <details className="vox-disclosure"><summary>Preview script <span>{previewScript.length} characters</span></summary><label><span className="vox-sr-only">Voice preview script</span><textarea rows={4} value={previewScript} onChange={e => update({ voiceSampleText: e.target.value })} /></label><p>Used only to audition the voice. Your dialogue below is separate.</p></details>
          {!!previews.length && <div className="vox-previews" aria-label="Voice previews"><div className="vox-section-heading">Choose your voice<span>{previews.length} previews</span></div>
            {previews.map((preview, index) => <div className="vox-preview" key={preview.id}><div><span>Voice {String(index + 1).padStart(2, '0')}</span><button type="button" className="vox-text-button" disabled={!!running} onClick={() => void chooseVoice(preview)}><CheckIcon /> Use voice</button></div><audio controls preload="none" src={preview.url} aria-label={`Voice preview ${index + 1}`} /></div>)}
            {String(config.voicePreviewDescription || '').length > 500 && <label>Library description<textarea rows={3} value={String(config.voiceSaveDescription || '')} onChange={e => update({ voiceSaveDescription: e.target.value })} /><span>20–500 characters for your saved voice.</span></label>}
            {character && <label className="vox-check"><input type="checkbox" checked={config.saveVoiceToCharacter !== false} onChange={e => update({ saveVoiceToCharacter: e.target.checked })} /> Save voice to {character.name}</label>}
          </div>}
        </section>}
        {!designing && <><section className="vox-script" aria-label={sound ? 'Sound brief' : 'Dialogue'}><div className="vox-section-heading">{sound ? 'The sound' : 'The dialogue'}<span>{String(config.text || '').length} characters</span></div><label><span className="vox-sr-only">{sound ? 'Sound brief' : 'Dialogue'}</span><textarea rows={4} value={String(config.text || '')} onChange={e => edit({ text: e.target.value })} placeholder={sound ? 'Rain on a tin roof. Close, soft, steady, with distant thunder…' : 'What should they say?'} /></label></section>
        <details className="vox-disclosure" open={config.directionOpen === true} onToggle={e => { if (e.currentTarget.open !== (config.directionOpen === true)) update({ directionOpen: e.currentTarget.open }); }}><summary>Performance direction<span>{config.direction ? 'Added' : 'Optional'}</span></summary><label><span className="vox-sr-only">Performance direction</span><textarea rows={2} value={String(config.direction || '')} onChange={e => edit({ direction: e.target.value })} placeholder="Quietly, with a hint of a smile. Slow down on the last line." /></label></details>
        {enhancer}</>}
        {sound && <label>Duration <span>Seconds · optional</span><input type="number" min="0.5" max="30" step="0.5" value={String(config.durationSeconds || '')} placeholder="Automatic" onChange={e => edit({ durationSeconds: e.target.value ? Number(e.target.value) : undefined })} /></label>}
      </fieldset>
      {audioUrl && <section className="vox-result" aria-label="Generated audio"><div className="vox-section-heading"><span><SpeakerLoudIcon /> Your audio</span><span>Ready</span></div><audio controls preload="metadata" src={audioUrl} aria-label="ElevenLabs audio result" /></section>}
      {notice && <p className="vox-status" role="status">{notice}</p>}
      {data.result?.error && <p role="alert" className="vox-error">{data.result.error}</p>}
      {error && <p role="alert" className="vox-error">{error}</p>}
      <footer className="vox-footer"><button type="button" className="vox-generate" disabled={!!running || (designing ? !voiceDescription.trim() || !previewName.trim() : !String(config.text || '').trim() || (!sound && !voiceId))} onClick={() => { setError(''); setNotice(''); if (designing) void designVoice(); else void runNode(id); }}>{designing ? <MagicWandIcon /> : <PlayIcon />} {running ? activity || 'Generating audio…' : designing ? previews.length ? 'Create new previews' : 'Create voice previews' : pending ? 'Recover this take' : audioUrl ? 'Generate another take' : 'Generate audio'}</button>
        {pending && !running && <button type="button" className="vox-text-button" onClick={() => updateNodeData(id, { result: { status: 'idle', ...(audioUrl ? { url: audioUrl } : {}) } })}>Start a new take</button>}
        <input ref={input} hidden type="file" accept="audio/*,.mp3,.wav,.m4a" onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
        <button type="button" className="vox-upload" disabled={!!running} onClick={() => input.current?.click()}><UploadIcon /> Upload audio instead</button><p>Saved to CineGen · Uses ElevenLabs credits</p>
      </footer>
    </div>
  </BaseNode>;
});
