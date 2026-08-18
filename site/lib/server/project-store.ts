import { SiteHttpError, assertId, requireRecord } from "./common";

type ProjectState = Record<string, unknown> & {
  project: Record<string, unknown>;
};

type ProjectRow = {
  id: string;
  workspace_id: string;
  name: string;
  state_json: string;
  created_at: string;
  updated_at: string;
  asset_count: number;
  element_count: number;
  thumbnail: string | null;
  revision: number;
};

const CREATE_PROJECTS_TABLE = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  asset_count INTEGER NOT NULL DEFAULT 0,
  element_count INTEGER NOT NULL DEFAULT 0,
  thumbnail TEXT,
  revision INTEGER NOT NULL DEFAULT 1
)`;

const CREATE_PROJECTS_INDEX = `
CREATE INDEX IF NOT EXISTS idx_projects_workspace_updated
ON projects (workspace_id, updated_at)`;

function now(): string {
  return new Date().toISOString();
}

export function createDefaultProjectState(name: string): ProjectState {
  const id = crypto.randomUUID();
  const createdAt = now();
  const timelineId = crypto.randomUUID();
  const videoTrackId = crypto.randomUUID();
  const audioTrackId = crypto.randomUUID();
  const spaceId = crypto.randomUUID();

  return {
    project: {
      id,
      name,
      created_at: createdAt,
      updated_at: createdAt,
      resolution_width: 1920,
      resolution_height: 1080,
      frame_rate: 24,
    },
    assets: [],
    mediaFolders: [],
    timelines: [{
      id: timelineId,
      project_id: id,
      name: "Timeline 1",
      duration: 0,
      created_at: createdAt,
      markers: "[]",
      tracks: [
        {
          id: videoTrackId,
          timeline_id: timelineId,
          name: "Video 1",
          kind: "video",
          color: "#4A90D9",
          muted: 0,
          solo: 0,
          locked: 0,
          visible: 1,
          volume: 1,
          sort_order: 0,
        },
        {
          id: audioTrackId,
          timeline_id: timelineId,
          name: "Audio 1",
          kind: "audio",
          color: "#7ED321",
          muted: 0,
          solo: 0,
          locked: 0,
          visible: 1,
          volume: 1,
          sort_order: 1,
        },
      ],
      clips: [],
      transitions: [],
    }],
    activeTimelineId: timelineId,
    workflow: {
      nodes: [],
      edges: [],
      spaces: [{ id: spaceId, name: "Space 1", createdAt, nodes: [], edges: [] }],
      activeSpaceId: spaceId,
      openSpaceIds: [spaceId],
    },
    elements: [],
    exports: [],
  };
}

function arrayValue(value: unknown, fallback: unknown[]): unknown[] {
  return Array.isArray(value) ? value : fallback;
}

function stateMetadata(state: ProjectState) {
  const assets = arrayValue(state.assets, []);
  const elements = arrayValue(state.elements, []);
  const firstThumbnail = assets.find((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const row = value as Record<string, unknown>;
    return typeof (row.thumbnail_url ?? row.thumbnailUrl) === "string";
  }) as Record<string, unknown> | undefined;
  return {
    assetCount: assets.length,
    elementCount: elements.length,
    thumbnail: (firstThumbnail?.thumbnail_url ?? firstThumbnail?.thumbnailUrl ?? null) as string | null,
  };
}

function parseState(row: ProjectRow): ProjectState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.state_json);
  } catch {
    throw new SiteHttpError(500, "Stored project data is invalid.", "PROJECT_DATA_INVALID");
  }
  const state = requireRecord(parsed, "Stored project") as ProjectState;
  state.project = requireRecord(state.project, "Stored project metadata");
  return state;
}

function legacySnapshot(state: ProjectState) {
  const workflow = requireRecord(state.workflow ?? {}, "Workflow");
  return {
    project: {
      id: state.project.id,
      name: state.project.name,
      createdAt: state.project.created_at,
      updatedAt: state.project.updated_at,
    },
    workflow,
    spaces: arrayValue(workflow.spaces, []),
    activeSpaceId: typeof workflow.activeSpaceId === "string" ? workflow.activeSpaceId : "",
    openSpaceIds: arrayValue(workflow.openSpaceIds, []),
    assets: arrayValue(state.assets, []),
    mediaFolders: arrayValue(state.mediaFolders, []),
    timelines: arrayValue(state.timelines, []),
    activeTimelineId: state.activeTimelineId,
    exports: arrayValue(state.exports, []),
    elements: arrayValue(state.elements, []),
  };
}

export function createProjectStore(db: D1Database, workspaceId: string) {
  const ensureSchema = async () => {
    await db.batch([
      db.prepare(CREATE_PROJECTS_TABLE),
      db.prepare(CREATE_PROJECTS_INDEX),
    ]);
  };

  const loadRow = async (idValue: unknown): Promise<ProjectRow> => {
    const id = assertId(idValue, "project id");
    await ensureSchema();
    const row = await db.prepare(
      "SELECT * FROM projects WHERE id = ? AND workspace_id = ? LIMIT 1",
    ).bind(id, workspaceId).first<ProjectRow>();
    if (!row) {
      throw new SiteHttpError(404, `Project not found: ${id}`, "PROJECT_NOT_FOUND");
    }
    return row;
  };

  const load = async (id: unknown): Promise<ProjectState> => parseState(await loadRow(id));

  const save = async (idValue: unknown, stateValue: unknown): Promise<ProjectState> => {
    const id = assertId(idValue, "project id");
    const state = requireRecord(stateValue, "Project state") as ProjectState;
    const row = await loadRow(id);
    const previous = parseState(row);
    const incomingProject = requireRecord(state.project ?? {}, "Project metadata");
    const updatedAt = now();
    const name = typeof incomingProject.name === "string" && incomingProject.name.trim()
      ? incomingProject.name.trim().slice(0, 100)
      : row.name;
    const next: ProjectState = {
      ...previous,
      ...state,
      project: {
        ...previous.project,
        ...incomingProject,
        id,
        name,
        created_at: incomingProject.created_at || previous.project.created_at || row.created_at,
        updated_at: updatedAt,
      },
      assets: arrayValue(state.assets, arrayValue(previous.assets, [])),
      mediaFolders: arrayValue(state.mediaFolders, arrayValue(previous.mediaFolders, [])),
      timelines: arrayValue(state.timelines, arrayValue(previous.timelines, [])),
      elements: arrayValue(state.elements, arrayValue(previous.elements, [])),
      exports: arrayValue(state.exports, arrayValue(previous.exports, [])),
      workflow: state.workflow && typeof state.workflow === "object"
        ? state.workflow
        : previous.workflow,
    };
    const metadata = stateMetadata(next);
    const result = await db.prepare(`
      UPDATE projects
      SET name = ?, state_json = ?, updated_at = ?, asset_count = ?,
          element_count = ?, thumbnail = ?, revision = revision + 1
      WHERE id = ? AND workspace_id = ?
    `).bind(
      name,
      JSON.stringify(next),
      updatedAt,
      metadata.assetCount,
      metadata.elementCount,
      metadata.thumbnail,
      id,
      workspaceId,
    ).run();
    if (!result.meta.changes) {
      throw new SiteHttpError(409, "Project changed while it was being saved.", "PROJECT_SAVE_CONFLICT");
    }
    return next;
  };

  return {
    async list() {
      await ensureSchema();
      const query = await db.prepare(`
        SELECT id, name, created_at, updated_at, asset_count, element_count, thumbnail
        FROM projects
        WHERE workspace_id = ?
        ORDER BY updated_at DESC
      `).bind(workspaceId).all<Pick<ProjectRow,
        "id" | "name" | "created_at" | "updated_at" | "asset_count" | "element_count" | "thumbnail"
      >>();
      return (query.results ?? []).map((row) => ({
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        assetCount: row.asset_count,
        elementCount: row.element_count,
        thumbnail: row.thumbnail,
        useSqlite: true,
      }));
    },

    async create(nameValue: unknown) {
      const name = typeof nameValue === "string" ? nameValue.trim() : "";
      if (!name || name.length > 100) {
        throw new SiteHttpError(
          400,
          "Project name must be 1-100 characters.",
          "INVALID_PROJECT_NAME",
        );
      }
      await ensureSchema();
      const state = createDefaultProjectState(name);
      const createdAt = String(state.project.created_at);
      await db.prepare(`
        INSERT INTO projects (
          id, workspace_id, name, state_json, created_at, updated_at,
          asset_count, element_count, thumbnail, revision
        ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, NULL, 1)
      `).bind(
        state.project.id,
        workspaceId,
        name,
        JSON.stringify(state),
        createdAt,
        createdAt,
      ).run();
      return state;
    },

    load,
    save,

    async delete(idValue: unknown) {
      const id = assertId(idValue, "project id");
      await ensureSchema();
      await db.prepare(
        "DELETE FROM projects WHERE id = ? AND workspace_id = ?",
      ).bind(id, workspaceId).run();
      return id;
    },

    async patchProject(id: unknown, partialValue: unknown) {
      const current = await load(id);
      const partial = requireRecord(partialValue ?? {}, "Project update");
      return save(id, {
        ...current,
        project: { ...current.project, ...partial },
      });
    },

    async insertAsset(assetValue: unknown) {
      const asset = requireRecord(assetValue, "Asset");
      const projectId = assertId(asset.project_id, "asset project id");
      const current = await load(projectId);
      const assets = arrayValue(current.assets, []) as Record<string, unknown>[];
      const nextAsset = {
        ...asset,
        id: typeof asset.id === "string" && SAFE_ASSET_ID.test(asset.id)
          ? asset.id
          : crypto.randomUUID(),
        project_id: projectId,
      };
      await save(projectId, {
        ...current,
        assets: [nextAsset, ...assets.filter((entry) => entry.id !== nextAsset.id)],
      });
      return nextAsset;
    },

    async updateAsset(projectIdValue: unknown, assetIdValue: unknown, partialValue: unknown) {
      const projectId = assertId(projectIdValue, "project id");
      const assetId = assertId(assetIdValue, "asset id");
      const partial = requireRecord(partialValue ?? {}, "Asset update");
      const current = await load(projectId);
      let found = false;
      const assets = (arrayValue(current.assets, []) as Record<string, unknown>[]).map((asset) => {
        if (asset.id !== assetId) return asset;
        found = true;
        return { ...asset, ...partial, id: assetId, project_id: projectId };
      });
      if (!found) throw new SiteHttpError(404, "Asset not found.", "ASSET_NOT_FOUND");
      await save(projectId, { ...current, assets });
    },

    async deleteAsset(projectIdValue: unknown, assetIdValue: unknown) {
      const projectId = assertId(projectIdValue, "project id");
      const assetId = assertId(assetIdValue, "asset id");
      const current = await load(projectId);
      await save(projectId, {
        ...current,
        assets: (arrayValue(current.assets, []) as Record<string, unknown>[])
          .filter((asset) => asset.id !== assetId),
      });
    },

    legacySnapshot,
  };
}

const SAFE_ASSET_ID = /^[A-Za-z0-9_-]{1,128}$/;
