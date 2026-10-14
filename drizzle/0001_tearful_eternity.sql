CREATE TABLE `run_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`new_companies_per_category` integer DEFAULT 25 NOT NULL,
	`searches_per_company` integer DEFAULT 6 NOT NULL,
	`existing_companies_per_refresh` integer DEFAULT 500 NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`continuation_category` text,
	`provider_calls` integer DEFAULT 0 NOT NULL,
	`estimated_cost_cents` integer DEFAULT 0 NOT NULL,
	`last_successful_run_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_configs_owner_idx` ON `run_configs` (`owner_id`);