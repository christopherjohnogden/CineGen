import { createFalMediaStager } from './_shared.mjs';

export const elementsCapabilities = Object.freeze({
  publicUrlPassThrough: true,
  webMediaFalStaging: true,
  desktopFilePaths: false,
  localAudioPreExtraction: false,
});

/**
 * Browser uploads already land under /media through POST /api/uploads. These
 * handlers turn that server-local token into a provider-readable fal CDN URL,
 * or preserve an already-public URL after validation.
 */
export function createElementsHandlers(options = {}) {
  const stageMedia = options.stageMedia ?? createFalMediaStager(options);

  return {
    uploadTranscriptionSource: async (sourceUrl, apiKey) => ({
      url: await stageMedia(sourceUrl, apiKey, 'Transcription source'),
    }),

    uploadMediaSource: async (sourceUrl, apiKey) => ({
      url: await stageMedia(sourceUrl, apiKey, 'Media source'),
    }),
  };
}

export const elementsHandlers = createElementsHandlers();
