import { installTopviewModelCatalog } from '@/lib/fal/models';
import { refreshTopviewNodeDefinitions } from '@/lib/workflows/node-registry';
import type { TopviewGenerationCatalog } from '@/lib/topview/model-catalog';

export const TOPVIEW_CATALOG_UPDATED_EVENT = 'cinegen:topview-catalog-updated';

let request: Promise<TopviewGenerationCatalog | null> | null = null;
let loaded: TopviewGenerationCatalog | null = null;

export function currentTopviewModelCatalog(): TopviewGenerationCatalog | null {
  return loaded;
}

export async function ensureTopviewModelCatalog(force = false): Promise<TopviewGenerationCatalog | null> {
  if (!force && loaded) return loaded;
  if (!force && request) return request;
  if (typeof window === 'undefined' || !window.electronAPI?.topview?.modelCatalog) return null;
  request = window.electronAPI.topview.modelCatalog()
    .then((catalog) => {
      installTopviewModelCatalog(catalog);
      refreshTopviewNodeDefinitions();
      loaded = catalog;
      window.dispatchEvent(new CustomEvent(TOPVIEW_CATALOG_UPDATED_EVENT, { detail: catalog }));
      return catalog;
    })
    .catch(() => null)
    .finally(() => { request = null; });
  return request;
}
