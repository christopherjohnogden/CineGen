

import { memo, useCallback, useState, useRef } from 'react';
import { type Node, type NodeProps, useReactFlow, useEdges } from '@xyflow/react';
import { BaseNode } from './base-node';
import { getApiKey } from '@/lib/utils/api-key';
import type { WorkflowNodeData } from '@/types/workflow';

type MusicPromptNodeProps = NodeProps & { data: WorkflowNodeData };

function MusicPromptNodeInner({ id, data, selected }: MusicPromptNodeProps) {
  const { updateNodeData, getNode } = useReactFlow();
  const edges = useEdges();
  const [generating, setGenerating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const style = (data.config?.style as string) ?? '';
  const genre = (data.config?.genre as string) ?? '';
  const mood = (data.config?.mood as string) ?? '';
  const tempo = (data.config?.tempo as string) ?? '';
  const notes = (data.config?.additionalNotes as string) ?? '';
  const generatedPrompt = (data.config?.generatedPrompt as string) ?? '';

  const updateConfig = useCallback(
    (partial: Record<string, unknown>) => {
      updateNodeData(id, { config: { ...data.config, ...partial } });
    },
    [id, data.config, updateNodeData],
  );

  /** Get the upstream video URL if connected. */
  const getVideoUrl = useCallback((): string | undefined => {
    const videoEdge = edges.find(
      (e) => e.target === id && e.targetHandle === 'video',
    );
    if (!videoEdge) return undefined;

    const sourceNode = getNode(videoEdge.source) as
      | (Node<WorkflowNodeData>)
      | undefined;
    return sourceNode?.data?.result?.url;
  }, [edges, id, getNode]);

  const videoUrl = getVideoUrl();
  const hasVideo = !!videoUrl;

  /** Extract frames from a video URL client-side, then upload to fal storage. */
  const extractAndUploadFrames = useCallback(async (url: string, signal: AbortSignal): Promise<string[]> => {
    const blobs = await new Promise<Blob[]>((resolve) => {
      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.muted = true;
      video.preload = 'auto';
      video.src = url;

      video.addEventListener('loadedmetadata', () => {
        const dur = video.duration || 5;
        const count = Math.min(4, Math.max(2, Math.round(dur / 2)));
        const results: Blob[] = [];
        let idx = 0;

        const capture = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = Math.min(video.videoWidth, 512);
            canvas.height = Math.min(video.videoHeight, 512);
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              canvas.toBlob((blob) => {
                if (blob) results.push(blob);
                idx++;
                if (idx < count) {
                  video.currentTime = ((idx + 1) * dur) / (count + 1);
                } else {
                  resolve(results);
                }
              }, 'image/jpeg', 0.7);
              return;
            }
          } catch { /* CORS */ }
          idx++;
          if (idx < count) {
            video.currentTime = ((idx + 1) * dur) / (count + 1);
          } else {
            resolve(results);
          }
        };

        video.addEventListener('seeked', capture);
        video.currentTime = dur / (count + 1);
      }, { once: true });

      video.addEventListener('error', () => resolve([]), { once: true });
      video.load();
    });

    if (blobs.length === 0) return [];

    // Upload each frame to fal storage via IPC
    const apiKey = getApiKey();
    const urls = await Promise.all(
      blobs.map(async (blob) => {
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
  }, []);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    abortRef.current = new AbortController();

    try {
      // Extract and upload frames if video is connected
      let frameUrls: string[] = [];
      if (videoUrl) {
        frameUrls = await extractAndUploadFrames(videoUrl, abortRef.current.signal);
      }

      const { prompt } = await window.electronAPI.music.generatePrompt({
        apiKey: getApiKey(),
        frameUrls: frameUrls.length > 0 ? frameUrls : undefined,
        style: style || undefined,
        genre: genre || undefined,
        mood: mood || undefined,
        tempo: tempo || undefined,
        additionalNotes: notes || undefined,
      });
      updateConfig({ generatedPrompt: prompt, usedVideo: frameUrls.length > 0 });
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error('[music-prompt-node]', error);
        updateConfig({ generatedPrompt: `Error: ${(error as Error).message}`, usedVideo: false });
      }
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  }, [videoUrl, extractAndUploadFrames, style, genre, mood, tempo, notes, updateConfig]);

  return (
    <BaseNode nodeType="musicPrompt" selected={!!selected}>
      <div className="music-prompt-node__fields">
        <div className="music-prompt-node__row">
          <input
            type="text"
            className="music-prompt-node__input nodrag"
            placeholder="Genre (e.g., cinematic, electronic)"
            value={genre}
            onChange={(e) => updateConfig({ genre: e.target.value })}
          />
          <input
            type="text"
            className="music-prompt-node__input nodrag"
            placeholder="Mood (e.g., tense, uplifting)"
            value={mood}
            onChange={(e) => updateConfig({ mood: e.target.value })}
          />
        </div>
        <div className="music-prompt-node__row">
          <input
            type="text"
            className="music-prompt-node__input nodrag"
            placeholder="Style (e.g., orchestral, lo-fi)"
            value={style}
            onChange={(e) => updateConfig({ style: e.target.value })}
          />
          <input
            type="text"
            className="music-prompt-node__input nodrag"
            placeholder="Tempo (e.g., slow, 120bpm)"
            value={tempo}
            onChange={(e) => updateConfig({ tempo: e.target.value })}
          />
        </div>
        <textarea
          className="music-prompt-node__textarea nodrag nowheel"
          rows={2}
          placeholder="Additional notes..."
          value={notes}
          onChange={(e) => updateConfig({ additionalNotes: e.target.value })}
        />
      </div>

      <div className="music-prompt-node__status">
        <span className={`music-prompt-node__indicator${hasVideo ? ' music-prompt-node__indicator--active' : ''}`} />
        {hasVideo ? 'Video connected' : 'No video — text only'}
      </div>

      {generatedPrompt && (
        <>
          {data.config?.usedVideo && (
            <div className="music-prompt-node__context-tag">Video context used</div>
          )}
          <textarea
            className="music-prompt-node__result nodrag nowheel"
            rows={4}
            value={generatedPrompt}
            onChange={(e) => updateConfig({ generatedPrompt: e.target.value })}
          />
        </>
      )}

      <button
        type="button"
        className="music-prompt-node__generate-btn nodrag"
        onClick={handleGenerate}
        disabled={generating}
      >
        {generating ? 'Generating...' : 'Generate Music Prompt'}
      </button>
    </BaseNode>
  );
}

export const MusicPromptNode = memo(MusicPromptNodeInner);
