import {
  migrateProjectsIntoLibrary,
  normalizeLibrary,
  syncProjectFolder,
} from "../../../src/lib/elements/library";
import type { ElementsLibrary } from "../../../src/types/elements";
import { SiteHttpError, assertId, requireRecord } from "./common";

type ElementsLibraryRow = {
  library_json: string;
};

const CREATE_ELEMENTS_LIBRARY_TABLE = `
CREATE TABLE IF NOT EXISTS element_libraries (
  workspace_id TEXT PRIMARY KEY NOT NULL,
  library_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1
)`;

const MAX_LIBRARY_BYTES = 1_500_000;

function parseLibrary(value: string): ElementsLibrary {
  try {
    return normalizeLibrary(JSON.parse(value));
  } catch {
    throw new SiteHttpError(500, "Stored Elements library data is invalid.", "ELEMENTS_LIBRARY_INVALID");
  }
}

function serializeLibrary(value: unknown): string {
  const library = normalizeLibrary(requireRecord(value, "Elements library"));
  const json = JSON.stringify(library);
  if (new TextEncoder().encode(json).byteLength > MAX_LIBRARY_BYTES) {
    throw new SiteHttpError(413, "The Elements library is too large to save.", "ELEMENTS_LIBRARY_TOO_LARGE");
  }
  return json;
}

export function createElementsLibraryStore(db: D1Database, workspaceId: string) {
  const ensureSchema = async () => {
    await db.prepare(CREATE_ELEMENTS_LIBRARY_TABLE).run();
  };

  const write = async (library: ElementsLibrary): Promise<ElementsLibrary> => {
    const json = serializeLibrary(library);
    await db.prepare(`
      INSERT INTO element_libraries (workspace_id, library_json, updated_at, revision)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(workspace_id) DO UPDATE SET
        library_json = excluded.library_json,
        updated_at = excluded.updated_at,
        revision = element_libraries.revision + 1
    `).bind(workspaceId, json, new Date().toISOString()).run();
    return JSON.parse(json) as ElementsLibrary;
  };

  const migrateExistingProjects = async (): Promise<ElementsLibrary> => {
    const rows = await db.prepare(`
      SELECT id, name, state_json
      FROM projects
      WHERE workspace_id = ?
    `).bind(workspaceId).all<{ id: string; name: string; state_json: string }>();
    const projects = (rows.results ?? []).map((row) => {
      let state: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(row.state_json);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          state = parsed as Record<string, unknown>;
        }
      } catch {
        // A damaged project is handled by the project loader. It should not
        // prevent the rest of the workspace's Elements library from opening.
      }
      return {
        id: row.id,
        name: row.name,
        elements: Array.isArray(state.elements) ? state.elements : [],
      };
    });
    return migrateProjectsIntoLibrary(null, projects);
  };

  return {
    async load(optionsValue: unknown): Promise<ElementsLibrary> {
      await ensureSchema();
      const row = await db.prepare(
        "SELECT library_json FROM element_libraries WHERE workspace_id = ? LIMIT 1",
      ).bind(workspaceId).first<ElementsLibraryRow>();
      let library = row ? parseLibrary(row.library_json) : await migrateExistingProjects();

      const options = optionsValue && typeof optionsValue === "object" && !Array.isArray(optionsValue)
        ? optionsValue as Record<string, unknown>
        : {};
      if (options.projectId !== undefined) {
        const projectId = assertId(options.projectId, "project id");
        const projectName = typeof options.projectName === "string" ? options.projectName : "Untitled project";
        library = syncProjectFolder(library, projectId, projectName);
      }

      if (!row || JSON.stringify(library) !== row.library_json) {
        return write(library);
      }
      return library;
    },

    async save(libraryValue: unknown): Promise<ElementsLibrary> {
      await ensureSchema();
      return write(normalizeLibrary(requireRecord(libraryValue, "Elements library")));
    },
  };
}
