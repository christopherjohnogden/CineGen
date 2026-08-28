import type { ClipLengthSec, DirectorShow } from '@/types/director';
import { CLIP_LENGTHS } from '@/types/director';
import { DirectorResolutionPicker } from './director-resolution-picker';
import { getDirectorAdapter } from '@/lib/director/video-adapter';

const ASPECTS = ['16:9', '9:16', '1:1', '21:9', '4:3'];

interface DirectorSetupDrawerProps {
  show: DirectorShow;
  onChange: (show: DirectorShow) => void;
}

export function DirectorSetupDrawer({ show, onChange }: DirectorSetupDrawerProps) {
  const adapter = getDirectorAdapter(show.adapterId);
  const maxDurationSec = adapter.capabilities.maxDurationSec;
  const clipLengths = maxDurationSec === undefined
    ? CLIP_LENGTHS
    : CLIP_LENGTHS.filter((value) => value <= maxDurationSec);
  const clipLengthTitle = maxDurationSec === undefined
    ? `How long each shotlisted clip runs. ${adapter.label} checks the selected model's live duration options when rendering. Existing clips keep their timing.`
    : `How long each shotlisted clip runs. ${adapter.label} supports up to ${maxDurationSec}s. Existing clips keep their timing.`;
  return (
    <div className="dsetup">
      <Seg
        label="Clip length"
        value={String(show.clipLengthSec)}
        options={clipLengths.map((value) => ({ id: String(value), label: `${value}s` }))}
        onChange={(next) => onChange({ ...show, clipLengthSec: Number(next) as ClipLengthSec })}
        title={clipLengthTitle}
      />
      <Seg
        label="Aspect"
        value={show.aspectRatio}
        options={ASPECTS.map((value) => ({ id: value, label: value }))}
        onChange={(aspectRatio) => onChange({ ...show, aspectRatio })}
      />
      <DirectorResolutionPicker
        value={show.resolution}
        onChange={(resolution) => onChange({ ...show, resolution })}
      />
      <label className="dsetup-field--audio dtog" title="Include audio on generated clips">
        <input
          type="checkbox"
          checked={show.generateAudio}
          onChange={(event) => onChange({ ...show, generateAudio: event.target.checked })}
        />
        <span className="dtog-track" aria-hidden><span className="dtog-thumb" /></span>
        <span className="dtog-label">Generate audio</span>
      </label>
    </div>
  );
}

function Seg({
  label,
  value,
  options,
  onChange,
  title,
}: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onChange: (value: string) => void;
  title?: string;
}) {
  return (
    <div className="dsetup-field" title={title}>
      <span className="director-tab__label">{label}</span>
      <div className="dgen-seg" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`dgen-seg-btn${option.id === value ? ' dgen-seg-btn--on' : ''}`}
            aria-pressed={option.id === value}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
