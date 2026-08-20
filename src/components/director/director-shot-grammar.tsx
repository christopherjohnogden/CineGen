import type { DirectorBeat, DirectorShotGrammar } from '@/types/director';
import { grammarChoiceHint, inferBeatGrammar, SHOT_ANGLES, SHOT_BODIES, SHOT_CLEAN, SHOT_SIZES } from '@/lib/director/craft/coverage';

interface DirectorShotGrammarRowProps {
  beat: DirectorBeat;
  resolved?: DirectorShotGrammar;
  inherited?: boolean;
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
  options: ReadonlyArray<{ id: T; label: string; hint?: string }>;
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
            title={entry.hint}
            onClick={() => onPick(value === entry.id ? undefined : entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function DirectorShotGrammarRow({ beat, resolved, inherited, onPatch }: DirectorShotGrammarRowProps) {
  const inferred = inferBeatGrammar(beat) ?? {};
  const grammar = { ...inferred, ...resolved, ...beat.grammar };
  const set = (patch: Partial<DirectorShotGrammar>) => onPatch({ ...grammar, ...patch });
  const chosen = grammarChoiceHint(grammar);

  return (
    <div className="dcov-grammar">
      <ChipRow label="Size" value={grammar.size} options={SHOT_SIZES} onPick={(size) => set({ size })} />
      <ChipRow label="Bodies" value={grammar.bodies} options={SHOT_BODIES} onPick={(bodies) => set({ bodies })} />
      <ChipRow label="Frame" value={grammar.clean} options={SHOT_CLEAN} onPick={(clean) => set({ clean })} />
      <ChipRow label="Angle" value={grammar.angle} options={SHOT_ANGLES} onPick={(angle) => set({ angle })} />
      <p className="director-tab__meta">
        {inherited
          ? 'Holds the previous setup — the LLM did not name a new size.'
          : chosen || 'Hover a chip for the name. Size is how much of the body is in frame.'}
      </p>
    </div>
  );
}
