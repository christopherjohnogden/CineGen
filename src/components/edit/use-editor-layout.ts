import { useState, useCallback } from 'react';
import type { EditorLayout } from '@/types/timeline';
import { DEFAULT_EDITOR_LAYOUT } from '@/types/timeline';

const STORAGE_KEY = 'cinegen_editor_layout';

function loadLayout(): EditorLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_EDITOR_LAYOUT, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_EDITOR_LAYOUT;
}

function saveLayout(layout: EditorLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {}
}

export function useEditorLayout() {
  const [layout, setLayoutState] = useState<EditorLayout>(loadLayout);

  const setLayout = useCallback((updates: Partial<EditorLayout>) => {
    setLayoutState((prev) => {
      const next = { ...prev, ...updates };
      next.leftPanelWidth = Math.max(180, Math.min(400, next.leftPanelWidth));
      next.rightPanelWidth = Math.max(200, Math.min(500, next.rightPanelWidth));
      next.viewerTimelineSplit = Math.max(0.2, Math.min(0.8, next.viewerTimelineSplit));
      next.sourceTimelineSplit = Math.max(0.2, Math.min(0.8, next.sourceTimelineSplit));
      saveLayout(next);
      return next;
    });
  }, []);

  return { layout, setLayout };
}
