CREATE TABLE `element_libraries` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`library_json` text NOT NULL,
	`updated_at` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL
);
