import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

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

export const elementLibraries = sqliteTable("element_libraries", {
  workspaceId: text("workspace_id").primaryKey(),
  libraryJson: text("library_json").notNull(),
  updatedAt: text("updated_at").notNull(),
  revision: integer("revision").notNull().default(1),
});

export const providerConnections = sqliteTable("provider_connections", {
  workspaceId: text("workspace_id").notNull(),
  provider: text("provider").notNull(),
  clientJson: text("client_json"),
  pendingCiphertext: text("pending_ciphertext"),
  tokenCiphertext: text("token_ciphertext"),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.workspaceId, table.provider] }),
]);
