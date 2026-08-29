import { useEffect, useState } from 'react';
import {
  ensureTopviewModelCatalog,
  TOPVIEW_CATALOG_UPDATED_EVENT,
} from '@/lib/topview/live-model-catalog';

/**
 * Keeps model pickers in sync with the connected Topview account's live
 * catalog. The static registry is available immediately; this causes a
 * lightweight re-render after Topview returns account-specific options.
 */
export function useTopviewModelCatalogVersion(): number {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const handleCatalogUpdate = () => setVersion((current) => current + 1);
    window.addEventListener(TOPVIEW_CATALOG_UPDATED_EVENT, handleCatalogUpdate);
    void ensureTopviewModelCatalog();
    return () => window.removeEventListener(TOPVIEW_CATALOG_UPDATED_EVENT, handleCatalogUpdate);
  }, []);

  return version;
}
