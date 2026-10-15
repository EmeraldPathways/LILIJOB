CREATE TABLE `application_packs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`application_id` text NOT NULL,
	`profile_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`source_url` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`approval_state` text DEFAULT 'draft' NOT NULL,
	`approved_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `application_packs_version_idx` ON `application_packs` (`owner_id`,`application_id`,`version`);--> statement-breakpoint
CREATE INDEX `application_packs_application_idx` ON `application_packs` (`owner_id`,`application_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `sector_pitches` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`profile_id` text,
	`sector` text NOT NULL,
	`company_name` text NOT NULL,
	`role` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sector_pitches_owner_key_version_idx` ON `sector_pitches` (`owner_id`,`sector`,`company_name`,`role`,`version`);--> statement-breakpoint
CREATE INDEX `sector_pitches_owner_recent_idx` ON `sector_pitches` (`owner_id`,`updated_at`);