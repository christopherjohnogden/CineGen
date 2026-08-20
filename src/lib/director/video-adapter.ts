import type { DirectorClip, DirectorShow, IsolateVariant } from '@/types/director';
import { bodyForVariant, compileClipBody, compileOptionsForShow, prependPrefix } from './prompt-compiler';
import { isolatedPrompt, rewritePrefixForIsolate, withFramingReference } from './isolate-prompt';
import { compileLookBible } from './look-bible';
import { clipWithResolvedStaging } from './framing-reserve';

export interface DirectorVideoCapabilities {
  multiPrompt: boolean;
  maxDurationSec: number;
  resolutions: string[];
  aspectRatios: string[];
  referenceInputs: boolean;
  generateAudio: boolean;
}

export interface DirectorGenerateRequest {
  adapterId: string;
  label: string;
  provider: 'higgsfield' | 'fal' | 'kie';
  modelId: string;
  outputType: 'video';
  prompt: string;
  durationSec: number;
  params: Record<string, unknown>;
  medias?: Array<{ value: string; role: 'image' | 'start_image' | 'end_image' | 'video' | 'audio' }>;
}

export interface DirectorVideoAdapter {
  id: string;
  label: string;
  provider: 'higgsfield' | 'fal' | 'kie';
  modelId: string;
  capabilities: DirectorVideoCapabilities;
  buildRequest: (args: {
    show: DirectorShow;
    clip: DirectorClip;
    variant: IsolateVariant;
    referenceImages?: string[];
  }) => DirectorGenerateRequest;
}

function compiledPrompt(show: DirectorShow, raw: DirectorClip, variant: IsolateVariant): {
  prompt: string;
  durationSec: number;
  isolated: boolean;
} {
  const clip = clipWithResolvedStaging(show, raw, variant);
  const prefix = compileLookBible(show);
  const options = compileOptionsForShow(show, clip);
  if (variant.kind === 'full') {
    const body = withFramingReference(clip, bodyForVariant(clip, variant, compileClipBody(clip, options), options), false);
    return {
      prompt: prependPrefix(prefix, body),
      durationSec: clip.seconds,
      isolated: false,
    };
  }
  const isolated = isolatedPrompt(clip, variant.beatN, variant.mode, {
    aspectRatio: show.aspectRatio,
    ...options,
  });
  if (!isolated) {
    const body = withFramingReference(clip, compileClipBody(clip, options), false);
    return {
      prompt: prependPrefix(prefix, body),
      durationSec: clip.seconds,
      isolated: false,
    };
  }
  const durationSec = variant.mode === 'native'
    ? (clip.beats.find((beat) => beat.n === variant.beatN)?.dur ?? clip.seconds)
    : clip.seconds;
  const body = bodyForVariant(clip, variant, isolated, options);
  return {
    prompt: prependPrefix(rewritePrefixForIsolate(prefix), body),
    durationSec,
    isolated: true,
  };
}

export const seedance25Adapter: DirectorVideoAdapter = {
  id: 'seedance-2.5',
  label: 'Seedance 2.5',
  provider: 'higgsfield',
  modelId: 'seedance_2_5',
  capabilities: {
    multiPrompt: true,
    maxDurationSec: 30,
    resolutions: ['480p', '720p', '1080p'],
    aspectRatios: ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    referenceInputs: true,
    generateAudio: true,
  },
  buildRequest({ show, clip, variant, referenceImages = [] }) {
    const compiled = compiledPrompt(show, clip, variant);
    // Live `higgsfield model get seedance_2_5` has no genre / multi_shots / multi_prompt.
    // Genre and shot list already live in the compiled prompt (look bible + clip body).
    const params: Record<string, unknown> = {
      aspect_ratio: show.aspectRatio,
      duration: compiled.durationSec,
      resolution: show.resolution,
      generate_audio: show.generateAudio,
    };
    const medias = [...new Set(referenceImages.map((url) => url.trim()).filter(Boolean))]
      .map((value) => ({ value, role: 'image' as const }));
    let prompt = compiled.prompt;
    if (medias.length > 0) {
      // t2v rejects reference media; omni_reference is how Seedance 2.5 locks to stills.
      params.mode = 'omni_reference';
      prompt = `${prompt}\n\nREFERENCE STILLS — the attached images are LOCKED identity for the ACTIVE REFERENCES tagged above. Faces, bodies, wardrobe and locations must match those stills.`;
    }
    return {
      adapterId: this.id,
      label: this.label,
      provider: this.provider,
      modelId: this.modelId,
      outputType: 'video',
      prompt,
      durationSec: compiled.durationSec,
      params,
      ...(medias.length > 0 ? { medias } : {}),
    };
  },
};

const ADAPTERS: DirectorVideoAdapter[] = [seedance25Adapter];

export function getDirectorAdapter(id: string | undefined): DirectorVideoAdapter {
  return ADAPTERS.find((adapter) => adapter.id === id) ?? seedance25Adapter;
}

export function listDirectorAdapters(): DirectorVideoAdapter[] {
  return ADAPTERS;
}
