import type { Asset } from '@/types/project';
import { clipEffectiveDuration, type Timeline } from '@/types/timeline';
import { toFileUrl } from '@/lib/utils/file-url';

interface TimelineOverviewProps {
  timeline: Timeline;
  assets: Asset[];
  duration: number;
  currentTime: number;
  onOpen: () => void;
}

/** A lightweight map of the actual edit, with gaps and trimmed clip lengths preserved. */
export function TimelineOverview({ timeline, assets, duration, currentTime, onOpen }: TimelineOverviewProps) {
  const assetMap = new Map(assets.map(asset => [asset.id, asset]));
  const tracks = timeline.tracks.filter(track => timeline.clips.some(clip => clip.trackId === track.id));
  const length = Math.max(duration, 0.001);
  return (
    <button type="button" className="timeline-overview" onClick={onOpen} aria-label="Open full timeline">
      <span className="timeline-overview__heading"><span>Timeline</span><span>Open timeline ↗</span></span>
      <span className="timeline-overview__map" aria-hidden="true">
        {tracks.length ? tracks.map(track => (
          <span key={track.id} className={`timeline-overview__lane timeline-overview__lane--${track.kind}`}>
            {timeline.clips.filter(clip => clip.trackId === track.id).map(clip => {
              const asset = assetMap.get(clip.assetId);
              const thumbnail = toFileUrl(asset?.thumbnailUrl || (asset?.type === 'image' ? asset.fileRef || asset.url : undefined));
              return <span key={clip.id} className="timeline-overview__clip" style={{ left: `${clip.startTime / length * 100}%`, width: `${Math.max(0, clipEffectiveDuration(clip)) / length * 100}%` }}>
                {thumbnail && track.kind === 'video' && <img src={thumbnail} alt="" loading="lazy" draggable={false} />}
                <span>{clip.name}</span>
              </span>;
            })}
          </span>
        )) : <span className="timeline-overview__empty">Add media to start your edit</span>}
        {duration > 0 && <span className="timeline-overview__playhead" style={{ left: `${Math.max(0, Math.min(1, currentTime / length)) * 100}%` }} />}
      </span>
    </button>
  );
}
