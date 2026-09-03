import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import type { CSSProperties } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { useWorkspace } from '@/components/workspace/workspace-shell';
import { VideoNodePreview } from '@/components/create/nodes/video-node-preview';
import { useTopviewModelCatalogVersion } from '@/components/create/use-topview-model-catalog';
import { getModelDefinition } from '@/lib/fal/models';
import { elementImagesForVariation } from '@/lib/elements/variations';
import { topviewImageCreditEstimate } from '@/lib/topview/image-pricing';
import { createWorkflowNodeFromSpec } from '@/lib/llm/space-node-factory';
import {
  modelProviderLabel,
  providerModelOptions,
} from '@/lib/workflows/provider-model-options';
import { executeFromNode, type WorkflowDispatch } from '@/lib/workflows/execute';
import { generateId, timestamp } from '@/lib/utils/ids';
import { toFileUrl } from '@/lib/utils/file-url';
import { getMediaTypeForFile, resolveMediaFileUrl, getLocalPathForFile } from '@/lib/utils/media-file';
import { nextStudioSlot } from '@/lib/studio/layout';
import { resolveStudioRecipe } from '@/lib/studio/recipe';
import { classifyFeedError } from '@/lib/studio/errors';
import { primeVideoPoster } from '@/lib/studio/clips';
import {
  endFieldFor,
  isImageField,
  promptFieldFor,
  referenceFieldFor,
  startFieldFor,
} from '@/lib/studio/fields';
import {
  captureVideoFrame,
  clipComments,
  clipElementNames,
  clipFileName,
  clipLiked,
  clipReview,
  commentId,
  copyText,
  downloadUrl,
  generationStatus,
  isNewClip,
  readCardSize,
  readFeedView,
  readSeen,
  writeCardSize,
  writeFeedView,
  writeSeen,
  type ClipCardSize,
  type ClipItem,
  type ClipReviewStatus,
  type GenerationStatus,
} from '@/lib/studio/clips';
import { StudioClipGrid } from '@/components/create/studio-clip-grid';
import { StudioClipViewer } from '@/components/create/studio-clip-viewer';
import { StudioSelectionBar } from '@/components/create/studio-selection-bar';
import { activeMention, mentionToken, splitPromptMentions } from '@/lib/studio/mentions';
import {
  BUILTIN_PRESETS,
  composePresetPrompt,
  loadStudioPresets,
  presetControlsFor,
  resolvePresetModel,
  type StudioPreset,
} from '@/lib/studio/presets';
import {
  controlOptionLabel,
  controlPillLabel,
  isPillControl,
  isSliderControl,
} from '@/lib/studio/controls';
import { readComposerDraft, writeComposerDraft } from '@/lib/studio/draft';
import type { Asset } from '@/types/project';
// Aliased: the DOM's global `Element` would otherwise win.
import type { Element as CineElement } from '@/types/elements';
import type {
  ModelDefinition,
  ModelInputField,
  WorkflowNodeData,
} from '@/types/workflow';

type OutputKind = 'image' | 'video';
type VideoInputMode = 'frames' | 'references';
type FeedFilter = 'all' | OutputKind | 'liked';
type ControlValue = string | number | boolean;
type FeedStatus = GenerationStatus;
type FrameSlot = 'start' | 'end';
type FeedView = 'list' | 'grid';

const CONTROL_FIELD_TYPES = new Set<ModelInputField['fieldType']>([
  'select',
  'number',
  'range',
  'toggle',
]);

const PRIMARY_CONTROL_IDS = [
  'duration',
  'durationSec',
  'duration_sec',
  'aspect_ratio',
  'aspectRatio',
  'resolution',
  'generate_audio',
  'generateAudio',
];

function canStudioSupplyRequiredField(
  field: ModelInputField,
  promptField: ModelInputField,
): boolean {
  if (!field.required || field.default !== undefined) return true;
  if (field.id === promptField.id) return true;
  if (CONTROL_FIELD_TYPES.has(field.fieldType)) return true;
  return isImageField(field) && field.mediaRole !== 'video' && field.mediaRole !== 'audio';
}

function canUseInStudio(model: ModelDefinition, kind: OutputKind): boolean {
  const promptField = promptFieldFor(model);
  if (model.outputType !== kind || !promptField) return false;
  return model.inputs.every((field) => canStudioSupplyRequiredField(field, promptField));
}

function orderedControlFields(model: ModelDefinition | undefined): ModelInputField[] {
  if (!model) return [];
  return model.inputs
    .filter((field) => CONTROL_FIELD_TYPES.has(field.fieldType))
    .sort((left, right) => {
      const leftIndex = PRIMARY_CONTROL_IDS.indexOf(left.id);
      const rightIndex = PRIMARY_CONTROL_IDS.indexOf(right.id);
      const leftPriority = leftIndex < 0 ? PRIMARY_CONTROL_IDS.length : leftIndex;
      const rightPriority = rightIndex < 0 ? PRIMARY_CONTROL_IDS.length : rightIndex;
      return leftPriority - rightPriority;
    });
}

function defaultControlValue(field: ModelInputField): ControlValue | '' {
  if (typeof field.default === 'string' || typeof field.default === 'number' || typeof field.default === 'boolean') {
    return field.default;
  }
  if (field.fieldType === 'toggle') return false;
  if (field.fieldType === 'select') return field.options?.[0]?.value ?? '';
  return '';
}

function controlValue(
  values: Record<string, ControlValue> | undefined,
  field: ModelInputField,
): ControlValue | '' {
  return values && Object.prototype.hasOwnProperty.call(values, field.id)
    ? values[field.id]
    : defaultControlValue(field);
}

function generationUrls(node: Node<WorkflowNodeData>): string[] {
  const generations = Array.isArray(node.data.generations)
    ? node.data.generations.filter((url): url is string => typeof url === 'string' && Boolean(url.trim()))
    : [];
  const resultUrl = node.data.result?.url?.trim();
  if (generations.length === 0) return resultUrl ? [resultUrl] : [];
  if (resultUrl && !generations.includes(resultUrl)) return [...generations, resultUrl];
  return generations;
}

function studioCreatedAt(node: Node<WorkflowNodeData>): number {
  const value = node.data.config.__studioCreatedAt;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return 0;
}

/**
 * The prompt a card should show, newest-truth first: a live incoming edge, then
 * the node's own config, then the launch-time mirror.
 *
 * Reading `__studioPrompt` alone made a card keep describing the prompt it was
 * created with even after the graph was rewired, and left a canvas-authored node
 * with no prompt text at all.
 */
function feedPromptFor(
  node: Node<WorkflowNodeData>,
  model: ModelDefinition,
  nodes: Node<WorkflowNodeData>[],
  edges: Edge[],
): string {
  const promptField = promptFieldFor(model);
  if (promptField) {
    const incoming = edges.find((edge) => edge.target === node.id && edge.targetHandle === promptField.id);
    if (incoming) {
      const source = nodes.find((candidate) => candidate.id === incoming.source);
      const wired = source?.data.config.prompt;
      if (typeof wired === 'string' && wired.trim()) return wired.trim();
    }
    const configured = node.data.config[promptField.id];
    if (typeof configured === 'string' && configured.trim()) return configured.trim();
  }
  const mirrored = node.data.config.__studioPrompt;
  return typeof mirrored === 'string' ? mirrored : '';
}

/**
 * What a model actually accepts, read off its own definition — so the picker can
 * never advertise a control the provider will reject.
 */
type CapabilityBadge = { label: string; kind: 'resolution' | 'duration' | 'tag' };

function modelCapabilitySummary(model: ModelDefinition): CapabilityBadge[] {
  const controls = orderedControlFields(model);
  const badges: CapabilityBadge[] = [];
  const resolution = controls.find((field) => field.id === 'resolution');
  const duration = controls.find((field) => (
    field.id === 'duration' || field.id === 'durationSec' || field.id === 'duration_sec'
  ));
  if (resolution?.options?.length) {
    // The headline number, not a range — "1080p" says what the model can do;
    // "720–1080" makes the reader do arithmetic to reach the same fact.
    const numeric = resolution.options
      .map((option) => Number(String(option.value).replace(/[^\d.]/g, '')));
    const best = numeric.some(Number.isFinite)
      ? resolution.options[numeric.indexOf(Math.max(...numeric.filter(Number.isFinite)))]
      : resolution.options[resolution.options.length - 1];
    badges.push({ label: controlOptionLabel(resolution, best.label), kind: 'resolution' });
  }
  if (duration?.options?.length) {
    const values = duration.options.map((option) => Number(option.value)).filter(Number.isFinite);
    if (values.length) {
      const low = Math.min(...values);
      const high = Math.max(...values);
      badges.push({ label: low === high ? `${low}s` : `${low}s–${high}s`, kind: 'duration' });
    }
  }
  if (model.outputType === 'video' && !duration) badges.push({ label: 'Fixed length', kind: 'tag' });
  if (referenceFieldFor(model)) badges.push({ label: 'References', kind: 'tag' });
  if (controls.some((field) => field.id === 'generate_audio' || field.id === 'generateAudio')) {
    badges.push({ label: 'Audio', kind: 'tag' });
  }
  return badges;
}

const PILL_ICONS: Record<string, ReactElement> = {
  duration: (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 4.6V8l2.4 1.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  aspect_ratio: (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="3.2" y="2.4" width="9.6" height="11.2" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  ),
  resolution: (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M8 2.2l5.4 3.4L8 13.8 2.6 5.6z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  ),
  generate_audio: (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M2.5 6v4h2.6L9 13V3L5.1 6Z" fill="currentColor" />
      <path d="M11 5.5a3.4 3.4 0 0 1 0 5M12.6 3.6a6 6 0 0 1 0 8.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
  bitrate_high: (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M8 1.5l1.6 4.4 4.4 1.6-4.4 1.6L8 13.5 6.4 9.1 2 7.5l4.4-1.6z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M12.5 11.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" fill="currentColor" />
    </svg>
  ),
  bitrate_standard: (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M9 1.5 3.5 9h4l-1 5.5L13 7H9z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  ),
};

/** Bitrate is the one pill whose glyph follows the value, like the reference. */
function bitrateIcon(value: string) {
  return /high|max|best/i.test(value) ? PILL_ICONS.bitrate_high : PILL_ICONS.bitrate_standard;
}

function pillIcon(field: ModelInputField): ReactElement | null {
  if (/duration/i.test(field.id)) return PILL_ICONS.duration;
  if (field.id === 'aspect_ratio' || field.id === 'aspectRatio') return PILL_ICONS.aspect_ratio;
  if (field.id === 'resolution') return PILL_ICONS.resolution;
  if (field.id === 'generate_audio' || field.id === 'generateAudio') return PILL_ICONS.generate_audio;
  return null;
}

/** The settings a generation actually ran with, read back off its node. */
function feedSettingsFor(node: Node<WorkflowNodeData>, model: ModelDefinition): string[] {
  return orderedControlFields(model).flatMap((field) => {
    const value = node.data.config[field.id];
    if (value === undefined || value === null || value === '') return [];
    if (field.fieldType === 'toggle') return value ? [`${controlPillLabel(field)} on`] : [];
    const option = field.options?.find((entry) => String(entry.value) === String(value));
    return [controlOptionLabel(field, option?.label ?? String(value))];
  });
}

/** The Elements a generation used, resolved against the current library. */
function feedElementsFor(
  node: Node<WorkflowNodeData>,
  model: ModelDefinition,
  nodes: Node<WorkflowNodeData>[],
  edges: Edge[],
  elements: CineElement[],
): CineElement[] {
  const { elementIds } = resolveStudioRecipe(node, model, nodes, edges, []);
  return elementIds.flatMap((id) => {
    const match = elements.find((element) => element.id === id);
    return match ? [match] : [];
  });
}

function assetPreviewUrl(asset: Asset): string {
  return toFileUrl(asset.thumbnailUrl || asset.fileRef || asset.url);
}

function wordCount(value: string): number {
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Compact, non-ticking age for a finished card: "just now", "12m ago", "3d ago". */
function relativeTime(from: number, now: number): string {
  if (!from) return '';
  const seconds = Math.max(0, Math.round((now - from) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function elapsedLabel(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

const STATUS_LABELS: Record<FeedStatus, string> = {
  queued: 'Queued',
  running: 'Rendering',
  complete: 'Ready',
  error: 'Failed',
  stalled: 'Not started',
};

interface StudioFeedItemProps {
  node: Node<WorkflowNodeData>;
  model: ModelDefinition;
  prompt: string;
  settings: string[];
  elements: CineElement[];
  running: boolean;
  onRetry: () => void;
  onReuse: () => void;
  onOpenSettings: () => void;
  onOpenInCanvas?: () => void;
}

function StudioFeedItem({
  node,
  model,
  prompt,
  settings,
  elements,
  running,
  onRetry,
  onReuse,
  onOpenSettings,
  onOpenInCanvas,
}: StudioFeedItemProps) {
  const urls = generationUrls(node);
  const preferredIndex = typeof node.data.activeGeneration === 'number'
    ? node.data.activeGeneration
    : Math.max(0, urls.length - 1);
  const [activeIndex, setActiveIndex] = useState(() => (
    Math.min(Math.max(0, preferredIndex), Math.max(0, urls.length - 1))
  ));
  const [mediaError, setMediaError] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const result = node.data.result;
  const resultStatus = result?.status ?? 'idle';
  const activeUrl = urls[Math.min(activeIndex, Math.max(0, urls.length - 1))];
  const studioGenerated = Boolean(node.data.config.__studioGenerated);

  // `running` and an explicit running result are the only honest in-flight signals. An
  // idle Studio node with no media never started — showing it as "Generating…" hid
  // exactly the failures this feed exists to surface.
  const status: FeedStatus = generationStatus(node, running, urls.length);
  const isPending = status === 'running' || status === 'queued';

  const progress = Math.max(0, Math.min(100, result?.progress ?? 5));
  const createdAt = node.data.config.__studioCreatedAt;
  const createdAtMs = studioCreatedAt(node);
  const startedAt = result?.progressStartedAt;
  const boardUrl = result?.topviewTask?.boardUrl;
  const isLongPrompt = prompt.length > 260;

  useEffect(() => {
    const nextIndex = Math.min(Math.max(0, preferredIndex), Math.max(0, urls.length - 1));
    setActiveIndex(nextIndex);
    setMediaError(false);
  }, [preferredIndex, urls.length]);

  useEffect(() => {
    if (!isPending) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isPending]);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const selectVersion = (index: number) => {
    setActiveIndex(index);
    setMediaError(false);
  };

  const handleVersionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + urls.length) % urls.length;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % urls.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = urls.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    selectVersion(nextIndex);
    document.getElementById(`space-studio-version-${node.id}-${nextIndex}`)?.focus();
  };

  const copyLink = () => {
    if (!activeUrl) return;
    void navigator.clipboard?.writeText(activeUrl).then(() => setCopied(true), () => setCopied(false));
  };

  return (
    <article
      className={`space-studio__feed-item space-studio__feed-item--${model.outputType}`}
      data-testid={`space-studio-feed-item-${node.id}`}
      data-status={status}
      aria-label={`${model.name} generation`}
    >
      <header className="space-studio__feed-item-header">
        <div>
          <span className="space-studio__feed-kind">{model.outputType}</span>
          <h3>{model.name}</h3>
          <span className="space-studio__feed-provider">{modelProviderLabel(model)}</span>
        </div>
        <div className="space-studio__feed-meta">
          <span className={`space-studio__status space-studio__status--${status}`}>
            {STATUS_LABELS[status]}
          </span>
          {typeof createdAt === 'string' && (
            <time dateTime={createdAt} title={new Date(createdAt).toLocaleString()}>
              {relativeTime(createdAtMs, now)}
            </time>
          )}
        </div>
      </header>

      <div className="space-studio__feed-preview">
        {activeUrl && !mediaError && model.outputType === 'video' && (
          <VideoNodePreview
            key={activeUrl}
            sourceUrl={activeUrl}
            className="space-studio__feed-media"
            ariaLabel={`${model.name}, version ${activeIndex + 1}`}
            onError={() => setMediaError(true)}
          />
        )}
        {activeUrl && !mediaError && model.outputType === 'image' && (
          <img
            key={activeUrl}
            src={activeUrl}
            alt={`${model.name} result, version ${activeIndex + 1}`}
            className="space-studio__feed-media"
            onError={() => setMediaError(true)}
          />
        )}
        {isPending && !activeUrl && (
          <div className="space-studio__pending" role="status" aria-live="polite">
            <span className="space-studio__pending-label">
              {result?.progressMessage || (status === 'queued' ? 'Waiting for the provider' : 'Generating…')}
            </span>
            <span className="space-studio__pending-value">
              {startedAt ? elapsedLabel(now - startedAt) : `${Math.round(progress)}%`}
            </span>
            <span className="space-studio__progress" aria-hidden="true">
              <span style={{ width: `${progress}%` }} />
            </span>
          </div>
        )}
        {status === 'stalled' && !activeUrl && (
          <div className="space-studio__stalled" role="status">
            <p>This generation never started.</p>
            <button type="button" onClick={onRetry} data-testid={`space-studio-start-${node.id}`}>
              Run it now
            </button>
          </div>
        )}
        {(mediaError || (status === 'complete' && !activeUrl)) && (
          <div className="space-studio__media-error" role="alert">Result media is unavailable.</div>
        )}
      </div>

      {urls.length > 1 && (
        <div
          className="space-studio__versions"
          role="tablist"
          aria-label={`${model.name} versions`}
        >
          {urls.map((url, index) => (
            <button
              key={`${url}-${index}`}
              id={`space-studio-version-${node.id}-${index}`}
              type="button"
              role="tab"
              aria-selected={activeIndex === index}
              tabIndex={activeIndex === index ? 0 : -1}
              className={activeIndex === index ? 'is-active' : undefined}
              data-testid={`space-studio-version-${node.id}-${index}`}
              onClick={() => selectVersion(index)}
              onKeyDown={(event) => handleVersionKeyDown(event, index)}
            >
              V{index + 1}
            </button>
          ))}
        </div>
      )}

      {prompt && (
        <div className="space-studio__feed-prompt-wrap">
          <button
            type="button"
            className={`space-studio__feed-prompt${isLongPrompt && !promptExpanded ? ' is-clamped' : ''}`}
            title="Load this prompt and its settings into the composer"
            data-testid={`space-studio-prompt-load-${node.id}`}
            onClick={onReuse}
          >
            {prompt}
          </button>
          {isLongPrompt && (
            <button
              type="button"
              className="space-studio__link-button"
              aria-expanded={promptExpanded}
              onClick={() => setPromptExpanded((current) => !current)}
            >
              {promptExpanded ? 'Show less' : 'Show full prompt'}
            </button>
          )}
        </div>
      )}

      {(settings.length > 0 || elements.length > 0) && (
        <div className="space-studio__feed-recipe">
          {settings.length > 0 && (
            <ul className="space-studio__feed-settings" aria-label="Settings used">
              {settings.map((setting) => <li key={setting}>{setting}</li>)}
            </ul>
          )}
          {elements.length > 0 && (
            <div className="space-studio__feed-elements">
              <span className="space-studio__hint">
                {elements.length} reference{elements.length === 1 ? '' : 's'}
              </span>
              <div className="space-studio__feed-element-strip">
                {elements.map((element) => {
                  const image = elementImagesForVariation(
                    element,
                    (node.data.config.__studioElementVariationIds as Record<string, string> | undefined)?.[element.id],
                  )[0];
                  if (!image) return null;
                  return (
                    <img
                      key={element.id}
                      src={toFileUrl(image.url)}
                      alt={element.name}
                      title={element.name}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {status === 'error' && (() => {
        const feedError = classifyFeedError(result?.error);
        return (
          <div className="space-studio__feed-error" role="alert">
            <p>{feedError.message}</p>
            {feedError.kind === 'auth' ? (
              <button
                type="button"
                onClick={onOpenSettings}
                data-testid={`space-studio-open-settings-${node.id}`}
              >
                Open Settings
              </button>
            ) : (
              <button
                type="button"
                onClick={onRetry}
                data-testid={`space-studio-retry-${node.id}`}
              >
                Retry
              </button>
            )}
          </div>
        );
      })()}

      <footer className="space-studio__feed-actions">
        {activeUrl && (
          <button type="button" className="space-studio__link-button" onClick={copyLink}>
            {copied ? 'Link copied' : 'Copy link'}
          </button>
        )}
        {boardUrl && (
          <a
            className="space-studio__link-button"
            href={boardUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open in Topview
          </a>
        )}
        <button
          type="button"
          className="space-studio__link-button"
          data-testid={`space-studio-reuse-${node.id}`}
          onClick={onReuse}
        >
          Reuse settings
        </button>
        {onOpenInCanvas && (
          <button type="button" className="space-studio__link-button" onClick={onOpenInCanvas}>
            Open in Canvas
          </button>
        )}
      </footer>
    </article>
  );
}

export interface SpaceStudioProps {
  /** Switches the Space back to the node canvas so a feed card can be traced to its graph. */
  onOpenInCanvas?: (nodeId: string) => void;
}

const CARD_SIZE_LABELS = { s: 'Small', m: 'Medium', l: 'Large' } as const;

const VIEW_ICONS = {
  list: (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="2" y="3" width="12" height="3.2" rx="1.1" fill="currentColor" />
      <rect x="2" y="9.8" width="12" height="3.2" rx="1.1" fill="currentColor" />
    </svg>
  ),
  grid: (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <rect x="2" y="3" width="5.2" height="4.4" rx="1.1" fill="currentColor" />
      <rect x="8.8" y="3" width="5.2" height="4.4" rx="1.1" fill="currentColor" />
      <rect x="2" y="8.6" width="5.2" height="4.4" rx="1.1" fill="currentColor" />
      <rect x="8.8" y="8.6" width="5.2" height="4.4" rx="1.1" fill="currentColor" />
    </svg>
  ),
};

/** Versions one Generate can make at once; each is its own node and its own credit spend. */
const MAX_BATCH = 4;
/** Reference sets are large on omni-reference models; this is a sanity bound, not a provider limit. */
const MAX_ATTACHED_REFERENCES = 50;

interface AttachedReference {
  id: string;
  url: string;
  name: string;
  kind: 'image' | 'video' | 'audio';
}

/** The video model the composer opens on when the catalog offers it. */
const DEFAULT_VIDEO_MODEL_NAME = 'Seedance 2.5';

export function SpaceStudio({ onOpenInCanvas }: SpaceStudioProps = {}) {
  const { state, dispatch, projectId } = useWorkspace();
  const catalogVersion = useTopviewModelCatalogVersion();
  // A reload, a restart, or a hot reload in dev must not empty the composer:
  // the next Generate would go out without the references you attached, and you
  // would only find out once the render was paid for.
  const draft = useRef(readComposerDraft(projectId)).current;
  const [outputKind, setOutputKind] = useState<OutputKind>(draft.outputKind);
  const [videoMode, setVideoMode] = useState<VideoInputMode>(draft.videoMode);
  const [prompt, setPrompt] = useState(draft.prompt);
  const [modelType, setModelType] = useState('');
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>(draft.elementIds);
  const [missingReferences, setMissingReferences] = useState(0);
  const [startAssetId, setStartAssetId] = useState(draft.startAssetId);
  const [endAssetId, setEndAssetId] = useState(draft.endAssetId);
  const [controlValuesByModel, setControlValuesByModel] = useState<
    Record<string, Record<string, ControlValue>>
  >({});
  const [feedFilter, setFeedFilter] = useState<FeedFilter>('all');
  const [feedView, setFeedView] = useState<FeedView>(() => readFeedView());
  const [cardSize, setCardSize] = useState<ClipCardSize>(() => readCardSize());
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [feedNotice, setFeedNotice] = useState<{ text: string; kind: 'info' | 'error' } | null>(null);
  // Captured once per visit: "New" means newer than the last visit, and a badge
  // must not vanish just because the grid re-rendered while you were looking.
  const [seen, setSeen] = useState(() => readSeen(projectId));
  const [dockModeMenuOpen, setDockModeMenuOpen] = useState(false);
  // How many versions one Generate makes: each is its own node and its own run.
  const [batchCount, setBatchCount] = useState(1);
  const [selectedClipIds, setSelectedClipIds] = useState<ReadonlySet<string>>(() => new Set());
  /** Files attached from disk. References in their own right, not Elements. */
  const [attachedRefs, setAttachedRefs] = useState<AttachedReference[]>(draft.attachments);
  // The docked bar needs room beside the grid; phones keep the stacked layout.
  const [narrow, setNarrow] = useState(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 780px)').matches
  ));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(max-width: 780px)');
    const update = () => setNarrow(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const dockMode = feedView === 'grid' && !narrow;
  // On a phone the composer is a full screen of controls above the clips, so in
  // grid view it collapses to a bar and opens as a sheet.
  const sheetMode = feedView === 'grid' && narrow;
  const [composerOpen, setComposerOpen] = useState(false);
  const dockModeRef = useRef(dockMode);
  dockModeRef.current = dockMode;
  const flyoutAnchorRef = useRef<HTMLElement | null>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const attachTargetRef = useRef<FrameSlot | null>(null);
  // The docked tool row scrolls sideways; arrows appear only where there is more.
  const toolsRef = useRef<HTMLDivElement>(null);
  const [toolsEdges, setToolsEdges] = useState({ left: false, right: false });
  const [rowMenuStyle, setRowMenuStyle] = useState<CSSProperties | null>(null);
  const anchorRowMenu = useCallback((el: HTMLElement | null, minWidth = 220) => {
    if (!el || !dockModeRef.current) {
      setRowMenuStyle(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    const margin = 12;
    const width = Math.min(
      Math.max(minWidth, Math.round(rect.width)),
      Math.max(200, window.innerWidth - margin * 2),
    );
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
    setRowMenuStyle({
      position: 'fixed',
      top: 'auto',
      right: 'auto',
      bottom: window.innerHeight - rect.top + 8,
      left,
      width,
      minWidth: width,
      maxWidth: width,
      maxHeight: Math.max(160, rect.top - 24),
      overflowY: 'auto',
      transform: 'none',
      zIndex: 210,
    });
  }, []);
  const dockMenuStyle = dockMode ? rowMenuStyle ?? undefined : undefined;

  const measureTools = useCallback(() => {
    const el = toolsRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setToolsEdges((current) => (current.left === left && current.right === right ? current : { left, right }));
  }, []);
  useEffect(() => {
    if (!dockMode) return undefined;
    measureTools();
    const el = toolsRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measureTools);
    observer.observe(el);
    return () => observer.disconnect();
  }, [dockMode, measureTools, modelType, outputKind]);
  const [formError, setFormError] = useState('');
  const [isLaunching, setIsLaunching] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [frameSlotTarget, setFrameSlotTarget] = useState<FrameSlot | null>(null);
  const [sliderOpen, setSliderOpen] = useState<string | null>(null);
  const [rowOpen, setRowOpen] = useState<string | null>(null);
  const [presets, setPresets] = useState<StudioPreset[]>(() => BUILTIN_PRESETS);
  const [presetId, setPresetId] = useState('builtin-general-video');
  const [presetPickerOpen, setPresetPickerOpen] = useState(false);
  const [elementModalOpen, setElementModalOpen] = useState(false);
  const [elementSearch, setElementSearch] = useState('');
  // Null while no `@` is being typed; otherwise the partial name after it.
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const [flyoutStyle, setFlyoutStyle] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(null);
  const launchLockRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  const modelOptions = useMemo(() => {
    void catalogVersion;
    const categories: Array<ModelDefinition['category']> = outputKind === 'video'
      ? ['video']
      : ['image', 'image-edit'];
    return providerModelOptions(categories).filter((option) => {
      const model = getModelDefinition(option.key);
      return Boolean(model && canUseInStudio(model, outputKind));
    });
  }, [catalogVersion, outputKind]);

  const groupedModelOptions = useMemo(() => {
    const groups = new Map<string, Array<{ key: string; name: string }>>();
    for (const option of modelOptions) {
      const model = getModelDefinition(option.key);
      if (!model) continue;
      const provider = modelProviderLabel(model);
      const entries = groups.get(provider) ?? [];
      entries.push({ key: option.key, name: model.name });
      groups.set(provider, entries);
    }
    return [...groups.entries()];
  }, [modelOptions]);

  useEffect(() => {
    if (modelOptions.some((option) => option.key === modelType)) return;
    const preferred = outputKind === 'video'
      ? modelOptions.find((option) => getModelDefinition(option.key)?.name === DEFAULT_VIDEO_MODEL_NAME)
      : undefined;
    setModelType(preferred?.key ?? modelOptions[0]?.key ?? '');
  }, [modelOptions, modelType, outputKind]);

  const model = modelType ? getModelDefinition(modelType) : undefined;
  const allControls = useMemo(() => orderedControlFields(model), [model]);
  // Toggles live in the prompt card as chips; the settings row keeps the value
  // pickers, which then fit on a single line.
  const controls = useMemo(
    () => allControls.filter((field) => field.fieldType !== 'toggle' && isPillControl(field)),
    [allControls],
  );
  const rowControls = useMemo(
    () => allControls.filter((field) => field.fieldType !== 'toggle' && !isPillControl(field)),
    [allControls],
  );
  const toggleControls = useMemo(
    () => allControls.filter((field) => field.fieldType === 'toggle'),
    [allControls],
  );
  const imageAssets = useMemo(
    () => state.assets.filter((asset) => asset.type === 'image'),
    [state.assets],
  );
  const availableElements = useMemo(
    () => state.elements.filter((element) => elementImagesForVariation(element).length > 0),
    [state.elements],
  );
  const startField = model ? startFieldFor(model) : undefined;
  const endField = model ? endFieldFor(model) : undefined;
  const referenceField = model ? referenceFieldFor(model) : undefined;
  const supportsFrames = Boolean(startField);
  const supportsReferences = Boolean(referenceField);
  const hasDurationControl = controls.some((field) => (
    field.id === 'duration' || field.id === 'durationSec' || field.id === 'duration_sec'
  ));
  const hasAudioControl = controls.some((field) => (
    field.id === 'generate_audio' || field.id === 'generateAudio'
  ));

  useEffect(() => {
    if (!startField) setStartAssetId('');
    if (!endField) setEndAssetId('');
  }, [endField, startField]);

  // Never leave the composer on a guidance mode the chosen model cannot accept —
  // that only surfaced as a rejection after the user had already written the prompt.
  useEffect(() => {
    if (outputKind !== 'video') return;
    if (videoMode === 'frames' && !supportsFrames && supportsReferences) setVideoMode('references');
    if (videoMode === 'references' && !supportsReferences && supportsFrames) setVideoMode('frames');
  }, [outputKind, supportsFrames, supportsReferences, videoMode]);

  // A phone keyboard would cover half of an auto-focused sheet, and "focus the
  // prompt" after reuse would open it over the composer the user cannot see.
  const coarsePointer = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
  const anyFlyoutOpen = elementModalOpen || modelPickerOpen || presetPickerOpen || dockModeMenuOpen || rowOpen !== null || sliderOpen !== null;

  useEffect(() => {
    if (!anyFlyoutOpen) return undefined;
    const place = () => {
      // jsdom has no matchMedia; only a real viewport gets the sheet.
      if (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 780px)').matches) {
        setFlyoutStyle(null);
        return;
      }
      // Docked bar: the picker rises above the bar, aligned to the pill that opened it.
      if (dockModeRef.current && formRef.current) {
        const bar = formRef.current.getBoundingClientRect();
        const anchor = flyoutAnchorRef.current?.getBoundingClientRect();
        const margin = 16;
        const width = Math.min(420, window.innerWidth - margin * 2);
        const left = Math.max(margin, Math.min(anchor?.left ?? bar.left, window.innerWidth - width - margin));
        setFlyoutStyle({ bottom: window.innerHeight - bar.top + 10, left, width });
        return;
      }
      const composer = composerRef.current;
      if (!composer) return;
      const box = composer.getBoundingClientRect();
      const gap = 16;
      const margin = 16;
      const rightRoom = window.innerWidth - box.right - gap - margin;
      const width = Math.min(560, Math.max(320, rightRoom));
      // Prefer the space to the right; otherwise overlay the composer itself.
      const left = rightRoom >= 320
        ? box.right + gap
        : Math.max(margin, Math.min(box.left, window.innerWidth - width - margin));
      const top = Math.max(margin, Math.min(box.top, window.innerHeight - 240));
      setFlyoutStyle({ top, left, width });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anyFlyoutOpen]);

  useEffect(() => {
    if (!anyFlyoutOpen) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (flyoutRef.current?.contains(target)) return;
      if (target.closest('[data-testid="space-studio-elements-chip"]')) return;
      if (target.closest('[data-testid="space-studio-add-reference"]')) return;
      if (target.closest('[data-testid="space-studio-model"]')) return;
      // Clicks inside an open menu, or on the control that owns it, are handled
      // by that element: closing here would swallow the selection and make the
      // trigger reopen what it just closed.
      if (target.closest('.space-studio__pill-menu, .space-studio__option-flyout, .space-studio__slider-pop, .space-studio__mentions')) return;
      if (target.closest('.space-studio__pill-trigger, .space-studio__setting-row')) return;
      setElementModalOpen(false);
      setModelPickerOpen(false);
      setPresetPickerOpen(false);
      setDockModeMenuOpen(false);
      setRowOpen(null);
      setSliderOpen(null);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setElementModalOpen(false);
      setModelPickerOpen(false);
      setPresetPickerOpen(false);
      setDockModeMenuOpen(false);
      setRowOpen(null);
      setSliderOpen(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [anyFlyoutOpen]);

  useEffect(() => {
    setPresets(loadStudioPresets());
  }, []);

  const activePreset = useMemo(
    () => presets.find((preset) => preset.id === presetId),
    [presetId, presets],
  );
  const kindPresets = useMemo(
    () => presets.filter((preset) => preset.outputKind === outputKind),
    [outputKind, presets],
  );

  // A preset belongs to one output kind; switching tabs moves to that kind's
  // General rather than leaving a video look attached to an image generation.
  useEffect(() => {
    if (activePreset?.outputKind === outputKind) return;
    const next = kindPresets.find((preset) => preset.name === 'General') ?? kindPresets[0];
    if (next) setPresetId(next.id);
  }, [activePreset, kindPresets, outputKind]);

  const applyPreset = useCallback((preset: StudioPreset) => {
    setPresetId(preset.id);
    setPresetPickerOpen(false);
    setFormError('');
    const nextModel = resolvePresetModel(preset, modelOptions, modelType);
    if (nextModel !== modelType) setModelType(nextModel);
    if (preset.videoMode && outputKind === 'video') setVideoMode(preset.videoMode);
    const definition = getModelDefinition(nextModel);
    const accepted = presetControlsFor(preset, definition);
    if (Object.keys(accepted).length > 0) {
      setControlValuesByModel((current) => ({
        ...current,
        [nextModel]: { ...(current[nextModel] ?? {}), ...accepted },
      }));
    }
  }, [modelOptions, modelType, outputKind]);

  const workflowDispatch = useCallback((): WorkflowDispatch => ({
    setNodeRunning: (nodeId, running) => dispatch({ type: 'SET_NODE_RUNNING', nodeId, running }),
    setNodeResult: (nodeId, result) => dispatch({ type: 'SET_NODE_RESULT', nodeId, result }),
    addGeneration: (nodeId, url) => dispatch({ type: 'ADD_GENERATION', nodeId, url }),
    addAsset: (asset) => dispatch({
      type: 'ADD_ASSET',
      asset: { ...asset, thumbnailUrl: asset.url },
    }),
    getElements: () => state.elements,
  }), [dispatch, state.elements]);

  const setOutputType = (kind: OutputKind) => {
    setOutputKind(kind);
    setFormError('');
  };

  const setControl = (field: ModelInputField, value: ControlValue) => {
    setControlValuesByModel((current) => ({
      ...current,
      [modelType]: {
        ...(current[modelType] ?? {}),
        [field.id]: value,
      },
    }));
  };

  const toggleElement = (elementId: string) => {
    const element = availableElements.find((candidate) => candidate.id === elementId);
    const selected = selectedElementIds.includes(elementId);
    setSelectedElementIds((current) => (
      selected ? current.filter((id) => id !== elementId) : [...current, elementId]
    ));
    if (!element) return;
    // Keep the prompt and the reference list as one thing: picking an Element
    // writes its tag into the prompt, dropping it takes the tag back out.
    const token = mentionToken(element.name);
    setPrompt((current) => {
      if (selected) {
        return current
          .replace(new RegExp(`\\s?${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), '')
          .replace(/\s{2,}/g, ' ')
          .trimStart();
      }
      if (current.includes(token)) return current;
      return current.trim() ? `${current.replace(/\s+$/, '')} ${token} ` : `${token} `;
    });
  };

  const runNode = useCallback((
    nodeId: string,
    nodes: Node<WorkflowNodeData>[],
    edges: Edge[],
  ) => {
    const adapter = workflowDispatch();
    void executeFromNode(nodeId, nodes, edges, adapter).catch((error: unknown) => {
      adapter.setNodeRunning(nodeId, false);
      adapter.setNodeResult(nodeId, {
        status: 'error',
        error: error instanceof Error ? error.message : 'Generation failed.',
      });
    });
  }, [workflowDispatch]);

  const syncMention = (value: string, caret: number) => {
    const query = activeMention(value, caret);
    setMentionQuery(query);
    setMentionIndex(0);
  };

  const insertMention = (element: CineElement) => {
    const textarea = promptRef.current;
    const caret = textarea?.selectionStart ?? prompt.length;
    const before = prompt.slice(0, caret);
    const start = before.lastIndexOf('@');
    if (start < 0) return;
    const token = `${mentionToken(element.name)} `;
    const next = `${prompt.slice(0, start)}${token}${prompt.slice(caret)}`;
    setPrompt(next);
    setMentionQuery(null);
    if (supportsReferences && !selectedElementIds.includes(element.id)) {
      setSelectedElementIds((current) => [...current, element.id]);
      if (outputKind === 'video') setVideoMode('references');
    }
    window.requestAnimationFrame(() => {
      const position = start + token.length;
      textarea?.focus();
      textarea?.setSelectionRange(position, position);
    });
  };

  const reuseGeneration = useCallback((node: Node<WorkflowNodeData>, feedModel: ModelDefinition) => {
    // Resolve from the live graph, not just the __studio* mirrors — a video
    // built on the canvas keeps its prompt, Elements, and frames on upstream
    // nodes, and reading the mirrors alone dropped all three.
    const recipe = resolveStudioRecipe(node, feedModel, state.nodes, state.edges, state.assets);
    // A stored id may belong to an element that has since been deleted and
    // re-created with a new id (a library re-import does exactly this). Fall
    // back to the name we stored, and count anything still unmatched so the
    // user is told rather than shown a silently empty strip.
    const resolvedIds: string[] = [];
    let missing = 0;
    recipe.elementIds.forEach((id, index) => {
      if (availableElements.some((element) => element.id === id)) {
        resolvedIds.push(id);
        return;
      }
      const name = recipe.elementNames[index];
      const byName = name
        ? availableElements.find((element) => element.name.trim().toLowerCase() === name.trim().toLowerCase())
        : undefined;
      if (byName) resolvedIds.push(byName.id);
      else missing += 1;
    });
    const kind = feedModel.outputType === 'video' ? 'video' : 'image';
    setOutputKind(kind);
    setModelType(feedModel.nodeType);
    setPrompt(recipe.prompt);
    if (recipe.presetId) setPresetId(recipe.presetId);
    setSelectedElementIds(resolvedIds);
    setMissingReferences(missing);
    // Infer the mode from what actually resolved — landing in References with
    // nothing attached and no explanation was the bug being fixed here.
    const storedMode = node.data.config.__studioVideoMode;
    setVideoMode(storedMode === 'frames' || storedMode === 'references'
      ? storedMode
      : resolvedIds.length ? 'references' : 'frames');
    setStartAssetId(recipe.startAssetId);
    setEndAssetId(recipe.endAssetId);
    setControlValuesByModel((current) => ({ ...current, [feedModel.nodeType]: recipe.controls }));
    setFormError('');
    if (coarsePointer) composerRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    else promptRef.current?.focus();
  }, [availableElements, state.assets, state.edges, state.nodes]);

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && mentionMatches.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setMentionIndex((current) => {
          const delta = event.key === 'ArrowDown' ? 1 : -1;
          return (current + delta + mentionMatches.length) % mentionMatches.length;
        });
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        insertMention(mentionMatches[mentionIndex] ?? mentionMatches[0]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setMentionQuery(null);
        return;
      }
    }
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    formRef.current?.requestSubmit();
  };

  const handleGenerate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (launchLockRef.current) return;

    const trimmedPrompt = prompt.trim();
    const selectedModel = modelType ? getModelDefinition(modelType) : undefined;
    if (!trimmedPrompt) {
      setFormError('Write a prompt before generating.');
      return;
    }
    if (!selectedModel) {
      setFormError('Choose an available model.');
      return;
    }

    const promptField = promptFieldFor(selectedModel);
    if (!promptField) {
      setFormError('This model does not expose a prompt input for Studio.');
      return;
    }

    const useReferences = outputKind === 'image' || videoMode === 'references';
    const elementIds = useReferences
      ? selectedElementIds.filter((id) => availableElements.some((element) => element.id === id))
      : [];
    const selectedReferenceField = referenceFieldFor(selectedModel);
    if (elementIds.length > 0 && !selectedReferenceField) {
      setFormError('This model does not accept Element references.');
      return;
    }

    const selectedStartAsset = imageAssets.find((asset) => asset.id === startAssetId);
    const selectedEndAsset = imageAssets.find((asset) => asset.id === endAssetId);
    const selectedStartField = startFieldFor(selectedModel);
    const selectedEndField = endFieldFor(selectedModel);
    if (outputKind === 'video' && videoMode === 'frames') {
      if (selectedStartAsset && !selectedStartField) {
        setFormError('This model does not accept a start frame.');
        return;
      }
      if (selectedEndAsset && !selectedEndField) {
        setFormError('This model does not accept an end frame.');
        return;
      }
      if (selectedEndAsset && !selectedStartAsset) {
        setFormError('Choose a start frame before adding an end frame.');
        return;
      }
    }

    const connectedFields = new Set<string>([promptField.id]);
    if (elementIds.length > 0 && selectedReferenceField) connectedFields.add(selectedReferenceField.id);
    if (outputKind === 'video' && videoMode === 'frames') {
      if (selectedStartAsset && selectedStartField) connectedFields.add(selectedStartField.id);
      if (selectedEndAsset && selectedEndField) connectedFields.add(selectedEndField.id);
    }

    const currentControlValues = controlValuesByModel[modelType];
    const elementVariationIds = Object.fromEntries(
      availableElements
        .filter((element) => elementIds.includes(element.id) && element.activeVariationId)
        .map((element) => [element.id, element.activeVariationId as string]),
    );
    const modelConfig: Record<string, unknown> = {
      __studioGenerated: true,
      __studioCreatedAt: timestamp(),
      __studioOutputType: outputKind,
      __studioVideoMode: outputKind === 'video' ? videoMode : undefined,
      __studioPrompt: trimmedPrompt,
      __studioElementIds: elementIds,
      __studioElementNames: elementIds.map((id) => (
        availableElements.find((element) => element.id === id)?.name ?? ''
      )),
      __studioElementVariationIds: elementVariationIds,
      __studioStartAssetId: selectedStartAsset?.id,
      __studioEndAssetId: selectedEndAsset?.id,
    };
    for (const field of orderedControlFields(selectedModel)) {
      const value = controlValue(currentControlValues, field);
      if (value !== '') modelConfig[field.id] = value;
    }
    const missingRequired = selectedModel.inputs.find((field) => {
      if (!field.required || field.default !== undefined) return false;
      if (connectedFields.has(field.id)) return false;
      if (Object.prototype.hasOwnProperty.call(modelConfig, field.id)) return false;
      return true;
    });
    if (missingRequired) {
      setFormError(`${missingRequired.label} is required for ${selectedModel.name}.`);
      return;
    }

    launchLockRef.current = true;
    setIsLaunching(true);
    setFormError('');

    // One generation is ONE node. The prompt, element, and frame nodes this used
    // to create were pure config carriers — the executor reads config as a
    // first-class fallback — so five nodes per generation only ever bought
    // clutter. `Expand to graph` on the node rebuilds the wired form on demand.
    const composedPrompt = composePresetPrompt(trimmedPrompt, activePreset);
    modelConfig[promptField.id] = composedPrompt;
    modelConfig.__studioPromptBody = trimmedPrompt;
    if (activePreset && activePreset.promptSuffix) {
      modelConfig.__studioPresetId = activePreset.id;
      modelConfig.__studioPresetName = activePreset.name;
    }
    const attachedUrls = attachedRefs.map((reference) => reference.url);
    if ((elementIds.length > 0 || attachedUrls.length > 0) && selectedReferenceField) {
      modelConfig[selectedReferenceField.id] = {
        elementIds,
        elementVariationIds,
        ...(attachedUrls.length > 0 ? { urls: attachedUrls } : {}),
      };
      modelConfig.__studioElementVariationIds = elementVariationIds;
      if (attachedUrls.length > 0) modelConfig.__studioAttachedRefs = attachedUrls;
    }
    if (outputKind === 'video' && videoMode === 'frames') {
      if (selectedStartAsset && selectedStartField) {
        modelConfig[selectedStartField.id] = toFileUrl(selectedStartAsset.fileRef || selectedStartAsset.url);
      }
      if (selectedEndAsset && selectedEndField) {
        modelConfig[selectedEndField.id] = toFileUrl(selectedEndAsset.fileRef || selectedEndAsset.url);
      }
    }

    // Every version is a node of its own, so the feed shows N clips and each can
    // be liked, reviewed, or reused on its own.
    const created: Node<WorkflowNodeData>[] = [];
    for (let index = 0; index < batchCount; index += 1) {
      created.push(createWorkflowNodeFromSpec({
        nodeType: selectedModel.nodeType,
        label: selectedModel.name,
        config: {
          ...modelConfig,
          ...(batchCount > 1 ? { __studioBatchIndex: index + 1, __studioBatchSize: batchCount } : {}),
        },
      }, nextStudioSlot([...state.nodes, ...created])));
    }

    const nextNodes = [...state.nodes, ...created];
    dispatch({ type: 'SET_NODES', nodes: nextNodes });
    for (const modelNode of created) runNode(modelNode.id, nextNodes, state.edges);
    setComposerOpen(false);

    window.setTimeout(() => {
      launchLockRef.current = false;
      setIsLaunching(false);
    }, 0);
  };

  const feedItems = useMemo(() => state.nodes
    .map((node, index) => ({ node, index, model: getModelDefinition(node.data.type) }))
    .filter((entry): entry is { node: Node<WorkflowNodeData>; index: number; model: ModelDefinition } => {
      if (!entry.model || (entry.model.outputType !== 'image' && entry.model.outputType !== 'video')) return false;
      const resultStatus = entry.node.data.result?.status;
      return Boolean(
        entry.node.data.config.__studioGenerated
        || (resultStatus && resultStatus !== 'idle')
        || generationUrls(entry.node).length > 0,
      );
    })
    .filter((entry) => (
      feedFilter === 'all'
        ? true
        : feedFilter === 'liked' ? clipLiked(entry.node) : entry.model.outputType === feedFilter
    ))
    .sort((left, right) => (
      studioCreatedAt(right.node) - studioCreatedAt(left.node) || right.index - left.index
    )), [feedFilter, state.nodes]);

  // Topview publishes image credit prices; there is no video price table, so the
  // badge appears only where the number is real rather than guessed.
  const creditEstimate = useMemo(() => {
    if (!model || outputKind !== 'image') return null;
    const resolution = controlValue(controlValuesByModel[modelType], 
      controls.find((field) => field.id === 'resolution') ?? { id: 'resolution' } as ModelInputField);
    const estimate = topviewImageCreditEstimate({
      model,
      resolution: typeof resolution === 'string' && resolution ? resolution : undefined,
      count: batchCount,
    });
    return estimate ? estimate.totalCredits : null;
  }, [batchCount, controls, controlValuesByModel, model, modelType, outputKind]);

  const selectedElements = useMemo(
    () => availableElements.filter((element) => selectedElementIds.includes(element.id)),
    [availableElements, selectedElementIds],
  );

  const modalElements = useMemo(() => {
    const needle = elementSearch.trim().toLowerCase();
    if (!needle) return availableElements;
    return availableElements.filter((element) => element.name.toLowerCase().includes(needle));
  }, [availableElements, elementSearch]);

  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return [];
    const needle = mentionQuery.toLowerCase();
    return availableElements
      .filter((element) => element.name.toLowerCase().replace(/\s+/g, '-').includes(needle))
      .slice(0, 6);
  }, [availableElements, mentionQuery]);

  useEffect(() => {
    writeFeedView(feedView);
  }, [feedView]);

  // Written on every change rather than on unmount: a crash, a restart, or a
  // dev hot reload never gets the chance to run an unmount handler.
  useEffect(() => {
    writeComposerDraft(projectId, {
      prompt,
      outputKind,
      videoMode,
      elementIds: selectedElementIds,
      attachments: attachedRefs,
      startAssetId,
      endAssetId,
    });
  }, [attachedRefs, endAssetId, outputKind, projectId, prompt, selectedElementIds, startAssetId, videoMode]);

  // The visit ends when the Studio unmounts or the page goes away; everything
  // created after that is "New" next time.
  useEffect(() => {
    const end = () => { writeSeen(projectId, { seenAt: Date.now() }); };
    window.addEventListener('pagehide', end);
    return () => {
      window.removeEventListener('pagehide', end);
      end();
    };
  }, [projectId]);

  const activeSpaceName = state.spaces.find((space) => space.id === state.activeSpaceId)?.name ?? 'Space';

  const clipItems = useMemo<ClipItem[]>(() => feedItems.map(({ node, model: feedModel }) => {
    const urls = generationUrls(node);
    const status = generationStatus(node, state.runningNodeIds.has(node.id), urls.length);
    const createdAt = studioCreatedAt(node);
    const preferred = typeof node.data.activeGeneration === 'number' ? node.data.activeGeneration : urls.length - 1;
    const url = urls[Math.min(Math.max(0, preferred), Math.max(0, urls.length - 1))] ?? '';
    return {
      id: node.id,
      node,
      model: feedModel,
      kind: feedModel.outputType === 'image' ? 'image' : 'video',
      url,
      urls,
      prompt: feedPromptFor(node, feedModel, state.nodes, state.edges),
      status,
      ...(status === 'error' ? { error: classifyFeedError(node.data.result?.error).message } : {}),
      createdAt,
      startedAt: node.data.result?.progressStartedAt ?? createdAt,
      liked: clipLiked(node),
      review: clipReview(node),
      comments: clipComments(node),
      elementNames: clipElementNames(node),
      isNew: isNewClip(createdAt, node.id, seen, status),
      lastViewed: seen.lastViewed === node.id,
    };
  }), [feedItems, seen, state.edges, state.nodes, state.runningNodeIds]);

  const clipById = useCallback((id: string) => clipItems.find((item) => item.id === id), [clipItems]);

  // Selection is a moment, not a setting: a new view or filter starts clean, and
  // ids that left the feed (removed, filtered out) drop out of it.
  useEffect(() => {
    setSelectedClipIds(new Set());
  }, [feedFilter, feedView]);
  const selectedClips = useMemo(() => clipItems.filter((item) => selectedClipIds.has(item.id)), [clipItems, selectedClipIds]);

  const toggleSelectClip = useCallback((id: string) => {
    setSelectedClipIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelectedClipIds(new Set()), []);
  const viewerItem = viewerId ? clipById(viewerId) : undefined;
  const viewerIndex = viewerItem ? clipItems.indexOf(viewerItem) : -1;

  const showNotice = useCallback((text: string, kind: 'info' | 'error' = 'info') => {
    setFeedNotice({ text, kind });
    window.setTimeout(() => setFeedNotice((current) => (current?.text === text ? null : current)), 4500);
  }, []);

  const openClip = useCallback((id: string) => {
    setViewerId(id);
    // Opening a tile that is still rendering is not watching it. Counting that
    // as a view would burn the "New" badge before the clip ever existed.
    const watched = Boolean(clipById(id)?.url);
    setSeen((current) => writeSeen(projectId, {
      viewed: !watched || current.viewed.includes(id) ? current.viewed : [...current.viewed, id],
      lastViewed: id,
    }));
  }, [clipById, projectId]);

  const navigateViewer = useCallback((delta: 1 | -1) => {
    if (viewerIndex < 0 || clipItems.length === 0) return;
    const next = clipItems[(viewerIndex + delta + clipItems.length) % clipItems.length];
    openClip(next.id);
  }, [clipItems, openClip, viewerIndex]);

  const updateClipConfig = useCallback((id: string, config: Record<string, unknown>) => {
    dispatch({ type: 'UPDATE_NODE_CONFIG', nodeId: id, config });
  }, [dispatch]);

  const toggleLike = useCallback((id: string) => {
    const item = clipById(id);
    if (item) updateClipConfig(id, { __studioLiked: !item.liked });
  }, [clipById, updateClipConfig]);

  const setReview = useCallback((id: string, status: ClipReviewStatus | null) => {
    updateClipConfig(id, { __studioReview: status ?? undefined });
  }, [updateClipConfig]);

  const addComment = useCallback((id: string, text: string, timeSec?: number) => {
    const item = clipById(id);
    if (!item) return;
    updateClipConfig(id, {
      __studioComments: [
        ...item.comments,
        { id: commentId(), text, at: timestamp(), author: 'You', ...(typeof timeSec === 'number' ? { timeSec } : {}) },
      ],
    });
  }, [clipById, updateClipConfig]);

  const downloadClip = useCallback((id: string) => {
    const item = clipById(id);
    if (!item?.url) return;
    void downloadUrl(item.url, clipFileName(item.model, item.createdAt, item.url, item.kind));
  }, [clipById]);

  const recreateClip = useCallback((id: string) => {
    const item = clipById(id);
    if (!item) return;
    setViewerId(null);
    reuseGeneration(item.node, item.model);
  }, [clipById, reuseGeneration]);

  /** Capture one frame of a clip and file it as an image asset of the project. */
  const assetFromFrame = useCallback(async (item: ClipItem, at: 'start' | 'end'): Promise<Asset> => {
    const dataUrl = await captureVideoFrame(item.url, at);
    let fileRef: string | undefined;
    try {
      const written = await window.electronAPI?.media?.writeTempImage?.({ dataUrl });
      fileRef = written?.outputPath || undefined;
    } catch {
      fileRef = undefined;
    }
    const asset: Asset = {
      id: generateId(),
      name: `${item.model.name} · ${at === 'start' ? 'first' : 'last'} frame`,
      type: 'image',
      url: fileRef ?? dataUrl,
      thumbnailUrl: dataUrl,
      createdAt: timestamp(),
      ...(fileRef ? { fileRef } : {}),
      metadata: { generatedVia: 'studio-frame', sourceNodeId: item.id, frame: at },
    };
    dispatch({ type: 'ADD_ASSET', asset });
    return asset;
  }, [dispatch]);

  /** The bar's "+": bring a file off the machine in as the shot's start frame. */
  const attachLocalFile = useCallback(async (file: File | undefined, target?: FrameSlot | null) => {
    if (!file) return;
    if (target && getMediaTypeForFile(file) !== 'image') {
      showNotice('A frame has to be an image.', 'error');
      return;
    }
    const kind = getMediaTypeForFile(file);
    if (kind !== 'image' && kind !== 'video' && kind !== 'audio') {
      showNotice('Attach an image, a video, or an audio file.', 'error');
      return;
    }
    try {
      const url = await resolveMediaFileUrl(file);
      const localPath = getLocalPathForFile(file);
      const asset: Asset = {
        id: generateId(),
        name: file.name,
        type: kind,
        url,
        createdAt: timestamp(),
        ...(localPath ? { fileRef: localPath } : {}),
        metadata: { generatedVia: 'studio-attachment' },
      };
      dispatch({ type: 'ADD_ASSET', asset });
      if (target) {
        setVideoMode('frames');
        if (target === 'start') setStartAssetId(asset.id);
        else setEndAssetId(asset.id);
        showNotice(`${file.name} is the ${target === 'start' ? 'first' : 'last'} frame.`);
        return;
      }
      // An attachment is a reference. Switching the shot to Frames behind the
      // user's back was the wrong call: the mode is theirs to choose.
      setAttachedRefs((current) => (
        current.length >= MAX_ATTACHED_REFERENCES || current.some((entry) => entry.url === url)
          ? current
          : [...current, { id: asset.id, url, name: file.name, kind }]
      ));
      showNotice(`${file.name} added as a reference.`);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Could not attach that file.', 'error');
    }
  }, [dispatch, showNotice]);

  const useAsStartFrame = useCallback((asset: Asset) => {
    setVideoMode('frames');
    setStartAssetId(asset.id);
    setViewerId(null);
    if (coarsePointer) composerRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [coarsePointer]);

  const referenceClip = useCallback(async (id: string) => {
    const item = clipById(id);
    if (!item?.url) return;
    try {
      let asset: Asset;
      if (item.kind === 'image') {
        const existing = state.assets.find((candidate) => candidate.url === item.url || candidate.sourceUrl === item.url);
        asset = existing ?? {
          id: generateId(),
          name: `${item.model.name} image`,
          type: 'image',
          url: item.url,
          createdAt: timestamp(),
          metadata: { generatedVia: 'studio-generation', sourceNodeId: item.id },
        };
        if (!existing) dispatch({ type: 'ADD_ASSET', asset });
      } else {
        asset = await assetFromFrame(item, 'start');
      }
      useAsStartFrame(asset);
      showNotice(item.kind === 'image' ? 'Loaded as the start frame.' : 'First frame loaded as the start frame.');
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Could not use this clip as a reference.', 'error');
    }
  }, [assetFromFrame, clipById, dispatch, showNotice, state.assets, useAsStartFrame]);

  const extendClip = useCallback(async (id: string) => {
    const item = clipById(id);
    if (!item?.url || item.kind !== 'video') return;
    try {
      useAsStartFrame(await assetFromFrame(item, 'end'));
      showNotice('Last frame loaded as the start frame. Describe what happens next.');
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Could not extend this clip.', 'error');
    }
  }, [assetFromFrame, clipById, showNotice, useAsStartFrame]);

  const extractFrame = useCallback(async (id: string, at: 'start' | 'end') => {
    const item = clipById(id);
    if (!item?.url || item.kind !== 'video') return;
    try {
      await assetFromFrame(item, at);
      showNotice(`Saved the ${at === 'start' ? 'first' : 'last'} frame to Assets.`);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Could not extract the frame.', 'error');
    }
  }, [assetFromFrame, clipById, showNotice]);

  const copyPromptOf = useCallback(async (id: string) => {
    const item = clipById(id);
    const ok = item?.prompt ? await copyText(item.prompt) : false;
    if (!ok) showNotice('Could not copy the prompt.', 'error');
    return ok;
  }, [clipById, showNotice]);

  const copyUrlOf = useCallback(async (id: string) => {
    const item = clipById(id);
    if (!item?.url) return;
    const ok = await copyText(item.url);
    showNotice(ok ? `Copied the ${item.kind} URL.` : 'Could not copy the URL.', ok ? 'info' : 'error');
  }, [clipById, showNotice]);

  const removeClips = useCallback((ids: ReadonlySet<string>) => {
    dispatch({ type: 'SET_NODES', nodes: state.nodes.filter((candidate) => !ids.has(candidate.id)) });
    dispatch({ type: 'SET_EDGES', edges: state.edges.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target)) });
    setViewerId((current) => (current && ids.has(current) ? null : current));
    setSelectedClipIds((current) => {
      const next = new Set([...current].filter((id) => !ids.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [dispatch, state.edges, state.nodes]);
  const removeClip = useCallback((id: string) => removeClips(new Set([id])), [removeClips]);

  // Bulk actions over the selection.
  const allSelectedLiked = selectedClips.length > 0 && selectedClips.every((item) => item.liked);
  const likeSelected = useCallback(() => {
    for (const item of selectedClips) updateClipConfig(item.id, { __studioLiked: !allSelectedLiked });
  }, [allSelectedLiked, selectedClips, updateClipConfig]);
  const downloadSelected = useCallback(() => {
    selectedClips.filter((item) => item.url).forEach((item, index) => {
      window.setTimeout(() => downloadClip(item.id), index * 400);
    });
  }, [downloadClip, selectedClips]);
  const reviewSelected = useCallback((status: ClipReviewStatus | null) => {
    for (const item of selectedClips) updateClipConfig(item.id, { __studioReview: status ?? undefined });
  }, [selectedClips, updateClipConfig]);
  const copySelectedPrompts = useCallback(async () => {
    const text = selectedClips.map((item) => item.prompt).filter(Boolean).join('\n\n');
    const ok = text ? await copyText(text) : false;
    showNotice(ok ? `Copied ${selectedClips.length === 1 ? 'the prompt' : `${selectedClips.length} prompts`}.` : 'Could not copy the prompts.', ok ? 'info' : 'error');
  }, [selectedClips, showNotice]);

  // Escape backs out of a selection once nothing else is open.
  useEffect(() => {
    if (selectedClips.length === 0) return undefined;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !anyFlyoutOpen && !viewerId) clearSelection();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [anyFlyoutOpen, clearSelection, selectedClips.length, viewerId]);

  const heroSource = useMemo(() => {
    for (const entry of feedItems) {
      if (entry.model.outputType !== outputKind) continue;
      const url = generationUrls(entry.node)[0];
      if (url) return { url, isVideo: entry.model.outputType === 'video' };
    }
    return null;
  }, [feedItems, outputKind]);
  const heroUrl = heroSource?.url;
  const heroIsVideo = Boolean(heroSource?.isVideo);

  const promptWords = wordCount(prompt);
  const selectedElementCount = selectedElementIds.filter((id) => (
    availableElements.some((element) => element.id === id)
  )).length;
  const referencesActive = outputKind === 'image' || videoMode === 'references';

  const capabilityBadges = useMemo(() => (model ? modelCapabilitySummary(model) : []), [model]);

  const filteredModels = useMemo(() => {
    const needle = modelSearch.trim().toLowerCase();
    return groupedModelOptions
      .map(([provider, entries]) => [
        provider,
        entries.filter((entry) => (
          !needle
          || entry.name.toLowerCase().includes(needle)
          || provider.toLowerCase().includes(needle)
        )),
      ] as [string, Array<{ key: string; name: string }>])
      .filter(([, entries]) => entries.length > 0);
  }, [groupedModelOptions, modelSearch]);

  const renderFrameSlot = (
    label: string,
    field: ModelInputField | undefined,
    value: string,
    onChange: (assetId: string) => void,
    testId: string,
  ) => {
    if (!field) return null;
    const asset = imageAssets.find((candidate) => candidate.id === value);
    const role: FrameSlot = testId.includes('start') ? 'start' : 'end';
    return (
      <div className={`space-studio__slot${asset ? ' is-filled' : ''}`}>
        <button
          type="button"
          className="space-studio__slot-button"
          data-testid={testId}
          aria-label={asset ? `${label}: ${asset.name}. Change` : `Add ${label.toLowerCase()}`}
          onClick={() => setFrameSlotTarget((current) => (current === role ? null : role))}
        >
          {asset
            ? <img src={assetPreviewUrl(asset)} alt="" />
            : <span className="space-studio__slot-icon" aria-hidden="true">+</span>}
          <span className="space-studio__slot-label">{label}</span>
        </button>
        {!asset && <span className="space-studio__slot-badge">Optional</span>}
        {asset && (
          <button
            type="button"
            className="space-studio__slot-clear"
            aria-label={`Remove ${label.toLowerCase()}`}
            onClick={() => onChange('')}
          >
            ×
          </button>
        )}
      </div>
    );
  };

  const promptChips = supportsReferences || toggleControls.length > 0
    ? (
      <>
                {supportsReferences && (
                  <button
                    type="button"
                    className={`space-studio__prompt-chip${referencesActive && selectedElementCount > 0 ? ' is-on' : ''}`}
                    data-testid="space-studio-elements-chip"
                    onClick={(event) => {
                      flyoutAnchorRef.current = event.currentTarget;
                      if (outputKind === 'video') setVideoMode('references');
                      setFormError('');
                      setElementSearch('');
                      setElementModalOpen(true);
                    }}
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                      <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.4" />
                      <path d="M11 8v1.2a2 2 0 0 0 3 1.5A6.2 6.2 0 1 0 11.4 13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                    Elements
                    {selectedElementCount > 0 && <em>{selectedElementCount}</em>}
                  </button>
                )}
                {toggleControls.map((field) => {
                  const on = Boolean(controlValue(controlValuesByModel[modelType], field));
                  return (
                    <button
                      key={field.id}
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={field.label}
                      className={`space-studio__prompt-chip space-studio__prompt-chip--toggle${on ? ' is-on' : ''}`}
                      data-testid={`space-studio-control-${field.id}`}
                      onClick={() => setControl(field, !on)}
                    >
                      {pillIcon(field) ?? null}
                      {on ? 'On' : 'Off'}
                    </button>
                  );
                })}
      </>
    )
    : null;

  const openAttachFor = (target: FrameSlot | null) => {
    attachTargetRef.current = target;
    attachInputRef.current?.click();
  };

  const renderDockFrame = (label: string, target: FrameSlot, value: string, onClear: () => void) => {
    const asset = imageAssets.find((candidate) => candidate.id === value);
    return (
      <div className={`space-studio__dock-frame${asset ? ' is-filled' : ''}`}>
        <button
          type="button"
          data-testid={`space-studio-dock-${target}-frame`}
          aria-label={asset ? `${label}: ${asset.name}. Replace` : `Add ${label.toLowerCase()} from your computer`}
          onClick={() => openAttachFor(target)}
        >
          {asset
            ? <img src={assetPreviewUrl(asset)} alt="" />
            : <span className="space-studio__dock-frame-icon" aria-hidden="true">+</span>}
          <span className="space-studio__dock-frame-label">{label}</span>
        </button>
        {asset && (
          <button
            type="button"
            className="space-studio__dock-frame-clear"
            aria-label={`Remove ${label.toLowerCase()}`}
            onClick={onClear}
          >
            ×
          </button>
        )}
      </div>
    );
  };

  // Frames mode names the first and last image of the shot, so the docked bar
  // carries the same two slots the panel has.
  const dockFrames = dockMode && outputKind === 'video' && videoMode === 'frames' && (startField || endField)
    ? (
      <div className="space-studio__dock-frames" data-testid="space-studio-dock-frames">
        {startField && renderDockFrame('First frame', 'start', startAssetId, () => setStartAssetId(''))}
        {endField && renderDockFrame('Last frame', 'end', endAssetId, () => setEndAssetId(''))}
      </div>
    )
    : null;

  // Everything attached to the shot should be visible without opening a picker,
  // the way the frame slots are. Elements and files sit in one strip because
  // they are the same thing to the model: references.
  const dockReferences = dockMode && (selectedElements.length > 0 || attachedRefs.length > 0)
    ? (
      <div className="space-studio__dock-refs" data-testid="space-studio-dock-refs">
        {selectedElements.map((element) => {
          const image = elementImagesForVariation(element)[0];
          return (
            <div key={element.id} className="space-studio__dock-ref" title={element.name}>
              {image
                ? <img src={toFileUrl(image.url)} alt="" />
                : <span className="space-studio__dock-ref-kind">EL</span>}
              <span className="space-studio__dock-ref-label">{element.name}</span>
              <button
                type="button"
                className="space-studio__dock-ref-clear"
                aria-label={`Remove ${element.name}`}
                data-testid={`space-studio-dock-ref-${element.id}`}
                onClick={() => toggleElement(element.id)}
              >
                ×
              </button>
            </div>
          );
        })}
        {attachedRefs.map((reference) => (
          <div key={reference.id} className="space-studio__dock-ref" title={reference.name}>
            {reference.kind === 'image' && <img src={toFileUrl(reference.url)} alt="" />}
            {reference.kind === 'video' && (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video
                src={toFileUrl(reference.url)}
                muted
                playsInline
                preload="metadata"
                onLoadedMetadata={(event) => primeVideoPoster(event.currentTarget)}
              />
            )}
            {reference.kind === 'audio' && <span className="space-studio__dock-ref-kind">AUD</span>}
            <span className="space-studio__dock-ref-label">{reference.name}</span>
            <button
              type="button"
              className="space-studio__dock-ref-clear"
              aria-label={`Remove ${reference.name}`}
              data-testid={`space-studio-dock-ref-${reference.id}`}
              onClick={() => setAttachedRefs((current) => current.filter((entry) => entry.id !== reference.id))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    )
    : null;

  // Grid mode docks the composer as a bar over the clips: the Higgsfield layout.
  const dockTools = dockMode
    ? (
      <>
        <button
          type="button"
          className="space-studio__dock-add"
          aria-label="Attach an image or video"
          data-testid="space-studio-dock-add"
          onClick={() => attachInputRef.current?.click()}
        >
          +
        </button>
        {promptChips}
        {outputKind === 'video' && (supportsFrames || supportsReferences) && (
          <div className="space-studio__dock-mode">
            <button
              type="button"
              className="space-studio__pill space-studio__pill-trigger"
              aria-haspopup="menu"
              aria-expanded={dockModeMenuOpen}
              data-testid="space-studio-dock-mode"
              onClick={(event) => {
                anchorRowMenu(event.currentTarget);
                setRowOpen(null);
                setSliderOpen(null);
                setDockModeMenuOpen((open) => !open);
              }}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <rect x="2" y="3" width="4" height="10" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
                <rect x="10" y="3" width="4" height="10" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
              </svg>
              <span>{videoMode === 'frames' ? 'Frames' : 'References'}</span>
              <i aria-hidden="true">⌄</i>
            </button>
            {dockModeMenuOpen && (
              <div className="space-studio__pill-menu" role="menu" aria-label="Video guidance" style={dockMenuStyle}>
                <button type="button" role="menuitemradio" aria-checked={videoMode === 'frames'} disabled={!supportsFrames} onClick={() => { setVideoMode('frames'); setDockModeMenuOpen(false); }}>Frames</button>
                <button type="button" role="menuitemradio" aria-checked={videoMode === 'references'} disabled={!supportsReferences} onClick={() => { setVideoMode('references'); setDockModeMenuOpen(false); }}>References</button>
              </div>
            )}
          </div>
        )}
      </>
    )
    : null;

  return (
    <div
      className={`space-studio${dockMode ? ' space-studio--dock' : ''}${sheetMode ? ' space-studio--sheet' : ''}${sheetMode && composerOpen ? ' is-composing' : ''}`}
      data-testid="space-studio"
    >
      {sheetMode && !composerOpen && selectedClips.length === 0 && (
        <button
          type="button"
          className="space-studio__peek"
          data-testid="space-studio-peek"
          onClick={() => setComposerOpen(true)}
        >
          <span className="space-studio__peek-text">{prompt.trim() || 'Describe the shot…'}</span>
          <span className="space-studio__peek-cta" aria-hidden="true">
            <svg viewBox="0 0 16 16" focusable="false">
              <path d="M8 1.5l1.7 4.8 4.8 1.7-4.8 1.7L8 14.5l-1.7-4.8L1.5 8l4.8-1.7z" fill="currentColor" />
            </svg>
          </span>
        </button>
      )}
      {sheetMode && composerOpen && (
        <button
          type="button"
          className="space-studio__sheet-close"
          aria-label="Close composer"
          data-testid="space-studio-sheet-close"
          onClick={() => setComposerOpen(false)}
        >
          ×
        </button>
      )}
      <section
        className="space-studio__composer"
        aria-labelledby="space-studio-heading"
        ref={composerRef}
      >
        <header className="space-studio__composer-header">
          <div>
            <span className="space-studio__eyebrow">Active Space</span>
            <h2 id="space-studio-heading">Generate in Studio</h2>
          </div>
          <span className="space-studio__space-name">
            {state.spaces.find((space) => space.id === state.activeSpaceId)?.name ?? 'Space'}
          </span>
        </header>

        {dockReferences}
        {dockFrames}

        <form className="space-studio__form" ref={formRef} onSubmit={handleGenerate}>
          <div className="space-studio__tabs" role="group" aria-label="Output type">
            {(['video', 'image'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                className={outputKind === kind ? 'is-active' : undefined}
                aria-pressed={outputKind === kind}
                data-testid={`space-studio-type-${kind}`}
                onClick={() => setOutputType(kind)}
              >
                {kind === 'video' ? 'Video' : 'Image'}
              </button>
            ))}
          </div>

          <div className="space-studio__model-card">
            {heroUrl && (
              <div className="space-studio__model-card-media" aria-hidden="true">
                {heroIsVideo
                  ? <VideoNodePreview sourceUrl={heroUrl} className="space-studio__hero-media" ariaLabel="" />
                  : <img src={heroUrl} alt="" />}
              </div>
            )}
            <div className="space-studio__model-card-body">
              <strong className="space-studio__preset-name">{activePreset?.name ?? 'General'}</strong>
              <span className="space-studio__model-provider">{model?.name ?? 'No compatible models'}</span>
            </div>
            <button
              type="button"
              role="combobox"
              aria-label="Preset"
              aria-expanded={presetPickerOpen}
              aria-haspopup="listbox"
              data-value={presetId}
              className="space-studio__model-change"
              data-testid="space-studio-preset"
              onClick={() => setPresetPickerOpen((open) => !open)}
            >
              Change
            </button>

            {presetPickerOpen && (
              <div className="space-studio__picker" role="listbox" aria-label="Presets">
                <div className="space-studio__picker-list">
                  {kindPresets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      role="option"
                      aria-selected={preset.id === presetId}
                      className={`space-studio__picker-item${preset.id === presetId ? ' is-active' : ''}`}
                      data-testid={`space-studio-preset-${preset.id}`}
                      onClick={() => applyPreset(preset)}
                    >
                      <span className="space-studio__picker-name">{preset.name}</span>
                      {preset.promptSuffix && (
                        <span className="space-studio__picker-badges"><em>{preset.promptSuffix}</em></span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

          </div>

          {outputKind === 'video' && (
            <fieldset className="space-studio__mode">
              <legend>Video guidance</legend>
              <div role="group" aria-label="Video guidance mode">
                <button
                  type="button"
                  className={videoMode === 'frames' ? 'is-active' : undefined}
                  aria-pressed={videoMode === 'frames'}
                  disabled={!supportsFrames && supportsReferences}
                  title={supportsFrames ? undefined : `${model?.name ?? 'This model'} does not take frames`}
                  data-testid="space-studio-video-mode-frames"
                  onClick={() => {
                    setVideoMode('frames');
                    setFormError('');
                  }}
                >
                  Frames
                </button>
                <button
                  type="button"
                  className={videoMode === 'references' ? 'is-active' : undefined}
                  aria-pressed={videoMode === 'references'}
                  disabled={!supportsReferences && supportsFrames}
                  title={supportsReferences ? undefined : `${model?.name ?? 'This model'} does not take references`}
                  data-testid="space-studio-video-mode-references"
                  onClick={() => {
                    setVideoMode('references');
                    setFormError('');
                  }}
                >
                  References
                </button>
              </div>
              <p className="space-studio__hint space-studio__mode-hint">
                {!supportsFrames && supportsReferences
                  ? `${model?.name ?? 'This model'} takes references, not frames.`
                  : !supportsReferences && supportsFrames
                    ? `${model?.name ?? 'This model'} takes frames, not references.`
                    : videoMode === 'frames'
                      ? 'Frames pin the first and last image of the shot.'
                      : 'References keep characters, wardrobe, and props consistent.'}
              </p>
            </fieldset>
          )}

          {outputKind === 'video' && videoMode === 'frames' && supportsFrames && (
            <fieldset className="space-studio__frames">
              <legend className="space-studio__sr-only">Frames</legend>
              <div className="space-studio__slot-row">
                {renderFrameSlot('Start frame', startField, startAssetId, setStartAssetId, 'space-studio-start-frame')}
                {renderFrameSlot('End frame', endField, endAssetId, setEndAssetId, 'space-studio-end-frame')}
              </div>
              {frameSlotTarget && (
                <div className="space-studio__slot-picker" role="dialog" aria-label={`Choose ${frameSlotTarget === 'start' ? 'a start frame' : 'an end frame'}`}>
                  {imageAssets.length === 0 ? (
                    <p className="space-studio__empty-note">
                      Import or generate an image first — it will show up here as a frame.
                    </p>
                  ) : (
                    <div className="space-studio__thumb-row" role="listbox" aria-label="Images">
                      {imageAssets.map((asset) => (
                        <button
                          key={asset.id}
                          type="button"
                          role="option"
                          aria-selected={(frameSlotTarget === 'start' ? startAssetId : endAssetId) === asset.id}
                          className="space-studio__thumb"
                          title={asset.name}
                          data-testid={`space-studio-${frameSlotTarget}-frame-${asset.id}`}
                          onClick={() => {
                            if (frameSlotTarget === 'start') setStartAssetId(asset.id);
                            else setEndAssetId(asset.id);
                            setFrameSlotTarget(null);
                          }}
                        >
                          <img src={assetPreviewUrl(asset)} alt="" />
                          <span>{asset.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </fieldset>
          )}

          <fieldset className="space-studio__elements">
            <legend>
              References <small>{referencesActive ? 'Optional' : 'Available in References mode'}</small>
            </legend>
            {missingReferences > 0 && (
              <p className="space-studio__ref-missing" role="status" data-testid="space-studio-missing-references">
                {missingReferences} reference{missingReferences === 1 ? '' : 's'} from that generation
                {missingReferences === 1 ? ' is' : ' are'} no longer in your Elements library, so
                {missingReferences === 1 ? ' it was' : ' they were'} left out.
                <button type="button" className="space-studio__link-button" onClick={() => setMissingReferences(0)}>
                  Dismiss
                </button>
              </p>
            )}
            {selectedElements.length === 0 && attachedRefs.length === 0 ? (
              <button
                type="button"
                className="space-studio__ref-empty"
                data-testid="space-studio-add-reference"
                disabled={!referencesActive || availableElements.length === 0}
                onClick={() => setElementModalOpen(true)}
              >
                <span className="space-studio__slot-icon" aria-hidden="true">+</span>
                <span>
                  {availableElements.length === 0
                    ? 'Add reference images in Elements first'
                    : 'Add references'}
                </span>
              </button>
            ) : (
              <div className="space-studio__ref-strip">
                {selectedElements.map((element) => {
                  const image = elementImagesForVariation(element)[0];
                  return (
                    <span key={element.id} className="space-studio__ref is-selected" title={element.name}>
                      <img src={toFileUrl(image.url)} alt={element.name} />
                      <button
                        type="button"
                        className="space-studio__ref-remove"
                        aria-label={`Remove ${element.name}`}
                        data-testid={`space-studio-element-${element.id}`}
                        onClick={() => toggleElement(element.id)}
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
                {attachedRefs.map((reference) => (
                  <span key={reference.id} className="space-studio__ref is-selected" title={reference.name}>
                    {reference.kind === 'image' && <img src={toFileUrl(reference.url)} alt={reference.name} />}
                    {reference.kind === 'video' && (
                      // eslint-disable-next-line jsx-a11y/media-has-caption
                      <video
                        src={toFileUrl(reference.url)}
                        muted
                        playsInline
                        preload="metadata"
                        onLoadedMetadata={(event) => primeVideoPoster(event.currentTarget)}
                      />
                    )}
                    {reference.kind === 'audio' && <span className="space-studio__ref-kind">AUD</span>}
                    <button
                      type="button"
                      className="space-studio__ref-remove"
                      aria-label={`Remove ${reference.name}`}
                      data-testid={`space-studio-attached-${reference.id}`}
                      onClick={() => setAttachedRefs((current) => current.filter((entry) => entry.id !== reference.id))}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  className="space-studio__ref space-studio__ref--add"
                  aria-label="Add references"
                  disabled={!referencesActive}
                  onClick={() => setElementModalOpen(true)}
                >
                  +
                </button>
              </div>
            )}
          </fieldset>

          <div className="space-studio__field space-studio__field--prompt">
            <div className="space-studio__field-head">
              <label className="space-studio__field-label" htmlFor="space-studio-prompt">Prompt</label>
              <span className="space-studio__hint">
                {promptWords > 0 ? `${promptWords} ${promptWords === 1 ? 'word' : 'words'} · ` : ''}
                <span className="space-studio__hint-shortcut">⌘↵ to generate</span>
              </span>
            </div>
            <div className="space-studio__prompt-box">
              <div className="space-studio__prompt-highlight" aria-hidden="true" ref={highlightRef}>
                {splitPromptMentions(prompt, availableElements.map((element) => element.name))
                  .map((part, index) => (
                    part.mention
                      ? <mark key={index}>{part.text}</mark>
                      : <span key={index}>{part.text}</span>
                  ))}
                {'\n'}
              </div>
            <textarea
              id="space-studio-prompt"
              data-testid="space-studio-prompt"
              ref={promptRef}
              value={prompt}
              rows={4}
              placeholder={outputKind === 'video'
                ? 'Describe the shot, action, camera, lighting, and mood… type @ for a reference'
                : 'Describe the image, composition, lighting, and style… type @ for a reference'}
              onChange={(event) => {
                setPrompt(event.target.value);
                syncMention(event.target.value, event.target.selectionStart ?? 0);
              }}
              onKeyDown={handlePromptKeyDown}
              onBlur={() => window.setTimeout(() => setMentionQuery(null), 120)}
              onScroll={(event) => {
                if (highlightRef.current) {
                  highlightRef.current.scrollTop = event.currentTarget.scrollTop;
                }
              }}
            />
            </div>
            {mentionQuery !== null && mentionMatches.length > 0 && (
              <ul className="space-studio__mentions" role="listbox" aria-label="Elements">
                {mentionMatches.map((element, index) => {
                  const image = elementImagesForVariation(element)[0];
                  return (
                    <li key={element.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={index === mentionIndex}
                        className={index === mentionIndex ? 'is-active' : undefined}
                        data-testid={`space-studio-mention-${element.id}`}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => insertMention(element)}
                      >
                        {image && <img src={toFileUrl(image.url)} alt="" />}
                        <span>{mentionToken(element.name)}</span>
                        <em>{element.type}</em>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {activePreset?.promptSuffix && (
              <p className="space-studio__prompt-ghost" data-testid="space-studio-preset-ghost">
                <span>{activePreset.name}</span>
                {activePreset.promptSuffix}
              </p>
            )}
            {!dockMode && promptChips && (
              <div className="space-studio__prompt-chips">
                {promptChips}
              </div>
            )}
          </div>

          <input
            ref={attachInputRef}
            type="file"
            accept="image/*,video/*,audio/*"
            hidden
            data-testid="space-studio-attach-input"
            multiple
            onChange={(event) => {
              const target = attachTargetRef.current;
              const files = Array.from(event.target.files ?? []);
              void (async () => {
                // A frame slot takes exactly one file; a reference set takes many.
                for (const file of target ? files.slice(0, 1) : files) {
                  await attachLocalFile(file, target);
                }
              })();
              attachTargetRef.current = null;
              event.target.value = '';
            }}
          />
          <div
            className="space-studio__tools"
            ref={toolsRef}
            onScroll={() => {
              measureTools();
              // A fixed menu cannot follow its trigger out of view.
              setRowOpen(null);
              setSliderOpen(null);
              setDockModeMenuOpen(false);
            }}
          >
            {dockTools}
          <div className="space-studio__setting-row-wrap">
            <button
              type="button"
              role="combobox"
              aria-label="Model"
              aria-expanded={modelPickerOpen}
              aria-haspopup="listbox"
              data-value={modelType}
              className="space-studio__setting-row space-studio__setting-row--model"
              data-testid="space-studio-model"
              onClick={(event) => {
                flyoutAnchorRef.current = event.currentTarget;
                setModelPickerOpen((open) => !open);
                setModelSearch('');
              }}
            >
              <span>Model</span>
              <em>{model?.name ?? 'None'}</em>
              <i aria-hidden="true">›</i>
            </button>
          </div>

          {(controls.length > 0 || rowControls.length > 0) && (
            <fieldset className="space-studio__controls">
              <legend className="space-studio__sr-only">Model controls</legend>
              <div className="space-studio__pill-row">
                {controls.map((field) => {
                  const value = controlValue(controlValuesByModel[modelType], field);
                  const inputId = `space-studio-control-${field.id}`;
                  if (field.fieldType === 'toggle') {
                    return (
                      <label key={field.id} className="space-studio__pill space-studio__pill--toggle" htmlFor={inputId}>
                        {pillIcon(field)}
                        <span>{controlPillLabel(field)}</span>
                        <input
                          id={inputId}
                          data-testid={inputId}
                          type="checkbox"
                          checked={Boolean(value)}
                          onChange={(event) => setControl(field, event.target.checked)}
                        />
                      </label>
                    );
                  }
                  if (isSliderControl(field)) {
                    const values = (field.options ?? []).map((option) => Number(option.value));
                    const index = Math.max(0, values.findIndex((entry) => String(entry) === String(value)));
                    return (
                      <div key={field.id} className="space-studio__pill space-studio__pill--slider">
                        <button
                          type="button"
                          className="space-studio__pill-trigger"
                          aria-expanded={sliderOpen === field.id}
                          aria-haspopup="dialog"
                          data-testid={`${inputId}-trigger`}
                          onClick={(event) => {
                            // Wider than a menu: the stop grid needs the room, and
                            // pinning it to the pill left every value but the ends
                            // a two-pixel drag target.
                            anchorRowMenu(event.currentTarget, 300);
                            setRowOpen(null);
                            setDockModeMenuOpen(false);
                            setSliderOpen((current) => (current === field.id ? null : field.id));
                          }}
                        >
                          {pillIcon(field)}
                          <span className="space-studio__sr-only">{controlPillLabel(field)}</span>
                          {controlOptionLabel(field, String(value))}
                        </button>
                        {sliderOpen === field.id && (
                          <div className="space-studio__slider-pop" role="dialog" aria-label={`Choose ${controlPillLabel(field).toLowerCase()}`} style={dockMenuStyle}>
                            <div className="space-studio__slider-head">
                              <span>Choose {controlPillLabel(field).toLowerCase()}</span>
                              <strong>{controlOptionLabel(field, String(value))}</strong>
                            </div>
                            <div className="space-studio__slider-row">
                              <button
                                type="button"
                                className="space-studio__slider-step"
                                aria-label={`One step shorter`}
                                data-testid={`${inputId}-down`}
                                disabled={index <= 0}
                                onClick={() => setControl(field, String(values[index - 1]))}
                              >
                                −
                              </button>
                              <input
                                id={inputId}
                                data-testid={inputId}
                                type="range"
                                aria-label={controlPillLabel(field)}
                                min={0}
                                max={values.length - 1}
                                step={1}
                                value={index}
                                onChange={(event) => {
                                  const next = values[Number(event.target.value)];
                                  if (next !== undefined) setControl(field, String(next));
                                }}
                              />
                              <button
                                type="button"
                                className="space-studio__slider-step"
                                aria-label={`One step longer`}
                                data-testid={`${inputId}-up`}
                                disabled={index >= values.length - 1}
                                onClick={() => setControl(field, String(values[index + 1]))}
                              >
                                +
                              </button>
                            </div>
                            {/* Every stop the model actually accepts, so a value in
                                the middle of the range is one tap rather than a
                                pixel-perfect drag. */}
                            <div className="space-studio__slider-stops" data-testid={`${inputId}-stops`}>
                              {values.map((entry, entryIndex) => (
                                <button
                                  key={entry}
                                  type="button"
                                  aria-pressed={entryIndex === index}
                                  className={entryIndex === index ? 'is-on' : undefined}
                                  onClick={() => setControl(field, String(entry))}
                                >
                                  {controlOptionLabel(field, String(entry))}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  }
                  if (field.fieldType === 'select') {
                    // A native <select> renders the OS menu — light chrome that
                    // cannot be themed and looks foreign in a dark composer.
                    const active = field.options?.find((option) => String(option.value) === String(value));
                    return (
                      <div key={field.id} className="space-studio__pill space-studio__pill--select">
                        <button
                          type="button"
                          role="combobox"
                          aria-label={controlPillLabel(field)}
                          aria-expanded={rowOpen === field.id}
                          aria-haspopup="listbox"
                          data-value={String(value)}
                          className="space-studio__pill-trigger"
                          data-testid={inputId}
                          onClick={(event) => {
                            anchorRowMenu(event.currentTarget);
                            setSliderOpen(null);
                            setDockModeMenuOpen(false);
                            setRowOpen((current) => (current === field.id ? null : field.id));
                          }}
                        >
                          {pillIcon(field)}
                          {controlOptionLabel(field, active?.label ?? String(value))}
                        </button>
                        {rowOpen === field.id && (
                          <ul
                            className="space-studio__pill-menu"
                            role="listbox"
                            aria-label={controlPillLabel(field)}
                            style={dockMenuStyle}
                          >
                            {field.options?.map((option) => {
                              const selected = String(option.value) === String(value);
                              return (
                                <li key={option.value}>
                                  <button
                                    type="button"
                                    role="option"
                                    aria-selected={selected}
                                    className={selected ? 'is-active' : undefined}
                                    data-testid={`${inputId}-${option.value}`}
                                    onClick={() => {
                                      setControl(field, option.value);
                                      setRowOpen(null);
                                    }}
                                  >
                                    {controlOptionLabel(field, option.label)}
                                    {selected && <b aria-hidden="true">✓</b>}
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    );
                  }
                  return (
                    <label key={field.id} className="space-studio__pill" htmlFor={inputId}>
                      {pillIcon(field)}
                      <span>{controlPillLabel(field)}{field.fieldType === 'range' ? `: ${value}` : ''}</span>
                      <input
                        id={inputId}
                        data-testid={inputId}
                        type={field.fieldType === 'range' ? 'range' : 'number'}
                        value={typeof value === 'boolean' ? Number(value) : value}
                        min={field.min}
                        max={field.max}
                        step={field.step}
                        required={field.required}
                        onChange={(event) => setControl(field, Number(event.target.value))}
                      />
                    </label>
                  );
                })}
              </div>
              {rowControls.length > 0 && (
                <div className="space-studio__setting-rows">
                  {rowControls.map((field) => {
                    const value = controlValue(controlValuesByModel[modelType], field);
                    const inputId = `space-studio-control-${field.id}`;
                    if (field.fieldType !== 'select') {
                      return (
                        <label key={field.id} className="space-studio__setting-row" htmlFor={inputId}>
                          {pillIcon(field)}
                          <span>{controlPillLabel(field)}</span>
                          <input
                            id={inputId}
                            data-testid={inputId}
                            type={field.fieldType === 'range' ? 'range' : 'number'}
                            value={typeof value === 'boolean' ? Number(value) : value}
                            min={field.min}
                            max={field.max}
                            step={field.step}
                            onChange={(event) => setControl(field, Number(event.target.value))}
                          />
                        </label>
                      );
                    }
                    const active = field.options?.find((option) => String(option.value) === String(value));
                    return (
                      <div key={field.id} className="space-studio__setting-row-wrap">
                        <button
                          type="button"
                          className="space-studio__setting-row"
                          aria-haspopup="listbox"
                          aria-expanded={rowOpen === field.id}
                          aria-label={controlPillLabel(field)}
                          data-testid={`${inputId}-trigger`}
                          onClick={(event) => {
                            anchorRowMenu(event.currentTarget);
                            setSliderOpen(null);
                            setDockModeMenuOpen(false);
                            setRowOpen((current) => (current === field.id ? null : field.id));
                          }}
                        >
                          {field.id === 'bitrate' ? bitrateIcon(String(value)) : pillIcon(field)}
                          <span>{controlPillLabel(field)}</span>
                          <em>{controlOptionLabel(field, active?.label ?? String(value))}</em>
                          <i aria-hidden="true">›</i>
                        </button>
                        {rowOpen === field.id && (
                          <ul
                            className="space-studio__option-flyout"
                            role="listbox"
                            aria-label={controlPillLabel(field)}
                            data-testid={inputId}
                            style={dockMenuStyle}
                          >
                            {field.options?.map((option) => {
                              const selected = String(option.value) === String(value);
                              return (
                                <li key={option.value}>
                                  <button
                                    type="button"
                                    role="option"
                                    aria-selected={selected}
                                    className={selected ? 'is-active' : undefined}
                                    onClick={() => {
                                      setControl(field, option.value);
                                      setRowOpen(null);
                                    }}
                                  >
                                    {field.id === 'bitrate' && bitrateIcon(String(option.value))}
                                    <span>{controlOptionLabel(field, option.label)}</span>
                                    {option.description && <small>{option.description}</small>}
                                    {selected && <b aria-hidden="true">✓</b>}
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </fieldset>
          )}

            <div className="space-studio__batch" role="group" aria-label="Versions">
              <span className="space-studio__batch-label">Versions</span>
              <button type="button" aria-label="Fewer versions" disabled={batchCount <= 1} onClick={() => setBatchCount((count) => Math.max(1, count - 1))}>−</button>
              <span className="space-studio__batch-count" data-testid="space-studio-batch" aria-live="polite">{batchCount}/{MAX_BATCH}</span>
              <button type="button" aria-label="More versions" disabled={batchCount >= MAX_BATCH} onClick={() => setBatchCount((count) => Math.min(MAX_BATCH, count + 1))}>+</button>
            </div>
          </div>
          {dockMode && toolsEdges.left && (
            <button type="button" className="space-studio__tools-nav space-studio__tools-nav--left" aria-label="Scroll settings left" onClick={() => toolsRef.current?.scrollBy({ left: -220, behavior: 'smooth' })}>‹</button>
          )}
          {dockMode && toolsEdges.right && (
            <button type="button" className="space-studio__tools-nav space-studio__tools-nav--right" aria-label="Scroll settings right" onClick={() => toolsRef.current?.scrollBy({ left: 220, behavior: 'smooth' })}>›</button>
          )}

          <div className="space-studio__submit">
            {formError && <p className="space-studio__form-error" role="alert">{formError}</p>}
            <button
              className="space-studio__generate"
              type="submit"
              data-testid="space-studio-generate"
              disabled={isLaunching || !prompt.trim() || !modelType}
            >
              {isLaunching ? 'Starting…' : dockMode ? (batchCount > 1 ? `Generate ×${batchCount}` : 'Generate') : `Generate ${batchCount > 1 ? `${batchCount} ${outputKind}s` : outputKind}`}
              {!isLaunching && creditEstimate !== null && (
                <span className="space-studio__generate-cost">
                  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                    <path d="M8 1.5l1.7 4.8 4.8 1.7-4.8 1.7L8 14.5l-1.7-4.8L1.5 8l4.8-1.7z" fill="currentColor" />
                  </svg>
                  {creditEstimate}
                </span>
              )}
            </button>
          </div>
        </form>

        {modelPickerOpen && (
          <div
            className="space-studio__flyout"
            role="dialog"
            aria-label="Choose a model"
            ref={flyoutRef}
            style={flyoutStyle
              ? { top: flyoutStyle.top ?? 'auto', bottom: flyoutStyle.bottom ?? 'auto', left: flyoutStyle.left, width: flyoutStyle.width }
              : undefined}
          >
            <div className="space-studio__picker space-studio__picker--panel">
                <div className="space-studio__picker-search-wrap">
                  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                    <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                <input
                  type="search"
                  className="space-studio__picker-search"
                  placeholder="Search models…"
                  aria-label="Search models"
                  value={modelSearch}
                  autoFocus={!coarsePointer}
                  onChange={(event) => setModelSearch(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Escape') setModelPickerOpen(false); }}
                />
                <button
                  type="button"
                  className="space-studio__picker-close"
                  aria-label="Close model picker"
                  onClick={() => setModelPickerOpen(false)}
                >
                  ×
                </button>
                </div>
                <div className="space-studio__picker-list" role="listbox" aria-label="Models">
                  {filteredModels.length === 0 && (
                    <p className="space-studio__empty-note">No model matches that search.</p>
                  )}
                  {filteredModels.map(([provider, entries]) => (
                    <div key={provider} className="space-studio__picker-group">
                      <h4>
                        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                          <path d="M8 1.8l1.5 4.2 4.2 1.5-4.2 1.5L8 13.2l-1.5-4.2L2.3 7.5l4.2-1.5z" fill="currentColor" />
                        </svg>
                        {provider}
                      </h4>
                      {entries.map((entry) => {
                        const entryModel = getModelDefinition(entry.key);
                        return (
                          <button
                            key={entry.key}
                            type="button"
                            role="option"
                            aria-selected={entry.key === modelType}
                            className={`space-studio__picker-item${entry.key === modelType ? ' is-active' : ''}`}
                            data-testid={`space-studio-model-option-${entry.key}`}
                            onClick={() => {
                              setModelType(entry.key);
                              setModelPickerOpen(false);
                              setFormError('');
                            }}
                          >
                            <span className="space-studio__picker-icon" aria-hidden="true">
                              <svg viewBox="0 0 16 16">
                                <rect x="2.5" y="8" width="2.6" height="5.5" rx="1" fill="currentColor" />
                                <rect x="6.7" y="4.5" width="2.6" height="9" rx="1" fill="currentColor" />
                                <rect x="10.9" y="6.5" width="2.6" height="7" rx="1" fill="currentColor" />
                              </svg>
                            </span>
                            <span className="space-studio__picker-name">{entry.name}</span>
                            {entryModel && (
                              <span className="space-studio__picker-badges">
                                {modelCapabilitySummary(entryModel).map((badge) => (
                                  <em key={badge.label}>
                                    {badge.kind !== 'tag' && (
                                      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                                        {badge.kind === 'resolution'
                                          ? <path d="M8 2.4l5 3.2L8 13.4 3 5.6z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                                          : <>
                                              <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
                                              <path d="M8 5v3l2 1.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                                            </>}
                                      </svg>
                                    )}
                                    {badge.label}
                                  </em>
                                ))}
                              </span>
                            )}
                            {entry.key === modelType && (
                              <b className="space-studio__picker-check" aria-hidden="true">✓</b>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
            </div>
          </div>
        )}

        {elementModalOpen && (
          // A flyout docked beside the composer rather than a modal over the app:
          // the composer stays readable and editable while you pick.
          <div
            className="space-studio__flyout"
            role="dialog"
            aria-label="Choose references"
            data-testid="space-studio-element-modal"
            ref={flyoutRef}
            style={flyoutStyle
              ? { top: flyoutStyle.top ?? 'auto', bottom: flyoutStyle.bottom ?? 'auto', left: flyoutStyle.left, width: flyoutStyle.width }
              : undefined}
            onKeyDown={(event) => { if (event.key === 'Escape') setElementModalOpen(false); }}
          >
            <div className="space-studio__modal">
              <header className="space-studio__modal-head">
                <h3>Elements</h3>
                <input
                  type="search"
                  aria-label="Search elements"
                  placeholder="Search…"
                  value={elementSearch}
                  autoFocus={!coarsePointer}
                  onChange={(event) => setElementSearch(event.target.value)}
                />
                <button
                  type="button"
                  aria-label="Close"
                  className="space-studio__modal-close"
                  onClick={() => setElementModalOpen(false)}
                >
                  ×
                </button>
              </header>

              <div className="space-studio__modal-grid">
                {modalElements.length === 0 && (
                  <p className="space-studio__empty-note">
                    {availableElements.length === 0
                      ? 'Add reference images in Elements to use them here.'
                      : 'No element matches that search.'}
                  </p>
                )}
                {modalElements.map((element) => {
                  const image = elementImagesForVariation(element)[0];
                  const checked = selectedElementIds.includes(element.id);
                  return (
                    <button
                      key={element.id}
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      className={`space-studio__modal-item${checked ? ' is-selected' : ''}`}
                      data-testid={`space-studio-modal-element-${element.id}`}
                      onClick={() => toggleElement(element.id)}
                    >
                      <img src={toFileUrl(image.url)} alt="" />
                      <strong>{mentionToken(element.name)}</strong>
                      <em>{element.type}</em>
                    </button>
                  );
                })}
              </div>

              <footer className="space-studio__modal-foot">
                <span className="space-studio__hint">
                  {selectedElementCount} selected
                </span>
                <button
                  type="button"
                  className="space-studio__modal-done"
                  onClick={() => setElementModalOpen(false)}
                >
                  Done
                </button>
              </footer>
            </div>
          </div>
        )}
      </section>

      <section className="space-studio__feed" data-testid="space-studio-feed" aria-labelledby="space-studio-feed-heading">
        <header className="space-studio__feed-header">
          <div>
            <span className="space-studio__eyebrow">Generations</span>
            <h2 id="space-studio-feed-heading">Space feed</h2>
          </div>
          <div className="space-studio__feed-controls">
            <div className="space-studio__seg space-studio__seg--tabs" role="group" aria-label="Filter generations">
              {(['all', 'video', 'image', 'liked'] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  aria-pressed={feedFilter === filter}
                  className={feedFilter === filter ? 'is-active' : undefined}
                  data-testid={`space-studio-filter-${filter}`}
                  onClick={() => setFeedFilter(filter)}
                >
                  {filter[0].toUpperCase() + filter.slice(1)}
                </button>
              ))}
            </div>

            <span className="space-studio__seg-divider" aria-hidden="true" />

            {feedView === 'grid' && (
              <div className="space-studio__seg space-studio__seg--track space-studio__card-size" role="group" aria-label="Card size">
                {(['s', 'm', 'l'] as const).map((size) => (
                  <button
                    key={size}
                    type="button"
                    aria-pressed={cardSize === size}
                    aria-label={`${CARD_SIZE_LABELS[size]} cards`}
                    className={cardSize === size ? 'is-active' : undefined}
                    onClick={() => { setCardSize(size); writeCardSize(size); }}
                  >
                    {size.toUpperCase()}
                  </button>
                ))}
              </div>
            )}

            <div className="space-studio__seg space-studio__seg--track space-studio__seg--icons" role="group" aria-label="Feed layout">
              {(['list', 'grid'] as const).map((view) => (
                <button
                  key={view}
                  type="button"
                  aria-pressed={feedView === view}
                  aria-label={view === 'list' ? 'List view' : 'Grid view'}
                  className={feedView === view ? 'is-active' : undefined}
                  data-testid={`space-studio-view-${view}`}
                  onClick={() => setFeedView(view)}
                >
                  {view === 'list' ? VIEW_ICONS.list : VIEW_ICONS.grid}
                </button>
              ))}
            </div>
          </div>
        </header>

        {feedNotice && (
          <p className={`space-studio__feed-notice${feedNotice.kind === 'error' ? ' is-error' : ''}`} role="status">
            {feedNotice.text}
          </p>
        )}

        {feedView === 'grid' && feedItems.length > 0 && (
          <StudioClipGrid
            items={clipItems}
            cardSize={cardSize}
            onOpen={openClip}
            onLike={toggleLike}
            onDownload={downloadClip}
            onRecreate={recreateClip}
            onReference={(id) => { void referenceClip(id); }}
            onExtractFrame={(id, at) => { void extractFrame(id, at); }}
            onOpenInCanvas={onOpenInCanvas ? (id) => { setViewerId(null); onOpenInCanvas(id); } : undefined}
            onCopyPrompt={(id) => { void copyPromptOf(id); }}
            onCopyUrl={(id) => { void copyUrlOf(id); }}
            onRemove={removeClip}
            onReview={setReview}
            selectedIds={selectedClipIds}
            onToggleSelect={toggleSelectClip}
          />
        )}

        {selectedClips.length > 0 && (
          <StudioSelectionBar
            count={selectedClips.length}
            previewUrl={selectedClips[0].url || undefined}
            previewKind={selectedClips[0].kind}
            allLiked={allSelectedLiked}
            onDownload={downloadSelected}
            onLike={likeSelected}
            onRemove={() => removeClips(selectedClipIds)}
            onCopyPrompts={() => { void copySelectedPrompts(); }}
            onReview={reviewSelected}
            onOpenInCanvas={onOpenInCanvas && selectedClips.length === 1 ? () => onOpenInCanvas(selectedClips[0].id) : undefined}
            onClear={clearSelection}
          />
        )}

        {viewerItem && (
          <StudioClipViewer
            item={viewerItem}
            index={viewerIndex}
            count={clipItems.length}
            spaceName={activeSpaceName}
            author="You"
            onClose={() => setViewerId(null)}
            onNavigate={navigateViewer}
            onLike={() => toggleLike(viewerItem.id)}
            onDownload={() => downloadClip(viewerItem.id)}
            onRecreate={() => recreateClip(viewerItem.id)}
            onReference={() => { void referenceClip(viewerItem.id); }}
            onExtend={() => { void extendClip(viewerItem.id); }}
            onExtractFrame={(at) => { void extractFrame(viewerItem.id, at); }}
            onOpenInCanvas={onOpenInCanvas ? () => { setViewerId(null); onOpenInCanvas(viewerItem.id); } : undefined}
            onCopyPrompt={() => copyPromptOf(viewerItem.id)}
            onCopyUrl={() => { void copyUrlOf(viewerItem.id); }}
            onRemove={() => removeClip(viewerItem.id)}
            onReview={(status) => setReview(viewerItem.id, status)}
            onAddComment={(text, timeSec) => addComment(viewerItem.id, text, timeSec)}
          />
        )}

        <div className="space-studio__feed-list" hidden={feedView === 'grid' && feedItems.length > 0}>
          {feedItems.map(({ node, model: feedModel }) => (
            <StudioFeedItem
              key={node.id}
              node={node}
              model={feedModel}
              prompt={feedPromptFor(node, feedModel, state.nodes, state.edges)}
              settings={feedSettingsFor(node, feedModel)}
              elements={feedElementsFor(node, feedModel, state.nodes, state.edges, state.elements)}
              running={state.runningNodeIds.has(node.id)}
              onRetry={() => runNode(node.id, state.nodes, state.edges)}
              onReuse={() => reuseGeneration(node, feedModel)}
              onOpenSettings={() => dispatch({ type: 'SET_TAB', tab: 'settings' })}
              onOpenInCanvas={onOpenInCanvas ? () => onOpenInCanvas(node.id) : undefined}
            />
          ))}
          {feedItems.length === 0 && (
            <div className="space-studio__feed-empty">
              <h3>No {feedFilter === 'all' ? '' : `${feedFilter} `}generations yet</h3>
              <p>Your results will appear here without leaving this Space.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
