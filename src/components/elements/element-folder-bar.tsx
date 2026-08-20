import { useState } from 'react';
import type { Element, ElementFolder, ElementFolderFilter } from '@/types/elements';
import { countByFolder } from '@/lib/elements/library';

interface ElementFolderBarProps {
  folders: ElementFolder[];
  elements: Element[];
  folder: ElementFolderFilter;
  onSelect: (folder: ElementFolderFilter) => void;
  onCreate: () => void;
  onRename: (folderId: string, name: string) => void;
  onDelete: (folderId: string) => void;
}

export function ElementFolderBar({
  folders,
  elements,
  folder,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: ElementFolderBarProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const sorted = [...folders].sort((a, b) => a.name.localeCompare(b.name));
  const unfiledCount = countByFolder(elements, 'unfiled');

  const commitRename = (folderId: string) => {
    const name = renameValue.trim();
    if (name) onRename(folderId, name);
    setRenamingId(null);
  };

  return (
    <div className="elements-tab__folders">
      <button
        type="button"
        className={`elements-tab__folder ${folder === 'all' ? 'elements-tab__folder--active' : ''}`}
        onClick={() => onSelect('all')}
      >
        All
        <span className="elements-tab__folder-count">{elements.length}</span>
      </button>
      <button
        type="button"
        className={`elements-tab__folder ${folder === 'unfiled' ? 'elements-tab__folder--active' : ''}`}
        onClick={() => onSelect('unfiled')}
      >
        Unfiled
        <span className="elements-tab__folder-count">{unfiledCount}</span>
      </button>
      {sorted.map((f) => (
        renamingId === f.id ? (
          <input
            key={f.id}
            className="elements-tab__folder-input"
            value={renameValue}
            autoFocus
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={() => commitRename(f.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename(f.id);
              if (e.key === 'Escape') setRenamingId(null);
            }}
          />
        ) : (
          <button
            key={f.id}
            type="button"
            className={`elements-tab__folder ${folder === f.id ? 'elements-tab__folder--active' : ''}`}
            onClick={() => onSelect(f.id)}
            onDoubleClick={() => { setRenamingId(f.id); setRenameValue(f.name); }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenu({ x: e.clientX, y: e.clientY, id: f.id });
            }}
          >
            {f.name}
            <span className="elements-tab__folder-count">{countByFolder(elements, f.id)}</span>
          </button>
        )
      ))}
      <button type="button" className="elements-tab__folder-add" onClick={onCreate}>
        New folder
      </button>
      {menu && (
        <div
          className="workflow-context-menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
          onMouseLeave={() => setMenu(null)}
        >
          <button
            type="button"
            className="workflow-context-menu__item"
            onClick={() => {
              const target = folders.find((f) => f.id === menu.id);
              if (target) { setRenamingId(target.id); setRenameValue(target.name); }
              setMenu(null);
            }}
          >
            Rename
          </button>
          <button
            type="button"
            className="workflow-context-menu__item workflow-context-menu__item--danger"
            onClick={() => { onDelete(menu.id); setMenu(null); }}
          >
            Delete folder
          </button>
        </div>
      )}
    </div>
  );
}
