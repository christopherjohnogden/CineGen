import type { ProjectMeta } from '../../../electron.d';

interface ProjectCardProps {
  project: ProjectMeta;
  onOpen: (id: string, useSqlite: boolean) => void;
  onDelete: (id: string) => void;
  selected?: boolean;
  onSelect?: () => void;
  index?: number;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function ProjectCard({ project, onOpen, onDelete, selected = false, onSelect }: ProjectCardProps) {
  return (
    <div
      className={`pm-card${selected ? ' pm-card--selected' : ''}`}
      onClick={() => onSelect?.()}
      onDoubleClick={() => onOpen(project.id, project.useSqlite ?? false)}
    >
      {/* Thumbnail */}
      <div className="pm-card__thumb">
        {project.thumbnail ? (
          <img className="pm-card__thumb-img" src={project.thumbnail} alt={project.name} />
        ) : (
          <div className="pm-card__thumb-empty">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.75" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="20" rx="2" />
              <path d="M7 2v20M17 2v20M2 7h5M2 12h20M2 17h5M17 7h5M17 17h5" />
            </svg>
          </div>
        )}

        {/* Selection accent corner */}
        {selected && <div className="pm-card__sel-corner" />}

        {/* Hover overlay with name */}
        <div className="pm-card__hover-overlay">
          <span className="pm-card__hover-name">{project.name}</span>
        </div>
      </div>

      {/* Label below */}
      <div className="pm-card__label">
        <span className="pm-card__name">{project.name}</span>
        <span className="pm-card__time">{timeAgo(project.updatedAt)}</span>
      </div>

      {/* Delete */}
      <button
        className="pm-card__delete"
        onClick={(e) => { e.stopPropagation(); onDelete(project.id); }}
        title="Delete project"
        aria-label="Delete project"
      >
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
