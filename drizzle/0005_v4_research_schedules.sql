CREATE TABLE `job_radar_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`company_ids_json` text DEFAULT '[]' NOT NULL,
	`cadence` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`next_run_at` text,
	`cursor_index` integer DEFAULT 0 NOT NULL,
	`last_run_at` text,
	`last_status` text,
	`last_result_json` text DEFAULT '{}' NOT NULL,
	`lease_until` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_radar_schedules_owner_idx` ON `job_radar_schedules` (`owner_id`);--> statement-breakpoint
CREATE INDEX `job_radar_schedules_due_idx` ON `job_radar_schedules` (`enabled`,`next_run_at`,`lease_until`);