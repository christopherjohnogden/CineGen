import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeftIcon, ChevronRightIcon, Cross2Icon } from '@radix-ui/react-icons';
import { toFileUrl } from '@/lib/utils/file-url';
import { elementImagesForVariation } from '@/lib/elements/variations';
import type { Asset } from '@/types/project';
import type { Element as CineElement } from '@/types/elements';
import { StudioAudioReference } from './studio-audio-reference';

type Media = Pick<Asset, 'name' | 'url'> & Partial<Pick<Asset, 'width' | 'height' | 'duration' | 'fileSize' | 'createdAt'>> & {
  kind: Asset['type'];
  prompt?: string;
};
export interface ReferencePreview {
  name: string;
  category?: string;
  description?: string;
  look?: string;
  media: Media[];
}

export function previewAttachedReference(reference: Pick<Media, 'name' | 'url' | 'kind'>, assets: Asset[]): ReferencePreview {
  const asset = assets.find(item => toFileUrl(item.url) === toFileUrl(reference.url) || item.sourceUrl === reference.url);
  return { name: reference.name, media: [{
    ...reference,
    width: asset?.width, height: asset?.height, duration: asset?.duration,
    fileSize: asset?.fileSize, createdAt: asset?.createdAt,
    prompt: typeof asset?.metadata?.prompt === 'string' ? asset.metadata.prompt : undefined,
  }] };
}

export function previewElementReference(element: CineElement): ReferencePreview {
  const look = element.variations?.find(item => item.id === element.activeVariationId) ?? element.variations?.[0];
  return {
    name: element.name,
    category: `${element.type[0].toUpperCase()}${element.type.slice(1)} element`,
    description: [element.description, look?.description].filter(Boolean).join('\n\n'),
    look: look?.name,
    media: elementImagesForVariation(element).map((image, index) => ({
      name: `${element.name} · Reference ${index + 1}`, url: image.url, kind: 'image', createdAt: image.createdAt,
    })),
  };
}

function durationLabel(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

export function StudioReferencePreview({ reference, onClose }: { reference: ReferencePreview; onClose: () => void }) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const [index, setIndex] = useState(0);
  const item = reference.media[index];

  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modal = dialog.current;
    // Opening a larger player should not leave the small audition playing behind it.
    document.querySelectorAll<HTMLAudioElement>('audio[data-audio-reference]').forEach(player => {
      if (!player.paused) player.pause();
    });
    modal?.showModal();
    return () => {
      modal?.querySelectorAll<HTMLMediaElement>('audio,video').forEach(player => { if (!player.paused) player.pause(); });
      modal?.close();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);

  const navigate = (offset: number) => setIndex(current => Math.max(0, Math.min(reference.media.length - 1, current + offset)));

  return createPortal(
    <dialog ref={dialog} className="studio-reference-preview" aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}
      onClick={event => {
        event.stopPropagation();
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
      }}
      onKeyDown={event => {
        event.stopPropagation();
        if (item?.kind !== 'image' || reference.media.length < 2) return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault(); navigate(event.key === 'ArrowLeft' ? -1 : 1);
        }
      }}>
      <header className="studio-reference-preview__head">
        <div><span>Reference preview</span><h2 id={titleId}>{reference.name}</h2></div>
        <button type="button" className="studio-reference-preview__close" aria-label="Close reference preview" onClick={onClose}><Cross2Icon /></button>
      </header>
      <div className="studio-reference-preview__body">
        <div className="studio-reference-preview__stage"
          onPointerDown={event => { if (event.pointerType === 'touch' && item?.kind === 'image') swipe.current = { x: event.clientX, y: event.clientY }; }}
          onPointerCancel={() => { swipe.current = null; }}
          onPointerUp={event => {
            const start = swipe.current; swipe.current = null;
            if (start && Math.abs(event.clientX - start.x) > 50 && Math.abs(event.clientY - start.y) < 45) navigate(event.clientX > start.x ? -1 : 1);
          }}>
          {item ? <ReferenceMedia key={`${index}:${item.url}`} item={item} /> : <p className="studio-reference-preview__empty">This element has no reference images yet.</p>}
        </div>
        {reference.media.length > 1 && <nav className="studio-reference-preview__navigation" aria-label="Reference images">
          {/* Keep focus at either end so arrow keys still navigate after a click. */}
          <button type="button" aria-label="Previous reference image" aria-disabled={index === 0} onClick={() => navigate(-1)}><ChevronLeftIcon /></button>
          <span aria-live="polite">{index + 1} <span>of {reference.media.length}</span></span>
          <button type="button" aria-label="Next reference image" aria-disabled={index === reference.media.length - 1} onClick={() => navigate(1)}><ChevronRightIcon /></button>
        </nav>}
        <div className="studio-reference-preview__info">
          {(reference.category || reference.look) && <p className="studio-reference-preview__context">{[reference.category, reference.look].filter(Boolean).join(' · ')}</p>}
          {reference.description && <details className="studio-reference-preview__details"><summary>About this element</summary><p>{reference.description}</p></details>}
          {item?.prompt && <details className="studio-reference-preview__details"><summary>Prompt</summary><p>{item.prompt}</p></details>}
        </div>
      </div>
    </dialog>, document.body,
  );
}

function ReferenceMedia({ item }: { item: Media }) {
  const [dimensions, setDimensions] = useState(item.width && item.height ? `${item.width} × ${item.height}` : '');
  const [duration, setDuration] = useState(item.duration ?? 0);
  const [loaded, setLoaded] = useState(item.kind === 'audio');
  const [error, setError] = useState(false);
  const player = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = player.current;
    return () => { if (video && !video.paused) video.pause(); };
  }, []);
  const created = item.createdAt ? new Date(item.createdAt) : null;
  const details = [
    ['Type', `${item.kind[0].toUpperCase()}${item.kind.slice(1)}`],
    dimensions && ['Dimensions', dimensions],
    duration > 0 && Number.isFinite(duration) && ['Duration', durationLabel(duration)],
    item.fileSize && item.fileSize > 0 && ['File size', item.fileSize >= 1048576 ? `${(item.fileSize / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(item.fileSize / 1024))} KB`],
    created && Number.isFinite(created.getTime()) && ['Added', created.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })],
  ].filter(Boolean) as string[][];

  return <>
    <div className={`studio-reference-preview__media${item.kind === 'audio' ? ' studio-reference-preview__audio' : ''}`}>
      {item.kind === 'image' && !error && <img src={toFileUrl(item.url)} alt={item.name} draggable={false}
        onLoad={event => { setDimensions(`${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`); setLoaded(true); }} onError={() => setError(true)} />}
      {item.kind === 'video' && !error && <video ref={player} src={toFileUrl(item.url)} controls playsInline preload="metadata"
        onLoadedMetadata={event => {
          const video = event.currentTarget;
          if (video.videoWidth && video.videoHeight) setDimensions(`${video.videoWidth} × ${video.videoHeight}`);
          setDuration(video.duration); setLoaded(true);
        }} onError={() => setError(true)} />}
      {item.kind === 'audio' && <StudioAudioReference url={item.url} name={item.name} onDuration={setDuration} />}
      {error ? <p className="studio-reference-preview__empty" role="status">This preview couldn’t load. Your reference is still attached.</p>
        : !loaded && <span className="studio-reference-preview__loading" role="status">Loading preview…</span>}
    </div>
    <dl className="studio-reference-preview__facts">{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  </>;
}
