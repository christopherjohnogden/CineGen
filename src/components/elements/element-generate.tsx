

import { useState, useCallback, useMemo } from 'react';
import type { ElementType, ElementImage } from '@/types/elements';
import { getApiKey } from '@/lib/utils/api-key';

interface ElementGenerateProps {
  elementType: ElementType;
  description: string;
  onGenerated: (images: ElementImage[]) => void;
  referenceImages?: ElementImage[];
}

type Phase = 'idle' | 'generating' | 'review';

const COMMON_SUFFIX = 'Use a clean, neutral plain background. Photographic style with even, consistent lighting, natural controlled shadows, and sharp details.';

function buildIndividualPrompts(type: ElementType, description: string): string[] {
  switch (type) {
    case 'character':
      return [
        `Full-body front view of ${description} standing in a relaxed A-pose. ${COMMON_SUFFIX}`,
        `Full-body left profile view of ${description} standing in a relaxed A-pose, facing left. ${COMMON_SUFFIX}`,
        `Full-body right profile view of ${description} standing in a relaxed A-pose, facing right. ${COMMON_SUFFIX}`,
        `Full-body back view of ${description} standing in a relaxed A-pose, seen from behind. ${COMMON_SUFFIX}`,
        `Highly detailed close-up front portrait of ${description}, head and shoulders. ${COMMON_SUFFIX}`,
        `Highly detailed close-up left profile portrait of ${description}, head and shoulders, facing left. ${COMMON_SUFFIX}`,
        `Highly detailed close-up right profile portrait of ${description}, head and shoulders, facing right. ${COMMON_SUFFIX}`,
      ];

    case 'location':
      return [
        `Wide establishing front/entrance view of ${description}. ${COMMON_SUFFIX}`,
        `Wide establishing view of ${description} from a 45-degree left angle. ${COMMON_SUFFIX}`,
        `Wide establishing view of ${description} from a 45-degree right angle. ${COMMON_SUFFIX}`,
        `Aerial overhead view of ${description}. ${COMMON_SUFFIX}`,
        `Detailed close-up of key architectural or environmental detail of ${description}. ${COMMON_SUFFIX}`,
        `Detailed close-up of textures and materials of ${description}. ${COMMON_SUFFIX}`,
        `Atmospheric mood shot of ${description} showing time-of-day lighting. ${COMMON_SUFFIX}`,
      ];

    case 'prop':
      return [
        `Front view of ${description} on a neutral background. ${COMMON_SUFFIX}`,
        `Left side view of ${description}, rotated 90 degrees. ${COMMON_SUFFIX}`,
        `Right side view of ${description}, rotated 90 degrees. ${COMMON_SUFFIX}`,
        `Back view of ${description} on a neutral background. ${COMMON_SUFFIX}`,
        `Top-down view of ${description} showing full detail. ${COMMON_SUFFIX}`,
        `Detailed close-up of key detail or mechanism of ${description}. ${COMMON_SUFFIX}`,
        `Detailed close-up of texture and material surface of ${description}. ${COMMON_SUFFIX}`,
      ];

    case 'vehicle':
      return [
        `Front head-on view of ${description} on a neutral background. ${COMMON_SUFFIX}`,
        `Left profile view (driver side) of ${description}. ${COMMON_SUFFIX}`,
        `Right profile view (passenger side) of ${description}. ${COMMON_SUFFIX}`,
        `Rear view of ${description} on a neutral background. ${COMMON_SUFFIX}`,
        `Three-quarter front hero angle view of ${description}. ${COMMON_SUFFIX}`,
        `Interior cockpit view of ${description}. ${COMMON_SUFFIX}`,
        `Detailed close-up of a key defining feature of ${description} (engine, wheels, or signature detail). ${COMMON_SUFFIX}`,
      ];
  }
}

function buildPanelLabels(type: ElementType): string[] {
  switch (type) {
    case 'character':
      return ['Front', 'Left Profile', 'Right Profile', 'Back', 'Front Portrait', 'Left Portrait', 'Right Portrait'];
    case 'location':
      return ['Front/Entrance', 'Left Angle', 'Right Angle', 'Aerial', 'Key Detail', 'Textures', 'Atmosphere'];
    case 'prop':
      return ['Front', 'Left Side', 'Right Side', 'Back', 'Top-Down', 'Detail', 'Texture'];
    case 'vehicle':
      return ['Front', 'Left Profile', 'Right Profile', 'Rear', 'Hero Angle', 'Interior', 'Key Detail'];
  }
}


async function generateSingleImage(prompt: string, referenceUrls?: string[]): Promise<string | null> {
  const apiKey = getApiKey();
  const isEdit = referenceUrls && referenceUrls.length > 0;

  const inputs: Record<string, unknown> = {
    prompt: isEdit
      ? `${prompt} Use the provided reference image to maintain exact identity and appearance consistency.`
      : prompt,
    resolution: '1K',
    aspect_ratio: '1:1',
    seed: Math.floor(Math.random() * 999999),
  };
  if (isEdit) {
    inputs.image_urls = referenceUrls;
  }

  try {
    const data = await window.electronAPI.workflow.run({
      apiKey,
      nodeId: 'element-gen',
      nodeType: 'nano-banana-pro',
      modelId: isEdit ? 'fal-ai/nano-banana-pro/edit' : 'fal-ai/nano-banana-pro',
      inputs,
    }) as Record<string, unknown>;
    const url = (data?.images as { url: string }[] | undefined)?.[0]?.url;
    if (!url) {
      console.error('[element-generate] No image URL in response:', data);
      return null;
    }
    return url;
  } catch (err) {
    console.error('[element-generate] Request failed:', err);
    return null;
  }
}

export function ElementGenerate({ elementType, description, onGenerated, referenceImages }: ElementGenerateProps) {
  const [prompt, setPrompt] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [panels, setPanels] = useState<(ElementImage | null)[]>([]);
  const [generateProgress, setGenerateProgress] = useState(0);
  const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(null);

  const desc = prompt.trim() || description.trim();
  const isBusy = phase === 'generating' || regeneratingIndex !== null;
  const labels = buildPanelLabels(elementType);
  const totalPanels = labels.length;

  // Get fal.ai URLs from uploaded reference images (filter out blob: URLs)
  const uploadedRefUrls = useMemo(
    () => (referenceImages ?? []).map((img) => img.url).filter((u) => !u.startsWith('blob:')),
    [referenceImages],
  );

  const handleGenerate = useCallback(async () => {
    if (!desc) return;
    setPhase('generating');
    setGenerateProgress(0);

    const prompts = buildIndividualPrompts(elementType, desc);
    const images: (ElementImage | null)[] = new Array(prompts.length).fill(null);
    setPanels(images);

    let generatedRefUrl: string | null = null;

    for (let i = 0; i < prompts.length; i++) {
      // Build reference URLs for this panel:
      // - If user uploaded photos, always include those
      // - For panels 1+, also include the first generated panel for consistency
      const refs: string[] = [...uploadedRefUrls];
      if (i > 0 && generatedRefUrl) refs.push(generatedRefUrl);

      const url = await generateSingleImage(
        prompts[i],
        refs.length > 0 ? refs : undefined,
      );
      if (url) {
        if (i === 0) generatedRefUrl = url;
        images[i] = {
          id: crypto.randomUUID(),
          url,
          createdAt: new Date().toISOString(),
          source: 'generated',
        };
      }
      setPanels([...images]);
      setGenerateProgress(i + 1);
    }

    setPhase('review');
  }, [desc, elementType, uploadedRefUrls]);

  const handleRegeneratePanel = useCallback(async (index: number) => {
    if (regeneratingIndex !== null) return;
    setRegeneratingIndex(index);

    const prompts = buildIndividualPrompts(elementType, desc);
    // Use uploaded references + panel 0 for consistency (unless regenerating panel 0 itself)
    const refs: string[] = [...uploadedRefUrls];
    if (index !== 0 && panels[0]?.url) refs.push(panels[0].url);
    const url = await generateSingleImage(prompts[index], refs.length > 0 ? refs : undefined);

    if (url) {
      setPanels((prev) => {
        const next = [...prev];
        next[index] = {
          id: crypto.randomUUID(),
          url,
          createdAt: new Date().toISOString(),
          source: 'generated',
        };
        return next;
      });
    }

    setRegeneratingIndex(null);
  }, [regeneratingIndex, elementType, desc, panels, uploadedRefUrls]);

  const handleRegenerateAll = useCallback(() => {
    handleGenerate();
  }, [handleGenerate]);

  const handleKeepAll = () => {
    const kept = panels.filter((p): p is ElementImage => p !== null);
    if (kept.length > 0) {
      // Put the front portrait (index 4) first so it becomes the element thumbnail
      const portraitIndex = 4;
      if (kept.length > portraitIndex) {
        const [portrait] = kept.splice(portraitIndex, 1);
        kept.unshift(portrait);
      }
      onGenerated(kept);
    }
    setPhase('idle');
    setPanels([]);
    setGenerateProgress(0);
  };

  return (
    <div className="element-generate">
      {/* Input row — visible in idle */}
      {phase === 'idle' && (
        <div className="element-generate__input-row">
          <input
            className="element-modal__input element-generate__prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={description || 'Describe what to generate...'}
          />
          <button
            type="button"
            className="element-generate__btn"
            onClick={handleGenerate}
            disabled={!desc}
          >
            Generate
          </button>
        </div>
      )}

      {/* Progress bar during generation */}
      {phase === 'generating' && (
        <div className="element-generate__expand-status">
          <span className="element-generate__phase-label">Generating panels ({generateProgress}/{totalPanels})</span>
          <div className="element-generate__progress">
            <div className="element-generate__progress-bar" style={{ width: `${(generateProgress / totalPanels) * 100}%` }} />
          </div>
        </div>
      )}

      {/* Panel grid — visible during generating and review */}
      {(phase === 'generating' || phase === 'review') && (
        <div className="element-generate__results">
          {phase === 'review' && (
            <div className="element-generate__results-header">
              <span className="element-generate__results-label">Hover a panel to regenerate it</span>
              <div className="element-generate__results-actions">
                <button type="button" className="element-generate__regen-all-btn" onClick={handleRegenerateAll} disabled={isBusy}>
                  Regenerate All
                </button>
                <button type="button" className="element-generate__keep-all" onClick={handleKeepAll}>
                  Keep All
                </button>
              </div>
            </div>
          )}
          <div className="element-generate__sheet-grid">
            {panels.map((panel, i) => (
              <div key={i} className="element-generate__sheet-cell">
                {panel ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={panel.url} alt={labels[i]} className="element-generate__result-img" />
                    <span className="element-generate__panel-label">{labels[i]}</span>
                    {phase === 'review' && regeneratingIndex !== i && (
                      <div className="element-generate__panel-overlay">
                        <button
                          type="button"
                          className="element-generate__panel-regen-btn"
                          onClick={() => handleRegeneratePanel(i)}
                          disabled={isBusy}
                          title={`Regenerate ${labels[i]}`}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="23 4 23 10 17 10" />
                            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                          </svg>
                        </button>
                      </div>
                    )}
                    {regeneratingIndex === i && (
                      <div className="element-generate__panel-spinner">
                        <div className="element-generate__spinner" />
                      </div>
                    )}
                  </>
                ) : (
                  <div className="element-generate__panel-placeholder">
                    {phase === 'generating' && i >= generateProgress ? (
                      <span className="element-generate__panel-pending">{labels[i]}</span>
                    ) : phase === 'generating' && i < generateProgress ? (
                      <span className="element-generate__panel-pending">Failed</span>
                    ) : (
                      <div className="element-generate__spinner" />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
