CREATE TABLE `provider_connections` (
	`workspace_id` text NOT NULL,
	`provider` text NOT NULL,
	`client_json` text,
	`pending_ciphertext` text,
	`token_ciphertext` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `provider`)
);
