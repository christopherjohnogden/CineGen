interface DirectorsNotesFieldProps {
  value: string;
  placeholder: string;
  hint: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onApply: () => void | Promise<void>;
  label?: string;
  className?: string;
  resetLabel?: string;
  resetTitle?: string;
  resetDisabled?: boolean;
  onReset?: () => void;
  hideLabel?: boolean;
}

export function DirectorsNotesField({
  value,
  placeholder,
  hint,
  disabled,
  onChange,
  onApply,
  label,
  className,
  resetLabel,
  resetTitle,
  resetDisabled,
  onReset,
  hideLabel,
}: DirectorsNotesFieldProps) {
  return (
    <div className={className ?? 'dsl-notes'}>
      {!hideLabel && <span className="dsl-scenefield-label">{label ?? 'Director\u2019s notes'}</span>}
      <textarea
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            if (value.trim()) void onApply();
          }
        }}
      />
      <div className="director-tab__row" style={{ alignItems: 'center' }}>
        <button
          type="button"
          className="director-tab__btn director-tab__btn--accent"
          disabled={disabled || !value.trim()}
          onClick={() => void onApply()}
        >
          Apply notes with LLM
        </button>
        {onReset && (
          <button
            type="button"
            className="director-tab__btn"
            disabled={resetDisabled}
            title={resetTitle}
            onClick={onReset}
          >
            {resetLabel ?? 'Reset to original'}
          </button>
        )}
        <span className="director-tab__meta">{hint}</span>
      </div>
    </div>
  );
}
