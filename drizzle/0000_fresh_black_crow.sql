CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`state_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`asset_count` integer DEFAULT 0 NOT NULL,
	`element_count` integer DEFAULT 0 NOT NULL,
	`thumbnail` text,
	`revision` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_projects_workspace_updated` ON `projects` (`workspace_id`,`updated_at`);