import type { DirectorShow } from '@/types/director';
import { CLIP_LENGTHS } from '@/types/director';
import { listDirectorAdapters } from '@/lib/director/video-adapter';

interface DirectorSetupDrawerProps {
  show: DirectorShow;
  onChange: (show: DirectorShow) => void;
}

export function DirectorSetupDrawer({ show, onChange }: DirectorSetupDrawerProps) {
  const adapters = listDirectorAdapters();
  return (
    <div className="director-tab__drawer-inner">
      <div>
        <label className="director-tab__label" htmlFor="director-length">Clip length</label>
        <select id="director-length" value={show.clipLengthSec} onChange={(event) => onChange({ ...show, clipLengthSec: Number(event.target.value) as typeof show.clipLengthSec })}>
          {CLIP_LENGTHS.map((value) => <option key={value} value={value}>{value}s</option>)}
        </select>
      </div>
      <div>
        <label className="director-tab__label" htmlFor="director-adapter">Adapter</label>
        <select id="director-adapter" value={show.adapterId} onChange={(event) => onChange({ ...show, adapterId: event.target.value })}>
          {adapters.map((adapter) => <option key={adapter.id} value={adapter.id}>{adapter.label}</option>)}
        </select>
      </div>
      <div>
        <label className="director-tab__label" htmlFor="director-aspect">Aspect</label>
        <select id="director-aspect" value={show.aspectRatio} onChange={(event) => onChange({ ...show, aspectRatio: event.target.value })}>
          {['16:9', '9:16', '1:1', '21:9', '4:3'].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </div>
      <div>
        <label className="director-tab__label" htmlFor="director-res">Resolution</label>
        <select id="director-res" value={show.resolution} onChange={(event) => onChange({ ...show, resolution: event.target.value })}>
          {['480p', '720p', '1080p'].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </div>
      <label className="director-tab__row" style={{ alignItems: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>
        <input type="checkbox" checked={show.generateAudio} onChange={(event) => onChange({ ...show, generateAudio: event.target.checked })} style={{ width: 'auto' }} />
        Generate audio
      </label>
    </div>
  );
}
