import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type SyntheticEvent,
} from 'react';
import {
  CLIP_REVIEW_STATUSES,
  formatClipTime,
  formatCreated,
  type ClipItem,
  type ClipReviewStatus,
} from '@/lib/studio/clips';

export interface StudioClipViewerProps {
  item: ClipItem;
  index: number;
  count: number;
  spaceName: string;
  author: string;
  onClose: () => void;
  onNavigate: (delta: 1 | -1) => void;
  onLike: () => void;
  onDownload: () => void;
  onRecreate: () => void;
  onReference: () => void;
  /** Absent when the composer's model cannot edit a clip. */
  onEditVideo?: () => void;
  onExtend: () => void;
  onExtractFrame: (at: 'start' | 'end') => void;
  onOpenInCanvas?: () => void;
  onCopyPrompt: () => Promise<boolean> | boolean;
  onCopyUrl: () => void;
  onRemove: () => void;
  onReview: (status: ClipReviewStatus | null) => void;
  onAddComment: (text: string, timeSec?: number) => void;
}

type ViewerTab = 'info' | 'edit' | 'comments';
type MenuKind = 'status' | 'share' | 'more' | 'rate' | 'time' | null;

const RATES = [0.5, 1, 1.5, 2] as const;
const PROMPT_CLAMP = 260;

const Icon = {
  play: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5Z" fill="currentColor" /></svg>,
  pause: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" fill="currentColor" /></svg>,
  sound: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 6v4h2.6L9 13V3L5.1 6Z" fill="currentColor" /><path d="M11 5.5a3.4 3.4 0 0 1 0 5M12.6 3.6a6 6 0 0 1 0 8.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>,
  muted: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 6v4h2.6L9 13V3L5.1 6Z" fill="currentColor" /><path d="M11 6l3.5 4M14.5 6 11 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>,
  status: <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2.2 2.2" /></svg>,
  comment: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /><path d="M5.5 6.5h5M5.5 8.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>,
  full: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>,
  edit: <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3.5" width="9" height="9" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M12 2.5v3M10.5 4h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>,
  extend: <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="4" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M10.5 6.5h3M12 5v3M5 2v2M8 2v2M5 12v2M8 12v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>,
  hide: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8s2.3-4 6-4 6 4 6 4-2.3 4-6 4-6-4-6-4Z" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M3 13 13 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>,
  copy: <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>,
  prompt: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h11M2.5 8h7M2.5 12h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /><path d="m11 10 1.2 2.2L14.5 13l-2.3.8L11 16l-1.2-2.2L7.5 13l2.3-.8Z" fill="currentColor" /></svg>,
  info: <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M8 7v4M8 5.2v.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>,
  pen: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 13 1-4 7-7 3 3-7 7Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>,
  bubble: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>,
  recreate: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6.5A5 5 0 0 1 12.2 5M13 9.5A5 5 0 0 1 3.8 11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /><path d="M12.5 2.5v3h-3M3.5 13.5v-3h3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  reference: <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3" width="11" height="10" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" /><circle cx="6" cy="6.5" r="1.2" fill="currentColor" /><path d="M3 12l3.4-3.4 2.2 2.2 1.8-1.8L13 11.6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>,
  download: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v7.5M4.8 7.3 8 10.5l3.2-3.2M3 12.5h10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  heart: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13.5S2.5 10.2 2.5 6.4A2.9 2.9 0 0 1 8 5a2.9 2.9 0 0 1 5.5 1.4C13.5 10.2 8 13.5 8 13.5Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>,
  share: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9 3.5 13.5 7 9 10.5V8.3C5.5 8.3 3.6 9.6 2.5 12.5c0-4 2.2-7 6.5-7.3Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>,
  more: <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.3" fill="currentColor" /><circle cx="8" cy="8" r="1.3" fill="currentColor" /><circle cx="12.5" cy="8" r="1.3" fill="currentColor" /></svg>,
  close: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>,
  chevron: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  prev: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m10 3-5 5 5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  next: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  folder: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v5.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5Z" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>,
  send: <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3M4 7l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  clock: <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M8 5v3l2 1.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>,
};

function controlValue(item: ClipItem, id: string): string {
  const value = item.node.data.config[id];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

export function StudioClipViewer({
  item,
  index,
  count,
  spaceName,
  author,
  onClose,
  onNavigate,
  onLike,
  onDownload,
  onRecreate,
  onReference,
  onEditVideo,
  onExtend,
  onExtractFrame,
  onOpenInCanvas,
  onCopyPrompt,
  onCopyUrl,
  onRemove,
  onReview,
  onAddComment,
}: StudioClipViewerProps) {
  const [tab, setTab] = useState<ViewerTab>('info');
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState<MenuKind>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [pillHidden, setPillHidden] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState<number>(1);
  const [timeFormat, setTimeFormat] = useState<'standard' | 'timecode'>('standard');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [commentText, setCommentText] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const commentRef = useRef<HTMLInputElement>(null);
  const isVideo = item.kind === 'video' && Boolean(item.url);

  // A new clip resets the transport but keeps the tab the user was on.
  useEffect(() => {
    setPromptExpanded(false);
    setCopied(false);
    setMenu(null);
    setConfirmRemove(false);
    setCurrentTime(0);
    setDuration(0);
    setSize(null);
    setPlaying(false);
  }, [item.id]);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = rate;
    video.muted = muted;
  }, [rate, muted, item.id]);

  useEffect(() => {
    if (!menu) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('.clip-viewer__menu') || target.closest('[data-menu-trigger]')) return;
      setMenu(null);
      setConfirmRemove(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [menu]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      const pending = video.play() as Promise<void> | undefined;
      pending?.catch?.(() => {});
    } else {
      video.pause();
    }
  }, []);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
    if (event.key === 'Escape') {
      if (menu) {
        setMenu(null);
        setConfirmRemove(false);
      } else {
        onClose();
      }
      event.preventDefault();
      return;
    }
    if (typing) return;
    if (event.key === 'ArrowRight') { onNavigate(1); event.preventDefault(); }
    if (event.key === 'ArrowLeft') { onNavigate(-1); event.preventDefault(); }
    if (event.key === ' ' && isVideo && target.tagName !== 'BUTTON') { togglePlay(); event.preventDefault(); }
  };

  const onScrub = (event: ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.target.value);
    setCurrentTime(next);
    const video = videoRef.current;
    if (video) {
      try {
        video.currentTime = next;
      } catch {
        // Not seekable yet.
      }
    }
  };

  const onLoadedMetadata = (event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    setSize({ width: video.videoWidth, height: video.videoHeight });
  };

  const copyPrompt = async () => {
    const ok = await onCopyPrompt();
    setCopied(Boolean(ok));
    window.setTimeout(() => setCopied(false), 1600);
  };

  const submitComment = (event: FormEvent) => {
    event.preventDefault();
    const text = commentText.trim();
    if (!text) return;
    onAddComment(text, isVideo ? currentTime : undefined);
    setCommentText('');
  };

  const seekTo = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    try {
      video.currentTime = seconds;
      setCurrentTime(seconds);
    } catch {
      // Not seekable yet.
    }
  };

  const fullscreen = () => {
    const stage = stageRef.current;
    if (!stage) return;
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else stage.requestFullscreen?.().catch(() => {});
  };

  const review = CLIP_REVIEW_STATUSES.find((status) => status.id === item.review);
  const longPrompt = item.prompt.length > PROMPT_CLAMP;
  const shownPrompt = promptExpanded || !longPrompt ? item.prompt : `${item.prompt.slice(0, PROMPT_CLAMP).trimEnd()}…`;
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const quality = controlValue(item, 'resolution');
  const bitrate = controlValue(item, 'bitrate');
  const aspect = controlValue(item, 'aspect_ratio');
  const attachedReferences = Array.isArray(item.node.data.config.__studioAttachedRefs)
    ? (item.node.data.config.__studioAttachedRefs as unknown[]).filter((entry) => typeof entry === 'string')
    : [];

  const toggleMenu = (kind: Exclude<MenuKind, null>) => {
    setConfirmRemove(false);
    setMenu((current) => (current === kind ? null : kind));
  };

  return (
    <div
      className="clip-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={`${item.model.name} ${item.kind}`}
      data-testid="space-studio-clip-viewer"
      onKeyDown={onKeyDown}
    >
      <div className="clip-viewer__backdrop" onClick={onClose} aria-hidden="true" />

      <div className="clip-viewer__stage" ref={stageRef}>
        {count > 1 && (
          <>
            <button type="button" className="clip-viewer__nav clip-viewer__nav--prev" aria-label="Previous clip" onClick={() => onNavigate(-1)}>{Icon.prev}</button>
            <button type="button" className="clip-viewer__nav clip-viewer__nav--next" aria-label="Next clip" onClick={() => onNavigate(1)}>{Icon.next}</button>
          </>
        )}

        <div className="clip-viewer__media">
          {isVideo && (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              key={item.id}
              ref={videoRef}
              src={item.url}
              autoPlay
              playsInline
              loop
              data-testid="space-studio-clip-video"
              onClick={togglePlay}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
              onLoadedMetadata={onLoadedMetadata}
            />
          )}
          {item.kind === 'image' && item.url && (
            <img
              key={item.id}
              src={item.url}
              alt=""
              onLoad={(event) => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
            />
          )}
          {!item.url && (
            <div className="clip-viewer__pending">
              {item.status === 'error' ? (item.error || 'Generation failed.') : 'Still rendering…'}
            </div>
          )}
        </div>

        {isVideo && (
          <div className={`clip-viewer__pill${pillHidden ? ' is-hidden' : ''}`}>
            {!pillHidden && (
              <>
                {onOpenInCanvas && (
                  <button type="button" onClick={onOpenInCanvas}>{Icon.edit}<span>Edit</span></button>
                )}
                <button type="button" onClick={onExtend}>{Icon.extend}<span>Extend</span></button>
              </>
            )}
            <button
              type="button"
              className="clip-viewer__pill-hide"
              aria-label={pillHidden ? 'Show the Edit and Extend controls' : 'Hide the Edit and Extend controls'}
              aria-pressed={pillHidden}
              onClick={() => setPillHidden((current) => !current)}
            >
              {Icon.hide}
            </button>
          </div>
        )}

        {isVideo && (
          <div className="clip-viewer__transport">
            <div className="clip-viewer__scrub" style={{ ['--progress' as string]: `${progress}%` }}>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.01}
                value={Math.min(currentTime, duration || 0)}
                aria-label="Seek"
                onChange={onScrub}
              />
            </div>
            <div className="clip-viewer__controls">
              <button type="button" aria-label={playing ? 'Pause video' : 'Play video'} onClick={togglePlay}>
                {playing ? Icon.pause : Icon.play}
              </button>
              <div className="clip-viewer__menu-host">
                <button type="button" aria-label="Playback speed" data-menu-trigger aria-haspopup="menu" aria-expanded={menu === 'rate'} onClick={() => toggleMenu('rate')}>
                  <span className="clip-viewer__rate">{rate}×</span>
                </button>
                {menu === 'rate' && (
                  <div className="clip-viewer__menu clip-viewer__menu--up" role="menu" aria-label="Playback speed">
                    {RATES.map((value) => (
                      <button key={value} type="button" role="menuitemradio" aria-checked={rate === value} onClick={() => { setRate(value); setMenu(null); }}>{value}×</button>
                    ))}
                  </div>
                )}
              </div>
              <button type="button" aria-label={muted ? 'Unmute video' : 'Mute video'} aria-pressed={muted} onClick={() => setMuted((current) => !current)}>
                {muted ? Icon.muted : Icon.sound}
              </button>

              <div className="clip-viewer__menu-host clip-viewer__time-host">
                <button type="button" className="clip-viewer__time" aria-label="Time format" data-menu-trigger aria-haspopup="menu" aria-expanded={menu === 'time'} onClick={() => toggleMenu('time')}>
                  <span data-testid="space-studio-clip-time">{formatClipTime(currentTime, timeFormat)} / {formatClipTime(duration, timeFormat)}</span>
                  {Icon.chevron}
                </button>
                {menu === 'time' && (
                  <div className="clip-viewer__menu clip-viewer__menu--up" role="menu" aria-label="Time format">
                    <button type="button" role="menuitemradio" aria-checked={timeFormat === 'standard'} onClick={() => { setTimeFormat('standard'); setMenu(null); }}>Standard <em>1:23</em></button>
                    <button type="button" role="menuitemradio" aria-checked={timeFormat === 'timecode'} onClick={() => { setTimeFormat('timecode'); setMenu(null); }}>Timecode <em>00:01:23:456</em></button>
                  </div>
                )}
              </div>

              <div className="clip-viewer__menu-host">
                <button type="button" className={`clip-viewer__status${review ? ' is-set' : ''}`} data-menu-trigger aria-haspopup="menu" aria-expanded={menu === 'status'} onClick={() => toggleMenu('status')}>
                  <i aria-hidden="true" style={review ? { background: review.color, borderColor: review.color } : undefined} />
                  <span>{review ? review.label : 'Status'}</span>
                </button>
                {menu === 'status' && (
                  <div className="clip-viewer__menu clip-viewer__menu--up" role="menu" aria-label="Status">
                    <div className="clip-viewer__menu-title">Status</div>
                    {CLIP_REVIEW_STATUSES.map((status) => (
                      <button key={status.id} type="button" role="menuitemradio" aria-checked={item.review === status.id} onClick={() => { onReview(status.id); setMenu(null); }}>
                        <i aria-hidden="true" style={{ background: status.color }} />{status.label}
                      </button>
                    ))}
                    {item.review && <button type="button" role="menuitem" onClick={() => { onReview(null); setMenu(null); }}>Clear status</button>}
                  </div>
                )}
              </div>
              <button type="button" aria-label="Add comment" onClick={() => { setTab('comments'); window.setTimeout(() => commentRef.current?.focus(), 0); }}>{Icon.comment}</button>
              <button type="button" aria-label="Fullscreen video" onClick={fullscreen}>{Icon.full}</button>
            </div>
          </div>
        )}
      </div>

      <aside className="clip-viewer__panel">
        <header className="clip-viewer__head">
          <span className="clip-viewer__avatar" aria-hidden="true" />
          <div className="clip-viewer__who">
            <strong>{author}</strong>
            <span>Author</span>
          </div>
          <button ref={closeRef} type="button" className="clip-viewer__close" aria-label="Close" onClick={onClose}>{Icon.close}</button>
        </header>

        <div className="clip-viewer__tabs" role="tablist" aria-label="Clip details">
          {([['info', 'Info', Icon.info], ['edit', 'Edit', Icon.pen], ['comments', 'Comments', Icon.bubble]] as const).map(([id, label, icon]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-active' : undefined} onClick={() => setTab(id)}>
              {icon}<span>{label}</span>
            </button>
          ))}
        </div>

        <div className="clip-viewer__body">
          {tab === 'info' && (
            <div className="clip-viewer__info" role="tabpanel">
              <section className="clip-viewer__card">
                <div className="clip-viewer__card-head">
                  <span>{Icon.prompt}Prompt</span>
                  <button type="button" className="clip-viewer__chip" onClick={copyPrompt} disabled={!item.prompt}>
                    {Icon.copy}{copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <p className="clip-viewer__prompt" data-testid="space-studio-clip-prompt">{shownPrompt || 'No prompt was stored for this generation.'}</p>
                {longPrompt && (
                  <button type="button" className="clip-viewer__seeall" aria-expanded={promptExpanded} onClick={() => setPromptExpanded((current) => !current)}>
                    {promptExpanded ? 'See less' : 'See all'}{Icon.chevron}
                  </button>
                )}
              </section>

              <section className="clip-viewer__card clip-viewer__card--details">
                <button type="button" className="clip-viewer__card-toggle" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((current) => !current)}>
                  <span>{Icon.info}Details</span>{Icon.chevron}
                </button>
                {detailsOpen && (
                  <dl className="clip-viewer__details">
                    <div><dt>Model</dt><dd>{item.model.name}</dd></div>
                    {quality && <div><dt>Quality</dt><dd>{quality}</dd></div>}
                    {bitrate && <div><dt>Bitrate</dt><dd>{bitrate}</dd></div>}
                    {aspect && <div><dt>Aspect</dt><dd>{aspect}</dd></div>}
                    {size && <div><dt>Size</dt><dd>{size.width}x{size.height}</dd></div>}
                    {isVideo && duration > 0 && <div><dt>Duration</dt><dd>{formatClipTime(duration)}</dd></div>}
                    <div><dt>Created</dt><dd>{formatCreated(item.createdAt)}</dd></div>
                    {item.elementNames.length > 0 && <div><dt>Elements</dt><dd>{item.elementNames.join(', ')}</dd></div>}
                    {/* "It looks like it ignored my references" is only answerable
                        if the clip records what was actually sent with it. */}
                    {attachedReferences.length > 0 && (
                      <div><dt>References</dt><dd>{attachedReferences.length} attached file{attachedReferences.length === 1 ? '' : 's'}</dd></div>
                    )}
                  </dl>
                )}
              </section>

              <section className="clip-viewer__card">
                <div className="clip-viewer__card-label">Filed in</div>
                <span className="clip-viewer__folder">{Icon.folder}{spaceName}</span>
              </section>
            </div>
          )}

          {tab === 'edit' && (
            <div className="clip-viewer__edit" role="tabpanel">
              <p>Editing happens on the canvas, where this generation is a node you can rewire, re-run, or feed into another model.</p>
              {onOpenInCanvas && <button type="button" className="clip-viewer__button" onClick={onOpenInCanvas}>{Icon.edit}Open in Canvas</button>}
              {isVideo && (
                <>
                  <button type="button" className="clip-viewer__button" onClick={onExtend}>{Icon.extend}Extend from the last frame</button>
                  <button type="button" className="clip-viewer__button" onClick={() => onExtractFrame('start')}>Extract start frame</button>
                  <button type="button" className="clip-viewer__button" onClick={() => onExtractFrame('end')}>Extract last frame</button>
                </>
              )}
            </div>
          )}

          {tab === 'comments' && (
            <div className="clip-viewer__comments" role="tabpanel">
              {item.comments.length === 0 ? (
                <div className="clip-viewer__nocomments">
                  <span aria-hidden="true">{Icon.bubble}</span>
                  <p>No comments yet</p>
                </div>
              ) : (
                <ul className="clip-viewer__comment-list">
                  {item.comments.map((comment) => (
                    <li key={comment.id}>
                      <div className="clip-viewer__comment-meta">
                        <strong>{comment.author}</strong>
                        {typeof comment.timeSec === 'number' && (
                          <button type="button" className="clip-viewer__stamp" onClick={() => seekTo(comment.timeSec ?? 0)}>{formatClipTime(comment.timeSec)}</button>
                        )}
                        <time dateTime={comment.at}>{formatCreated(Date.parse(comment.at))}</time>
                      </div>
                      <p>{comment.text}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {tab === 'comments' ? (
          <form className="clip-viewer__composer" onSubmit={submitComment}>
            {isVideo && <span className="clip-viewer__stamp clip-viewer__stamp--live">{Icon.clock}{formatClipTime(currentTime)}</span>}
            <input
              ref={commentRef}
              type="text"
              value={commentText}
              placeholder="Add a comment"
              aria-label="Add a comment"
              onChange={(event) => setCommentText(event.target.value)}
            />
            <button type="submit" aria-label="Send comment" disabled={!commentText.trim()}>{Icon.send}</button>
          </form>
        ) : (
          <footer className="clip-viewer__actions">
            <div className="clip-viewer__actions-row">
              <button type="button" className="clip-viewer__primary" onClick={onRecreate}>{Icon.recreate}Recreate</button>
              <button type="button" className="clip-viewer__secondary" disabled={!item.url} onClick={onReference}>{Icon.reference}Reference</button>
            </div>
            <div className="clip-viewer__actions-row clip-viewer__actions-row--tools">
              <button type="button" className="clip-viewer__secondary clip-viewer__download" disabled={!item.url} onClick={onDownload}>{Icon.download}Download</button>
              <button type="button" className={`clip-viewer__iconbtn${item.liked ? ' is-on' : ''}`} aria-label={item.liked ? 'Unlike' : 'Like'} aria-pressed={item.liked} onClick={onLike}>{Icon.heart}</button>
              <div className="clip-viewer__menu-host">
                <button type="button" className="clip-viewer__iconbtn" aria-label="Share" data-menu-trigger aria-haspopup="menu" aria-expanded={menu === 'share'} onClick={() => toggleMenu('share')}>{Icon.share}</button>
                {menu === 'share' && (
                  <div className="clip-viewer__menu clip-viewer__menu--up clip-viewer__menu--right" role="menu" aria-label="Share">
                    <button type="button" role="menuitem" disabled={!item.url} onClick={() => { onCopyUrl(); setMenu(null); }}>Copy {item.kind} URL</button>
                    {onOpenInCanvas && <button type="button" role="menuitem" onClick={() => { onOpenInCanvas(); setMenu(null); }}>Open in Canvas</button>}
                  </div>
                )}
              </div>
              <div className="clip-viewer__menu-host">
                <button type="button" className="clip-viewer__iconbtn" aria-label="More actions" data-menu-trigger aria-haspopup="menu" aria-expanded={menu === 'more'} onClick={() => toggleMenu('more')}>{Icon.more}</button>
                {menu === 'more' && (
                  <div className="clip-viewer__menu clip-viewer__menu--up clip-viewer__menu--right" role="menu" aria-label="More actions">
                    {isVideo && (
                      <>
                        {onEditVideo && (
                          <button type="button" role="menuitem" onClick={() => { onEditVideo(); setMenu(null); }}>Edit video</button>
                        )}
                        <button type="button" role="menuitem" onClick={() => { onExtractFrame('start'); setMenu(null); }}>Extract start frame</button>
                        <button type="button" role="menuitem" onClick={() => { onExtractFrame('end'); setMenu(null); }}>Extract last frame</button>
                      </>
                    )}
                    <button type="button" role="menuitem" disabled={!item.prompt} onClick={() => { void copyPrompt(); setMenu(null); }}>Copy prompt</button>
                    <div className="clip-viewer__menu-rule" role="separator" />
                    {confirmRemove ? (
                      <div className="clip-viewer__menu-confirm">
                        <span>Remove this generation?</span>
                        <button type="button" className="is-danger" onClick={() => { setMenu(null); onRemove(); }}>Remove</button>
                        <button type="button" onClick={() => setConfirmRemove(false)}>Cancel</button>
                      </div>
                    ) : (
                      <button type="button" role="menuitem" className="is-danger" onClick={() => setConfirmRemove(true)}>Remove</button>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="clip-viewer__position">{index + 1} of {count}</div>
          </footer>
        )}
      </aside>
    </div>
  );
}
