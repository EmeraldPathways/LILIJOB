CREATE TABLE `ai_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text DEFAULT 'Research assistant' NOT NULL,
	`model` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_conversations_owner_idx` ON `ai_conversations` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `ai_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`citations_json` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_messages_conversation_idx` ON `ai_messages` (`owner_id`,`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `change_history` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`company_id` text,
	`run_id` text,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`field` text,
	`previous_json` text,
	`next_json` text,
	`reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `change_history_company_idx` ON `change_history` (`owner_id`,`company_id`);--> statement-breakpoint
CREATE INDEX `change_history_run_idx` ON `change_history` (`owner_id`,`run_id`);--> statement-breakpoint
CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`domain` text,
	`website` text,
	`aliases_json` text DEFAULT '[]' NOT NULL,
	`description` text,
	`locality` text,
	`location_text` text,
	`employee_band` text,
	`founded_year` integer,
	`headquarters` text,
	`enrichment_status` text DEFAULT 'queued' NOT NULL,
	`last_enriched_at` text,
	`next_refresh_at` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companies_owner_normalized_name_idx` ON `companies` (`owner_id`,`normalized_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `companies_owner_domain_idx` ON `companies` (`owner_id`,`domain`);--> statement-breakpoint
CREATE INDEX `companies_owner_locality_idx` ON `companies` (`owner_id`,`locality`);--> statement-breakpoint
CREATE INDEX `companies_owner_freshness_idx` ON `companies` (`owner_id`,`next_refresh_at`);--> statement-breakpoint
CREATE TABLE `company_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`company_id` text NOT NULL,
	`category` text NOT NULL,
	`confidence` text DEFAULT 'medium' NOT NULL,
	`source_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `company_categories_unique_idx` ON `company_categories` (`owner_id`,`company_id`,`category`);--> statement-breakpoint
CREATE INDEX `company_categories_category_idx` ON `company_categories` (`owner_id`,`category`);--> statement-breakpoint
CREATE TABLE `company_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`company_id` text NOT NULL,
	`field` text NOT NULL,
	`value_json` text NOT NULL,
	`normalized_value` text,
	`confidence` text DEFAULT 'low' NOT NULL,
	`source_id` text,
	`status` text DEFAULT 'current' NOT NULL,
	`checked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `company_claims_company_idx` ON `company_claims` (`owner_id`,`company_id`);--> statement-breakpoint
CREATE INDEX `company_claims_field_idx` ON `company_claims` (`owner_id`,`company_id`,`field`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`company_id` text NOT NULL,
	`name` text,
	`role` text,
	`email` text,
	`linkedin_url` text,
	`source_id` text,
	`confidence` text DEFAULT 'low' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `contacts_company_idx` ON `contacts` (`owner_id`,`company_id`);--> statement-breakpoint
CREATE TABLE `imports` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`file_key` text,
	`file_name` text NOT NULL,
	`file_type` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`accepted_count` integer DEFAULT 0 NOT NULL,
	`duplicate_count` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`errors_json` text DEFAULT '[]' NOT NULL,
	`run_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `imports_owner_idx` ON `imports` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`company_id` text NOT NULL,
	`title` text NOT NULL,
	`url` text,
	`location` text,
	`employment_type` text,
	`salary` text,
	`posted_at` text,
	`status` text DEFAULT 'open' NOT NULL,
	`source_id` text,
	`confidence` text DEFAULT 'medium' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_company_identity_idx` ON `jobs` (`owner_id`,`company_id`,`title`,`url`);--> statement-breakpoint
CREATE INDEX `jobs_company_idx` ON `jobs` (`owner_id`,`company_id`);--> statement-breakpoint
CREATE TABLE `permit_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`company_id` text NOT NULL,
	`evidence_type` text NOT NULL,
	`statement` text NOT NULL,
	`excerpt` text,
	`source_id` text,
	`confidence` text DEFAULT 'low' NOT NULL,
	`checked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `permit_evidence_company_idx` ON `permit_evidence` (`owner_id`,`company_id`);--> statement-breakpoint
CREATE TABLE `refresh_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`category` text,
	`company_id` text,
	`requested_by` text DEFAULT 'user' NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`processed` integer DEFAULT 0 NOT NULL,
	`succeeded` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`cursor` text,
	`error` text,
	`started_at` text,
	`finished_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `refresh_runs_owner_idx` ON `refresh_runs` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `refresh_runs_status_idx` ON `refresh_runs` (`owner_id`,`status`);--> statement-breakpoint
CREATE TABLE `saved_searches` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`query_json` text NOT NULL,
	`last_run_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `saved_searches_owner_idx` ON `saved_searches` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`company_id` text,
	`url` text NOT NULL,
	`normalized_url` text NOT NULL,
	`title` text,
	`snippet` text,
	`provider` text NOT NULL,
	`source_type` text DEFAULT 'search' NOT NULL,
	`retrieved_at` text,
	`checked_at` text,
	`status` text DEFAULT 'ok' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_owner_normalized_url_idx` ON `sources` (`owner_id`,`normalized_url`);--> statement-breakpoint
CREATE INDEX `sources_company_idx` ON `sources` (`owner_id`,`company_id`);