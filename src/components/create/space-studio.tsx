import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import type { Edge, Node } from '@xyflow/react';
import { useWorkspace } from '@/components/workspace/workspace-shell';
import { VideoNodePreview } from '@/components/create/nodes/video-node-preview';
import { useTopviewModelCatalogVersion } from '@/components/create/use-topview-model-catalog';
import { getModelDefinition } from '@/lib/fal/models';
import { elementImagesForVariation } from '@/lib/elements/variations';
import { createWorkflowNodeFromSpec } from '@/lib/llm/space-node-factory';
import {
  modelProviderLabel,
  providerModelOptions,
  type ProviderModelOption,
} from '@/lib/workflows/provider-model-options';
import { executeFromNode, type WorkflowDispatch } from '@/lib/workflows/execute';
import { generateId, timestamp } from '@/lib/utils/ids';
import { toFileUrl } from '@/lib/utils/file-url';
import type { Asset } from '@/types/project';
import type {
  ModelDefinition,
  ModelInputField,
  WorkflowNodeData,
} from '@/types/workflow';

type OutputKind = 'image' | 'video';
type VideoInputMode = 'frames' | 'references';
type FeedFilter = 'all' | OutputKind;
type ControlValue = string | number | boolean;

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

function isPromptField(field: ModelInputField): boolean {
  return field.fieldType === 'port'
    && field.portType === 'text'
    && /prompt|text/i.test(`${field.id} ${field.falParam} ${field.label}`);
}

function promptFieldFor(model: ModelDefinition): ModelInputField | undefined {
  return model.inputs.find((field) => isPromptField(field) && field.id === 'prompt')
    ?? model.inputs.find(isPromptField);
}

function isImageField(field: ModelInputField): boolean {
  if (field.fieldType !== 'port' && field.fieldType !== 'element-list') return false;
  if (field.portType === 'image') return true;
  if (field.portType !== 'media') return false;
  return field.mediaRole === 'image'
    || field.mediaRole === 'start_image'
    || field.mediaRole === 'end_image'
    || /image|frame|photo|reference/i.test(`${field.id} ${field.falParam} ${field.label}`);
}

function isExplicitStartField(field: ModelInputField): boolean {
  if (!isImageField(field)) return false;
  if (field.mediaRole === 'start_image') return true;
  return /(^|[_\s-])(start|first)([_\s-]|$)/i.test(`${field.id} ${field.falParam} ${field.label}`);
}

function isExplicitEndField(field: ModelInputField): boolean {
  if (!isImageField(field)) return false;
  if (field.mediaRole === 'end_image') return true;
  return /(^|[_\s-])(end|last)([_\s-]|$)/i.test(`${field.id} ${field.falParam} ${field.label}`);
}

function startFieldFor(model: ModelDefinition): ModelInputField | undefined {
  const imageFields = model.inputs.filter(isImageField);
  return imageFields.find((field) => field.mediaRole === 'start_image')
    ?? imageFields.find(isExplicitStartField)
    ?? imageFields.find((field) => (
      field.fieldType === 'port'
      && field.mediaRole !== 'end_image'
      && /^(image|image_url|image_input|init_image|source_image)$/i.test(field.id)
    ));
}

function endFieldFor(model: ModelDefinition): ModelInputField | undefined {
  const imageFields = model.inputs.filter(isImageField);
  return imageFields.find((field) => field.mediaRole === 'end_image')
    ?? imageFields.find(isExplicitEndField);
}

function referenceFieldFor(model: ModelDefinition): ModelInputField | undefined {
  const imageFields = model.inputs.filter((field) => (
    isImageField(field) && !isExplicitStartField(field) && !isExplicitEndField(field)
  ));
  return imageFields.find((field) => field.fieldType === 'element-list')
    ?? imageFields.find((field) => field.mediaRole === 'image' && field.multiple)
    ?? imageFields.find((field) => field.multiple)
    ?? imageFields.find((field) => field.mediaRole === 'image')
    ?? imageFields[0];
}

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

function makeEdge(
  source: Node<WorkflowNodeData>,
  target: Node<WorkflowNodeData>,
  sourceHandle: string,
  targetHandle: string,
  sourcePortType: string,
): Edge {
  return {
    id: generateId(),
    source: source.id,
    target: target.id,
    sourceHandle,
    targetHandle,
    type: 'animated',
    data: { sourcePortType },
  };
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

interface StudioFeedItemProps {
  node: Node<WorkflowNodeData>;
  model: ModelDefinition;
  running: boolean;
  onRetry: () => void;
}

function StudioFeedItem({ node, model, running, onRetry }: StudioFeedItemProps) {
  const urls = generationUrls(node);
  const preferredIndex = typeof node.data.activeGeneration === 'number'
    ? node.data.activeGeneration
    : Math.max(0, urls.length - 1);
  const [activeIndex, setActiveIndex] = useState(() => (
    Math.min(Math.max(0, preferredIndex), Math.max(0, urls.length - 1))
  ));
  const [mediaError, setMediaError] = useState(false);
  const status = running ? 'running' : node.data.result?.status ?? (urls.length > 0 ? 'complete' : 'idle');
  const isPending = status === 'running' || (status === 'idle' && Boolean(node.data.config.__studioGenerated));
  const activeUrl = urls[Math.min(activeIndex, Math.max(0, urls.length - 1))];
  const progress = Math.max(0, Math.min(100, node.data.result?.progress ?? 5));
  const createdAt = node.data.config.__studioCreatedAt;
  const prompt = typeof node.data.config.__studioPrompt === 'string'
    ? node.data.config.__studioPrompt
    : '';

  useEffect(() => {
    const nextIndex = Math.min(Math.max(0, preferredIndex), Math.max(0, urls.length - 1));
    setActiveIndex(nextIndex);
    setMediaError(false);
  }, [preferredIndex, urls.length]);

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

  return (
    <article
      className={`space-studio__feed-item space-studio__feed-item--${model.outputType}`}
      data-testid={`space-studio-feed-item-${node.id}`}
      aria-label={`${model.name} generation`}
    >
      <header className="space-studio__feed-item-header">
        <div>
          <span className="space-studio__feed-kind">{model.outputType}</span>
          <h3>{model.name}</h3>
          <span className="space-studio__feed-provider">{modelProviderLabel(model)}</span>
        </div>
        {typeof createdAt === 'string' && (
          <time dateTime={createdAt}>{new Date(createdAt).toLocaleString()}</time>
        )}
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
              {node.data.result?.progressMessage || 'Generating…'}
            </span>
            <span className="space-studio__pending-value">{Math.round(progress)}%</span>
            <span className="space-studio__progress" aria-hidden="true">
              <span style={{ width: `${progress}%` }} />
            </span>
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

      {prompt && <p className="space-studio__feed-prompt">{prompt}</p>}

      {status === 'error' && (
        <div className="space-studio__feed-error" role="alert">
          <p>{node.data.result?.error || 'Generation failed.'}</p>
          <button
            type="button"
            onClick={onRetry}
            data-testid={`space-studio-retry-${node.id}`}
          >
            Retry
          </button>
        </div>
      )}
    </article>
  );
}

export function SpaceStudio() {
  const { state, dispatch } = useWorkspace();
  const catalogVersion = useTopviewModelCatalogVersion();
  const [outputKind, setOutputKind] = useState<OutputKind>('video');
  const [videoMode, setVideoMode] = useState<VideoInputMode>('frames');
  const [prompt, setPrompt] = useState('');
  const [modelType, setModelType] = useState('');
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]);
  const [startAssetId, setStartAssetId] = useState('');
  const [endAssetId, setEndAssetId] = useState('');
  const [controlValuesByModel, setControlValuesByModel] = useState<
    Record<string, Record<string, ControlValue>>
  >({});
  const [feedFilter, setFeedFilter] = useState<FeedFilter>('all');
  const [formError, setFormError] = useState('');
  const [isLaunching, setIsLaunching] = useState(false);
  const launchLockRef = useRef(false);

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

  useEffect(() => {
    if (modelOptions.some((option) => option.key === modelType)) return;
    setModelType(modelOptions[0]?.key ?? '');
  }, [modelOptions, modelType]);

  const model = modelType ? getModelDefinition(modelType) : undefined;
  const controls = useMemo(() => orderedControlFields(model), [model]);
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

  useEffect(() => {
    if (!startField) setStartAssetId('');
    if (!endField) setEndAssetId('');
  }, [endField, startField]);

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
    setSelectedElementIds((current) => (
      current.includes(elementId)
        ? current.filter((id) => id !== elementId)
        : [...current, elementId]
    ));
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
    const referenceField = referenceFieldFor(selectedModel);
    if (elementIds.length > 0 && !referenceField) {
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
    if (elementIds.length > 0 && referenceField) connectedFields.add(referenceField.id);
    if (outputKind === 'video' && videoMode === 'frames') {
      if (selectedStartAsset && selectedStartField) connectedFields.add(selectedStartField.id);
      if (selectedEndAsset && selectedEndField) connectedFields.add(selectedEndField.id);
    }

    const currentControlValues = controlValuesByModel[modelType];
    const modelConfig: Record<string, unknown> = {
      __studioGenerated: true,
      __studioCreatedAt: timestamp(),
      __studioOutputType: outputKind,
      __studioVideoMode: outputKind === 'video' ? videoMode : undefined,
      __studioPrompt: trimmedPrompt,
      __studioElementIds: elementIds,
      __studioStartAssetId: selectedStartAsset?.id,
      __studioEndAssetId: selectedEndAsset?.id,
    };
    for (const field of orderedControlFields(selectedModel)) {
      const value = controlValue(currentControlValues, field);
      if (value !== '') modelConfig[field.id] = value;
    }
    if (referenceField?.fieldType === 'element-list' && elementIds.length > 0) {
      modelConfig._elementCount = 1;
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

    const maxY = state.nodes.reduce((highest, node) => Math.max(highest, node.position.y), 80);
    const baseY = state.nodes.length === 0 ? 80 : maxY + 340;
    const sourceNodes: Node<WorkflowNodeData>[] = [];
    const nextEdges: Edge[] = [...state.edges];
    const modelNode = createWorkflowNodeFromSpec({
      nodeType: selectedModel.nodeType,
      label: selectedModel.name,
      config: modelConfig,
    }, { x: 520, y: baseY });

    const promptNode = createWorkflowNodeFromSpec({
      nodeType: 'prompt',
      label: 'Studio Prompt',
      config: {
        prompt: trimmedPrompt,
        __studioGenerated: true,
        __studioCreatedAt: modelConfig.__studioCreatedAt,
      },
    }, { x: 80, y: baseY });
    sourceNodes.push(promptNode);
    nextEdges.push(makeEdge(promptNode, modelNode, 'text', promptField.id, 'text'));

    if (elementIds.length > 0 && referenceField) {
      const variationIds = Object.fromEntries(
        availableElements
          .filter((element) => elementIds.includes(element.id) && element.activeVariationId)
          .map((element) => [element.id, element.activeVariationId as string]),
      );
      const elementNode = createWorkflowNodeFromSpec({
        nodeType: 'element',
        label: elementIds.length === 1 ? 'Studio Element' : 'Studio Elements',
        config: {
          elementIds,
          elementVariationIds: variationIds,
          __studioGenerated: true,
          __studioCreatedAt: modelConfig.__studioCreatedAt,
        },
      }, { x: 80, y: baseY + 100 });
      sourceNodes.push(elementNode);
      nextEdges.push(makeEdge(
        elementNode,
        modelNode,
        'element',
        referenceField.fieldType === 'element-list' ? `${referenceField.id}_0` : referenceField.id,
        'image',
      ));
    }

    const addFrameNode = (asset: Asset, field: ModelInputField, role: 'start' | 'end', offset: number) => {
      const sourceUrl = toFileUrl(asset.fileRef || asset.url);
      const frameNode = createWorkflowNodeFromSpec({
        nodeType: 'filePicker',
        label: role === 'start' ? 'Studio Start Frame' : 'Studio End Frame',
        config: {
          fileUrl: sourceUrl,
          fileType: 'image',
          fileName: asset.name,
          __studioGenerated: true,
          __studioFrameRole: role,
          __studioAssetId: asset.id,
          __studioCreatedAt: modelConfig.__studioCreatedAt,
        },
      }, { x: 80, y: baseY + offset });
      sourceNodes.push(frameNode);
      nextEdges.push(makeEdge(frameNode, modelNode, 'media', field.id, 'media'));
    };

    if (outputKind === 'video' && videoMode === 'frames') {
      if (selectedStartAsset && selectedStartField) addFrameNode(selectedStartAsset, selectedStartField, 'start', 100);
      if (selectedEndAsset && selectedEndField) addFrameNode(selectedEndAsset, selectedEndField, 'end', 200);
    }

    const nextNodes = [...state.nodes, ...sourceNodes, modelNode];
    dispatch({ type: 'SET_NODES', nodes: nextNodes });
    dispatch({ type: 'SET_EDGES', edges: nextEdges });
    runNode(modelNode.id, nextNodes, nextEdges);

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
    .filter((entry) => feedFilter === 'all' || entry.model.outputType === feedFilter)
    .sort((left, right) => (
      studioCreatedAt(right.node) - studioCreatedAt(left.node) || right.index - left.index
    )), [feedFilter, state.nodes]);

  const selectedStart = imageAssets.find((asset) => asset.id === startAssetId);
  const selectedEnd = imageAssets.find((asset) => asset.id === endAssetId);

  return (
    <div className="space-studio" data-testid="space-studio">
      <section className="space-studio__composer" aria-labelledby="space-studio-heading">
        <header className="space-studio__composer-header">
          <div>
            <span className="space-studio__eyebrow">Active Space</span>
            <h2 id="space-studio-heading">Generate in Studio</h2>
          </div>
          <span className="space-studio__space-name">
            {state.spaces.find((space) => space.id === state.activeSpaceId)?.name ?? 'Space'}
          </span>
        </header>

        <form className="space-studio__form" onSubmit={handleGenerate}>
          <div className="space-studio__type-toggle" role="group" aria-label="Output type">
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

          <label className="space-studio__field space-studio__field--prompt" htmlFor="space-studio-prompt">
            <span>Prompt</span>
            <textarea
              id="space-studio-prompt"
              data-testid="space-studio-prompt"
              value={prompt}
              rows={4}
              placeholder={outputKind === 'video'
                ? 'Describe the shot, action, camera, lighting, and mood…'
                : 'Describe the image, composition, lighting, and style…'}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>

          <label className="space-studio__field" htmlFor="space-studio-model">
            <span>Model</span>
            <select
              id="space-studio-model"
              data-testid="space-studio-model"
              value={modelType}
              onChange={(event) => {
                setModelType(event.target.value);
                setFormError('');
              }}
            >
              {modelOptions.length === 0 && <option value="">No compatible models</option>}
              {modelOptions.map((option: ProviderModelOption) => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))}
            </select>
          </label>

          {outputKind === 'video' && (
            <fieldset className="space-studio__mode">
              <legend>Video guidance</legend>
              <div role="group" aria-label="Video guidance mode">
                <button
                  type="button"
                  className={videoMode === 'frames' ? 'is-active' : undefined}
                  aria-pressed={videoMode === 'frames'}
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
                  data-testid="space-studio-video-mode-references"
                  onClick={() => {
                    setVideoMode('references');
                    setFormError('');
                  }}
                >
                  References
                </button>
              </div>
            </fieldset>
          )}

          {outputKind === 'video' && videoMode === 'frames' && (
            <fieldset className="space-studio__frames">
              <legend>Frames</legend>
              <label htmlFor="space-studio-start-frame">
                <span>Start frame <small>{startField ? 'Optional' : 'Not supported by this model'}</small></span>
                <select
                  id="space-studio-start-frame"
                  data-testid="space-studio-start-frame"
                  value={startAssetId}
                  disabled={!startField}
                  onChange={(event) => setStartAssetId(event.target.value)}
                >
                  <option value="">No start frame</option>
                  {imageAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
                </select>
              </label>
              {selectedStart && (
                <img
                  className="space-studio__frame-preview"
                  src={toFileUrl(selectedStart.thumbnailUrl || selectedStart.fileRef || selectedStart.url)}
                  alt={`Start frame: ${selectedStart.name}`}
                />
              )}
              <label htmlFor="space-studio-end-frame">
                <span>End frame <small>{endField ? 'Optional' : 'Not supported by this model'}</small></span>
                <select
                  id="space-studio-end-frame"
                  data-testid="space-studio-end-frame"
                  value={endAssetId}
                  disabled={!endField}
                  onChange={(event) => setEndAssetId(event.target.value)}
                >
                  <option value="">No end frame</option>
                  {imageAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
                </select>
              </label>
              {selectedEnd && (
                <img
                  className="space-studio__frame-preview"
                  src={toFileUrl(selectedEnd.thumbnailUrl || selectedEnd.fileRef || selectedEnd.url)}
                  alt={`End frame: ${selectedEnd.name}`}
                />
              )}
            </fieldset>
          )}

          <fieldset className="space-studio__elements">
            <legend>Elements <small>Optional references</small></legend>
            {outputKind === 'video' && videoMode === 'frames' && (
              <p>Switch to References to guide the video with Elements.</p>
            )}
            {availableElements.length === 0 ? (
              <p className="space-studio__empty-note">Add reference images in Elements to use them here.</p>
            ) : (
              <div className="space-studio__element-grid">
                {availableElements.map((element) => {
                  const image = elementImagesForVariation(element)[0];
                  const checked = selectedElementIds.includes(element.id);
                  const disabled = outputKind === 'video' && videoMode === 'frames';
                  return (
                    <label
                      key={element.id}
                      className={`space-studio__element${checked ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        data-testid={`space-studio-element-${element.id}`}
                        onChange={() => toggleElement(element.id)}
                      />
                      <img src={toFileUrl(image.url)} alt="" />
                      <span>{element.name}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>

          {controls.length > 0 && (
            <fieldset className="space-studio__controls">
              <legend>Model controls</legend>
              <div className="space-studio__control-grid">
                {controls.map((field) => {
                  const value = controlValue(controlValuesByModel[modelType], field);
                  const inputId = `space-studio-control-${field.id}`;
                  if (field.fieldType === 'toggle') {
                    return (
                      <label key={field.id} className="space-studio__control space-studio__control--toggle" htmlFor={inputId}>
                        <span>{field.label}</span>
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
                  if (field.fieldType === 'select') {
                    return (
                      <label key={field.id} className="space-studio__control" htmlFor={inputId}>
                        <span>{field.label}</span>
                        <select
                          id={inputId}
                          data-testid={inputId}
                          value={String(value)}
                          onChange={(event) => setControl(field, event.target.value)}
                        >
                          {field.options?.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                    );
                  }
                  return (
                    <label key={field.id} className="space-studio__control" htmlFor={inputId}>
                      <span>{field.label}{field.fieldType === 'range' ? `: ${value}` : ''}</span>
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
            </fieldset>
          )}

          {formError && <p className="space-studio__form-error" role="alert">{formError}</p>}

          <button
            className="space-studio__generate"
            type="submit"
            data-testid="space-studio-generate"
            disabled={isLaunching || !prompt.trim() || !modelType}
          >
            {isLaunching ? 'Starting…' : `Generate ${outputKind}`}
          </button>
        </form>
      </section>

      <section className="space-studio__feed" data-testid="space-studio-feed" aria-labelledby="space-studio-feed-heading">
        <header className="space-studio__feed-header">
          <div>
            <span className="space-studio__eyebrow">Generations</span>
            <h2 id="space-studio-feed-heading">Space feed</h2>
          </div>
          <div className="space-studio__filters" role="group" aria-label="Filter generations">
            {(['all', 'video', 'image'] as const).map((filter) => (
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
        </header>

        <div className="space-studio__feed-list">
          {feedItems.map(({ node, model: feedModel }) => (
            <StudioFeedItem
              key={node.id}
              node={node}
              model={feedModel}
              running={state.runningNodeIds.has(node.id)}
              onRetry={() => runNode(node.id, state.nodes, state.edges)}
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
