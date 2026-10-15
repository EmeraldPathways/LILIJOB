CREATE TABLE `email_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`request_id` text NOT NULL,
	`company_id` text NOT NULL,
	`company_name` text NOT NULL,
	`to` text NOT NULL,
	`subject` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`provider_message_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_deliveries_request_recipient_idx` ON `email_deliveries` (`owner_id`,`request_id`,`company_id`);--> statement-breakpoint
CREATE INDEX `email_deliveries_owner_created_idx` ON `email_deliveries` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `gmail_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`google_email` text NOT NULL,
	`encrypted_access_token` text NOT NULL,
	`encrypted_refresh_token` text,
	`access_token_expires_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gmail_connections_owner_idx` ON `gmail_connections` (`owner_id`);--> statement-breakpoint
CREATE TABLE `gmail_oauth_states` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`state_hash` text NOT NULL,
	`pkce_verifier` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gmail_oauth_states_hash_idx` ON `gmail_oauth_states` (`state_hash`);--> statement-breakpoint
CREATE INDEX `gmail_oauth_states_owner_expiry_idx` ON `gmail_oauth_states` (`owner_id`,`expires_at`);