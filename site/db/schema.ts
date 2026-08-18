import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    stateJson: text("state_json").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    assetCount: integer("asset_count").notNull().default(0),
    elementCount: integer("element_count").notNull().default(0),
    thumbnail: text("thumbnail"),
    revision: integer("revision").notNull().default(1),
  },
  (table) => [
    index("idx_projects_workspace_updated").on(
      table.workspaceId,
      table.updatedAt,
    ),
  ],
);
