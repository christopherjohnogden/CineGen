// Official contracts: docs.topview.ai/reference/avatar4_submit_task and video_avatar_submit_task.
export function topviewMediaToolUnavailable(model, tools, apiKey = false) {
  if (model === 'Image Upscale' || model === 'Video Upscale') {
    return 'Topview offers this on its website, but has not exposed an upscaling endpoint through this connection. No processing will be started.';
  }
  if (model === 'Video Lip Sync') {
    return apiKey ? undefined : 'Topview video lip sync requires a Topview API-key connection. Your MCP connection does not expose this tool. No provider or billing balance will be switched.';
  }
  if (tools && !tools.includes('topview_avatar_video')) return 'Talking avatars are not available through this Topview connection.';
  return undefined;
}

export function buildTopviewMediaToolRequest(model, prompt, media, boardId) {
  const kind = (item) => /audio/.test(item.role ?? '') ? 'audio' : /video/.test(item.role ?? '') ? 'video' : 'image';
  const visualKind = model === 'Video Lip Sync' || model === 'Video Upscale' ? 'video' : 'image';
  const visuals = media.filter(item => kind(item) === visualKind);
  const audios = media.filter(item => kind(item) === 'audio');
  const needsAudio = model.startsWith('Avatar') || model === 'Video Lip Sync';
  if (visuals.length !== 1 || (needsAudio && audios.length !== 1) || media.length !== (needsAudio ? 2 : 1)) {
    throw new Error(`${model} requires exactly one ${visualKind}${needsAudio ? ' and one audio file' : ''}. Remove extra references before running.`);
  }
  if (model.startsWith('Avatar') && prompt.length > 600) throw new Error('Topview allows up to 600 characters of avatar motion direction. Your text has been preserved; shorten it before running.');
  if (model === 'Image Upscale' || model === 'Video Upscale') throw new Error(topviewMediaToolUnavailable(model));
  if (model === 'Video Lip Sync') return {
    taskType: 'lip_sync',
    request: { avatarSourceFrom: '0', videoFileId: visuals[0].fileId, audioSourceFrom: '0', audioFileId: audios[0].fileId, modeType: '0', isSave2CustomAiAvatar: false },
  };
  return {
    taskType: 'avatar_video',
    request: { mode: model === 'Avatar 4 Fast' ? 'avatar4Fast' : 'avatar4', templateImageFileId: visuals[0].fileId,
      scriptMode: 'audio', audioFileId: audios[0].fileId, offPeak: false, saveCustomAiAvatar: 'false',
      ...(prompt.trim() ? { customMotion: prompt.trim() } : {}), ...(boardId ? { boardId } : {}) },
  };
}
