import type { ClipLengthSec, DirectorShow } from '@/types/director';
import { CLIP_LENGTHS } from '@/types/director';
import { listDirectorAdapters } from '@/lib/director/video-adapter';

const ASPECTS = ['16:9', '9:16', '1:1', '21:9', '4:3'];
const RESOLUTIONS = ['480p', '720p', '1080p'];

interface DirectorSetupDrawerProps {
  show: DirectorShow;
  onChange: (show: DirectorShow) => void;
}

export function DirectorSetupDrawer({ show, onChange }: DirectorSetupDrawerProps) {
  const adapters = listDirectorAdapters();
  return (
    <div className="dsetup">
      <Seg
        label="Clip length"
        value={String(show.clipLengthSec)}
        options={CLIP_LENGTHS.map((value) => ({ id: String(value), label: `${value}s` }))}
        onChange={(next) => onChange({ ...show, clipLengthSec: Number(next) as ClipLengthSec })}
        title="How long each shotlisted clip runs. Applies to the next shotlist run — existing clips keep their timing."
      />
      <div className="dsetup-field dsetup-field--adapter">
        <label className="director-tab__label" htmlFor="director-adapter">Adapter</label>
        <select
          id="director-adapter"
          value={show.adapterId}
          onChange={(event) => onChange({ ...show, adapterId: event.target.value })}
        >
          {adapters.map((adapter) => (
            <option key={adapter.id} value={adapter.id}>{adapter.label}</option>
          ))}
        </select>
      </div>
      <Seg
        label="Aspect"
        value={show.aspectRatio}
        options={ASPECTS.map((value) => ({ id: value, label: value }))}
        onChange={(aspectRatio) => onChange({ ...show, aspectRatio })}
      />
      <Seg
        label="Resolution"
        value={show.resolution}
        options={RESOLUTIONS.map((value) => ({ id: value, label: value }))}
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
