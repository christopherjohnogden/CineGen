import type { DirectorBeat, DirectorShotGrammar } from '@/types/director';
import { SHOT_ANGLES, SHOT_BODIES, SHOT_CLEAN, SHOT_SIZES } from '@/lib/director/craft/coverage';

interface DirectorShotGrammarRowProps {
  beat: DirectorBeat;
  onPatch: (grammar: DirectorShotGrammar) => void;
}

function ChipRow<T extends string>({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value?: T;
  options: ReadonlyArray<{ id: T; label: string }>;
  onPick: (id: T | undefined) => void;
}) {
  return (
    <div className="dcov-chips">
      <span className="dsl-scenefield-label">{label}</span>
      <div className="dgen-seg" role="group" aria-label={label}>
        {options.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`dgen-seg-btn${value === entry.id ? ' dgen-seg-btn--on' : ''}`}
            onClick={() => onPick(value === entry.id ? undefined : entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function DirectorShotGrammarRow({ beat, onPatch }: DirectorShotGrammarRowProps) {
  const grammar = beat.grammar ?? {};
  const set = (patch: Partial<DirectorShotGrammar>) => onPatch({ ...grammar, ...patch });

  return (
    <div className="dcov-grammar">
      <ChipRow label="Size" value={grammar.size} options={SHOT_SIZES} onPick={(size) => set({ size })} />
      <ChipRow label="Bodies" value={grammar.bodies} options={SHOT_BODIES} onPick={(bodies) => set({ bodies })} />
      <ChipRow label="Frame" value={grammar.clean} options={SHOT_CLEAN} onPick={(clean) => set({ clean })} />
      <ChipRow label="Angle" value={grammar.angle} options={SHOT_ANGLES} onPick={(angle) => set({ angle })} />
    </div>
  );
}
