const RESOLUTIONS = ['480p', '720p', '1080p'] as const;

interface DirectorResolutionPickerProps {
  value: string;
  onChange: (resolution: string) => void;
  compact?: boolean;
  providerLabel?: string;
}

/** Output-size control shared by Director Setup and the Generate action bar. */
export function DirectorResolutionPicker({
  value,
  onChange,
  compact = false,
  providerLabel,
}: DirectorResolutionPickerProps) {
  const provider = providerLabel ? ` with ${providerLabel}` : '';
  return (
    <div
      className={`dresolution${compact ? ' dresolution--compact' : ''}`}
      title={`Resolution for the next video generated${provider}. 480p is fastest; 1080p takes longer and uses more GPU time.`}
    >
      <span className={compact ? 'dresolution__label' : 'director-tab__label'}>
        {compact ? 'Output' : 'Output resolution'}
      </span>
      <div className="dresolution__options" role="group" aria-label="Output resolution">
        {RESOLUTIONS.map((resolution) => (
          <button
            key={resolution}
            type="button"
            className={`dresolution__option${resolution === value ? ' dresolution__option--selected' : ''}`}
            aria-pressed={resolution === value}
            onClick={() => onChange(resolution)}
          >
            {resolution}
          </button>
        ))}
      </div>
    </div>
  );
}
