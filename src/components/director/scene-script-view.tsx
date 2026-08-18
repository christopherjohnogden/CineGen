import type { ScriptScene } from '@/lib/director/scene-split';
import { highlightRuns } from '@/lib/director/scene-assets';
import type { BreakdownKind, DirectorBreakdownItem } from '@/types/director';
import { PaginatedPages } from './paginated-pages';

interface SceneScriptViewProps {
  scene: ScriptScene;
  breakdown: DirectorBreakdownItem[];
  onAssetClick: (kind: BreakdownKind, name: string) => void;
}

export function SceneScriptView({ scene, breakdown, onAssetClick }: SceneScriptViewProps) {
  return (
    <PaginatedPages
      items={scene.elements}
      renderItem={(el) => (
        <div data-el-id={el.id} className={`dse-el dse-el--${el.type}`}>
          {highlightRuns(el.text, breakdown).map((run, i) =>
            run.kind ? (
              <mark
                key={i}
                className={`dbk-mark dbk-mark--${run.kind}`}
                title={`Jump to ${run.text}`}
                onClick={() => onAssetClick(run.kind as BreakdownKind, run.text)}
              >{run.text}</mark>
            ) : (
              <span key={i}>{run.text}</span>
            ),
          )}
        </div>
      )}
    />
  );
}
