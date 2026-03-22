

import { useState, useCallback, useRef, useEffect } from 'react';
import { getApiKey } from '@/lib/utils/api-key';
import { toFileUrl } from '@/lib/utils/file-url';
import type { Clip } from '@/types/timeline';
import { clipEffectiveDuration } from '@/types/timeline';
import type { Asset } from '@/types/project';

const GENRE_OPTIONS = [
  'Cinematic', 'Electronic', 'Orchestral', 'Hip Hop', 'Rock', 'Pop',
  'Jazz', 'Classical', 'Ambient', 'R&B', 'Folk', 'Country',
  'Reggae', 'Latin', 'Blues', 'Funk', 'Soul', 'Metal',
  'Indie', 'Lo-fi', 'Synthwave', 'Drum & Bass', 'House', 'Techno',
];

const MOOD_OPTIONS = [
  'Epic', 'Tense', 'Uplifting', 'Melancholic', 'Peaceful', 'Dark',
  'Mysterious', 'Playful', 'Romantic', 'Aggressive', 'Dreamy', 'Hopeful',
  'Anxious', 'Triumphant', 'Nostalgic', 'Eerie', 'Joyful', 'Somber',
  'Suspenseful', 'Whimsical', 'Powerful', 'Serene', 'Intense', 'Bittersweet',
];

const STYLE_OPTIONS = [
  'Orchestral', 'Acoustic', 'Minimalist', 'Layered', 'Ethereal', 'Gritty',
  'Polished', 'Raw', 'Atmospheric', 'Percussive', 'Melodic', 'Textural',
  'Retro', 'Modern', 'Experimental', 'Hybrid', 'Analog', 'Digital',
  'Cinematic Score', 'Trailer Music', 'Underscore', 'Sound Design',
];

const TEMPO_OPTIONS = [
  'Very Slow (< 60 BPM)', 'Slow (60–80 BPM)', 'Moderate (80–110 BPM)',
  'Medium (110–130 BPM)', 'Fast (130–150 BPM)', 'Very Fast (150+ BPM)',
];

/** Dropdown field with preset options + custom "Other" input */
function FieldSelect({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const isCustom = value !== '' && !options.includes(value);
  const [showCustom, setShowCustom] = useState(isCustom);

  const handleSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    if (v === '__other__') {
      setShowCustom(true);
      onChange('');
    } else {
      setShowCustom(false);
      onChange(v);
    }
  };

  if (showCustom) {
    return (
      <div className="music-popup__field-wrap">
        <input
          className="music-popup__field"
          placeholder={`Custom ${label.toLowerCase()}...`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          autoFocus
        />
        <button
          type="button"
          className="music-popup__field-back"
          onClick={() => { setShowCustom(false); onChange(''); }}
          disabled={disabled}
          title="Back to list"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <select
      className="music-popup__field music-popup__select"
      value={value}
      onChange={handleSelect}
      disabled={disabled}
    >
      <option value="">{label}</option>
      {options.map((opt) => (
        <option key={opt} value={opt}>{opt}</option>
      ))}
      <option value="__other__">Other...</option>
    </select>
  );
}

/** ElevenLabs duration options in ms */
const DURATION_OPTIONS = [15000, 30000, 60000, 120000, 180000, 300000] as const;

/** Snap to the smallest ElevenLabs duration option that can contain the selection */
function snapDurationMs(seconds: number): number {
  const ms = seconds * 1000;
  for (const opt of DURATION_OPTIONS) {
    if (opt >= ms) return opt;
  }
  return DURATION_OPTIONS[DURATION_OPTIONS.length - 1];
}

function formatDurationLabel(ms: number): string {
  if (ms < 60000) return `${ms / 1000}s`;
  return `${ms / 60000}m`;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Find video clips that overlap a time range */
function findVideoClipsInRange(
  clips: { clip: Clip; asset: Asset }[],
  startTime: number,
  endTime: number,
): { clip: Clip; asset: Asset }[] {
  return clips.filter(({ clip, asset }) => {
    if (asset.type !== 'video') return false;
    const effEnd = clip.startTime + clipEffectiveDuration(clip);
    return clip.startTime < endTime && effEnd > startTime;
  });
}

/** Extract a single middle frame from a video URL (client-side) */
function extractOneFrame(url: string, signal: AbortSignal): Promise<Blob | null> {
  return new Promise<Blob | null>((resolve) => {
    if (signal.aborted) { resolve(null); return; }
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'metadata';
    video.src = url;

    const timeout = setTimeout(() => { video.src = ''; resolve(null); }, 8000);

    video.addEventListener('loadedmetadata', () => {
      video.currentTime = (video.duration || 2) / 2;
    }, { once: true });

    video.addEventListener('seeked', () => {
      clearTimeout(timeout);
      if (signal.aborted) { resolve(null); return; }
      try {
        const size = 256;
        const canvas = document.createElement('canvas');
        const scale = Math.min(size / video.videoWidth, size / video.videoHeight, 1);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.6);
          return;
        }
      } catch { /* CORS */ }
      resolve(null);
    }, { once: true });

    video.addEventListener('error', () => { clearTimeout(timeout); resolve(null); }, { once: true });
    video.load();
  });
}

/** Extract & upload frames from multiple clips in parallel */
async function analyzeClipFrames(
  clips: { clip: Clip; asset: Asset }[],
  signal: AbortSignal,
): Promise<string[]> {
  // Extract one frame per clip, all in parallel
  const blobs = await Promise.all(
    clips.map(({ asset }) => extractOneFrame(toFileUrl(asset.fileRef || asset.url), signal)),
  );
  const validBlobs = blobs.filter((b): b is Blob => b !== null);
  if (validBlobs.length === 0 || signal.aborted) return [];

  // Upload all frames in parallel
  const apiKey = getApiKey();
  const urls = await Promise.all(
    validBlobs.map(async (blob) => {
      try {
        const buffer = await blob.arrayBuffer();
        const result = await window.electronAPI.elements.upload(
          { buffer, name: 'frame.jpg', type: 'image/jpeg' },
          apiKey,
        );
        return result.url;
      } catch {
        return null;
      }
    }),
  );
  return urls.filter((u): u is string => !!u);
}

interface MusicGenerationPopupProps {
  startTime: number;
  endTime: number;
  anchorX: number;
  anchorY: number;
  /** All clips with their assets for video analysis */
  videoClips: { clip: Clip; asset: Asset }[];
  /** Called when generation starts — receives a promise that resolves with the audio URL */
  onStartGeneration: (promise: Promise<{ url: string; durationSec: number }>, label: string) => void;
  onClose: () => void;
}

export function MusicGenerationPopup({
  startTime,
  endTime,
  anchorX,
  anchorY,
  videoClips,
  onStartGeneration,
  onClose,
}: MusicGenerationPopupProps) {
  // Fields
  const [genre, setGenre] = useState('');
  const [mood, setMood] = useState('');
  const [style, setStyle] = useState('');
  const [tempo, setTempo] = useState('');
  const [prompt, setPrompt] = useState('');
  const [instrumental, setInstrumental] = useState(true);

  // Video analysis
  const [analyzeVideo, setAnalyzeVideo] = useState(false);
  const [frameUrls, setFrameUrls] = useState<string[]>([]);
  const videoClipCount = findVideoClipsInRange(videoClips, startTime, endTime).length;

  // Generation
  const [phase, setPhase] = useState<'input' | 'analyzing-video' | 'generating-prompt' | 'generating-audio'>('input');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const rangeSec = endTime - startTime;
  const durationMs = snapDurationMs(rangeSec);
  const durationSec = durationMs / 1000;
  const actualDurationLabel = `${Math.round(rangeSec)}s`;
  const apiDurationLabel = formatDurationLabel(durationMs);

  // Close on Escape (only when not in textarea/input)
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        abortRef.current?.abort();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Close on backdrop click
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      abortRef.current?.abort();
      onClose();
    }
  }, [onClose]);

  // Reset frame data when toggle turns off
  useEffect(() => {
    if (!analyzeVideo) {
      setFrameUrls([]);
    }
  }, [analyzeVideo]);

  const handleGenerate = useCallback(async () => {
    setError(null);
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    try {
      let uploadedFrameUrls: string[] = [];

      // Step 1: Analyze video clips if toggle is on
      if (analyzeVideo) {
        const clips = findVideoClipsInRange(videoClips, startTime, endTime);
        if (clips.length > 0) {
          setPhase('analyzing-video');
          uploadedFrameUrls = await analyzeClipFrames(clips, signal);
          if (signal.aborted) return;
          setFrameUrls(uploadedFrameUrls);
        }
      }

      // Step 2: Generate prompt if fields are provided but prompt is empty
      let finalPrompt = prompt.trim();
      const hasFields = genre || mood || style || tempo;
      const needsPromptGen = analyzeVideo || (hasFields && !finalPrompt);

      if (needsPromptGen) {
        setPhase('generating-prompt');
        const { prompt: generated } = await window.electronAPI.music.generatePrompt({
          apiKey: getApiKey(),
          frameUrls: uploadedFrameUrls.length > 0 ? uploadedFrameUrls : undefined,
          genre: genre || undefined,
          style: style || undefined,
          mood: mood || undefined,
          tempo: tempo || undefined,
          additionalNotes: finalPrompt || undefined,
        });
        finalPrompt = generated;
        setPrompt(finalPrompt);
      }

      if (!finalPrompt) {
        setError('Enter a description or fill in the fields above');
        setPhase('input');
        return;
      }

      // Step 3: Build the audio generation promise and hand off to timeline
      const promptWithDuration = `${finalPrompt} (Duration: ${formatDurationLabel(durationMs)})`;

      const generationPromise = (async (): Promise<{ url: string; durationSec: number }> => {
        const data = await window.electronAPI.workflow.run({
          apiKey: getApiKey(),
          nodeId: 'timeline-music',
          nodeType: 'music',
          modelId: 'fal-ai/elevenlabs/music',
          inputs: {
            prompt: promptWithDuration,
            music_length_ms: durationMs,
            force_instrumental: instrumental,
            output_format: 'mp3_44100_128',
          },
        }) as Record<string, unknown>;
        const audio = data.audio as Record<string, unknown> | undefined;
        const url = audio?.url ?? data.url ?? data;
        if (typeof url !== 'string') throw new Error('No audio URL in response');
        return { url, durationSec };
      })();

      // Build a descriptive name from fields or prompt
      const parts = [genre, mood, style, tempo].filter(Boolean);
      let label: string;
      if (prompt.trim()) {
        // Use first ~40 chars of prompt
        const trimmed = prompt.trim();
        label = trimmed.length > 40 ? trimmed.slice(0, 40).trimEnd() + '...' : trimmed;
      } else if (parts.length > 0) {
        label = parts.join(' \u00B7 ');
      } else {
        label = `Music ${formatDurationLabel(durationMs)}`;
      }

      onStartGeneration(generationPromise, label);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError((err as Error).message);
        setPhase('input');
      }
    } finally {
      abortRef.current = null;
    }
  }, [prompt, genre, mood, style, tempo, analyzeVideo, videoClips, startTime, endTime, durationMs, durationSec, instrumental, onStartGeneration]);

  // Ctrl/Cmd+Enter to generate
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (phase === 'input') {
          handleGenerate();
        }
      }
    },
    [handleGenerate, phase],
  );

  const isGenerating = phase === 'analyzing-video' || phase === 'generating-prompt' || phase === 'generating-audio';

  // Position popup to the right of the created clip, clamped to viewport
  const [popupPos, setPopupPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    const el = popupRef.current;
    if (!el) return;
    const popupW = 400;
    const popupH = el.offsetHeight || 420;
    const pad = 12;

    // Place to the right of the anchor (end of drag)
    let left = anchorX + 16;
    if (left + popupW > window.innerWidth - pad) {
      left = anchorX - popupW - 16;
    }
    left = Math.max(pad, left);

    // Align popup bottom with clip bottom, clamp to viewport
    let top = anchorY - popupH;
    top = Math.max(pad, Math.min(top, window.innerHeight - popupH - pad));

    setPopupPos({ top, left });
  }, [anchorX, anchorY]);

  const popupStyle: React.CSSProperties = popupPos
    ? { position: 'fixed', left: popupPos.left, top: popupPos.top }
    : { position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };

  return (
    <div className="music-popup__backdrop" onMouseDown={handleBackdropClick}>
    <div ref={popupRef} className="music-popup" style={popupStyle} onKeyDown={handleKeyDown}>
      {/* Header */}
      <div className="music-popup__header">
        <svg className="music-popup__icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" />
        </svg>
        <span className="music-popup__title">Generate Music</span>
        <span className="music-popup__duration">
          {actualDurationLabel}
          {durationMs !== rangeSec * 1000 && (
            <span className="music-popup__duration-api"> → {apiDurationLabel}</span>
          )}
        </span>
      </div>

      {/* Analyze Video toggle */}
      {videoClipCount > 0 && (
        <div className="music-popup__analyze">
          <label className="music-popup__toggle">
            <span className="music-popup__toggle-label">Analyze Video</span>
            <button
              type="button"
              role="switch"
              aria-checked={analyzeVideo}
              className={`music-popup__switch${analyzeVideo ? ' music-popup__switch--on' : ''}`}
              onClick={() => setAnalyzeVideo((v) => !v)}
              disabled={isGenerating}
            >
              <span className="music-popup__switch-thumb" />
            </button>
          </label>
          {analyzeVideo && (
            <span className="music-popup__analyze-status">
              {videoClipCount} clip{videoClipCount > 1 ? 's' : ''} in range
            </span>
          )}
        </div>
      )}

      {/* Fields */}
      <div className="music-popup__fields">
        <FieldSelect label="Genre" options={GENRE_OPTIONS} value={genre} onChange={setGenre} disabled={isGenerating} />
        <FieldSelect label="Mood" options={MOOD_OPTIONS} value={mood} onChange={setMood} disabled={isGenerating} />
      </div>
      <div className="music-popup__fields">
        <FieldSelect label="Style" options={STYLE_OPTIONS} value={style} onChange={setStyle} disabled={isGenerating} />
        <FieldSelect label="Tempo" options={TEMPO_OPTIONS} value={tempo} onChange={setTempo} disabled={isGenerating} />
      </div>

      {/* Prompt */}
      <textarea
        className="music-popup__prompt"
        rows={3}
        placeholder="Describe the music, or leave blank to auto-generate from fields above..."
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        disabled={isGenerating}
      />

      {/* Controls */}
      {(
        <div className="music-popup__controls">
          <label className="music-popup__toggle">
            <span className="music-popup__toggle-label">Instrumental</span>
            <button
              type="button"
              role="switch"
              aria-checked={instrumental}
              className={`music-popup__switch${instrumental ? ' music-popup__switch--on' : ''}`}
              onClick={() => setInstrumental((v) => !v)}
              disabled={isGenerating}
            >
              <span className="music-popup__switch-thumb" />
            </button>
          </label>

          <button
            type="button"
            className="music-popup__generate"
            onClick={handleGenerate}
            disabled={isGenerating}
          >
            {isGenerating
              ? phase === 'analyzing-video' ? 'Analyzing clips...'
              : phase === 'generating-prompt' ? 'Writing prompt...'
              : 'Generating audio...'
              : 'Generate'}
          </button>
        </div>
      )}

      {/* Progress bar */}
      {isGenerating && (
        <div className="music-popup__progress-section">
          <div className="music-popup__progress-steps">
            <span className={`music-popup__step${phase === 'analyzing-video' ? ' music-popup__step--active' : ''}${phase === 'generating-prompt' || phase === 'generating-audio' ? ' music-popup__step--done' : ''}`}>
              {analyzeVideo ? (phase === 'analyzing-video' ? 'Analyzing clips...' : 'Clips analyzed') : ''}
            </span>
            <span className={`music-popup__step${phase === 'generating-prompt' ? ' music-popup__step--active' : ''}${phase === 'generating-audio' ? ' music-popup__step--done' : ''}`}>
              {phase === 'generating-prompt' ? 'Writing prompt...' : phase === 'generating-audio' ? 'Prompt ready' : ''}
            </span>
            <span className={`music-popup__step${phase === 'generating-audio' ? ' music-popup__step--active' : ''}`}>
              {phase === 'generating-audio' ? 'Generating audio...' : ''}
            </span>
          </div>
          <div className="music-popup__progress">
            <div className="music-popup__progress-bar" />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="music-popup__error">{error}</div>
      )}

      {/* Hints */}
      <div className="music-popup__hint">
        <kbd>⌘</kbd><kbd>↵</kbd> generate &middot; <kbd>Esc</kbd> close
      </div>
    </div>
    </div>
  );
}
