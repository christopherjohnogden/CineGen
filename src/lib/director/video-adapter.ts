import type { DirectorClip, DirectorShow, IsolateVariant } from '@/types/director';
import { bodyForVariant, compileClipBody, prependPrefix, voicesFromBreakdown } from './prompt-compiler';
import { isolatedPrompt, rewritePrefixForIsolate, withFramingReference } from './isolate-prompt';
import { compileLookBible } from './look-bible';

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
  }) => DirectorGenerateRequest;
}

function compiledPrompt(show: DirectorShow, clip: DirectorClip, variant: IsolateVariant): {
  prompt: string;
  durationSec: number;
  isolated: boolean;
} {
  const prefix = compileLookBible(show);
  const options = { voices: voicesFromBreakdown(show.breakdown) };
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
    voices: options.voices,
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
  buildRequest({ show, clip, variant }) {
    const compiled = compiledPrompt(show, clip, variant);
    const params: Record<string, unknown> = {
      aspect_ratio: show.aspectRatio,
      duration: compiled.durationSec,
      resolution: show.resolution,
      generate_audio: show.generateAudio,
      genre: show.genre,
    };
    if (!compiled.isolated && clip.beats.length > 1) {
      params.multi_shots = true;
      params.multi_shot_mode = 'custom';
      params.multi_prompt = clip.beats.map((beat) => ({
        prompt: beat.text,
        duration: beat.dur,
      }));
    } else {
      params.multi_shots = false;
    }
    return {
      adapterId: this.id,
      label: this.label,
      provider: this.provider,
      modelId: this.modelId,
      outputType: 'video',
      prompt: compiled.prompt,
      durationSec: compiled.durationSec,
      params,
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
