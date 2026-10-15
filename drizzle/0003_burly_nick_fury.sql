CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`request` text NOT NULL,
	`scope_json` text DEFAULT '{}' NOT NULL,
	`authorised_tools_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`checkpoint_json` text DEFAULT '{}' NOT NULL,
	`budget_json` text DEFAULT '{}' NOT NULL,
	`cost_json` text DEFAULT '{}' NOT NULL,
	`summary` text,
	`error` text,
	`started_at` text,
	`finished_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_runs_owner_idx` ON `agent_runs` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `agent_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`run_id` text NOT NULL,
	`step_index` integer NOT NULL,
	`tool` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`input_json` text DEFAULT '{}' NOT NULL,
	`output_json` text DEFAULT '{}' NOT NULL,
	`evidence_json` text DEFAULT '[]' NOT NULL,
	`cost_cents` integer DEFAULT 0 NOT NULL,
	`error` text,
	`started_at` text,
	`finished_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_steps_run_index_idx` ON `agent_steps` (`owner_id`,`run_id`,`step_index`);--> statement-breakpoint
CREATE TABLE `application_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`application_id` text NOT NULL,
	`type` text NOT NULL,
	`stage_from` text,
	`stage_to` text,
	`note` text,
	`actor` text DEFAULT 'user' NOT NULL,
	`event_at` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `application_events_app_idx` ON `application_events` (`owner_id`,`application_id`,`event_at`);--> statement-breakpoint
CREATE TABLE `applications` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`job_id` text,
	`company_id` text NOT NULL,
	`title` text NOT NULL,
	`manual_url` text,
	`stage` text DEFAULT 'Target' NOT NULL,
	`cv_document_id` text,
	`channel` text,
	`applied_at` text,
	`last_event_at` text,
	`followup_due_at` text,
	`next_action` text,
	`notes` text,
	`rejection_reason` text,
	`dedup_key` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `applications_owner_dedup_idx` ON `applications` (`owner_id`,`dedup_key`);--> statement-breakpoint
CREATE INDEX `applications_owner_stage_idx` ON `applications` (`owner_id`,`stage`);--> statement-breakpoint
CREATE TABLE `candidate_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`type` text NOT NULL,
	`original_filename` text NOT NULL,
	`object_key` text NOT NULL,
	`parsed_text` text,
	`derived_json` text DEFAULT '{}' NOT NULL,
	`consent_status` text DEFAULT 'pending' NOT NULL,
	`approved_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `candidate_documents_owner_idx` ON `candidate_documents` (`owner_id`,`profile_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `candidate_documents_object_idx` ON `candidate_documents` (`owner_id`,`object_key`);--> statement-breakpoint
CREATE TABLE `candidate_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`target_families_json` text DEFAULT '[]' NOT NULL,
	`constraints_json` text DEFAULT '{}' NOT NULL,
	`work_authorization_json` text DEFAULT '{}' NOT NULL,
	`availability_json` text DEFAULT '{}' NOT NULL,
	`weight_config_json` text DEFAULT '{}' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`approved_version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `candidate_profiles_owner_name_idx` ON `candidate_profiles` (`owner_id`,`name`);--> statement-breakpoint
CREATE INDEX `candidate_profiles_owner_idx` ON `candidate_profiles` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `company_signals` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`company_id` text NOT NULL,
	`type` text NOT NULL,
	`summary` text NOT NULL,
	`event_date` text,
	`discovered_at` text NOT NULL,
	`source_id` text,
	`relevance_score` integer,
	`confidence` text DEFAULT 'low' NOT NULL,
	`verified_status` text DEFAULT 'unverified' NOT NULL,
	`expires_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `company_signals_company_idx` ON `company_signals` (`owner_id`,`company_id`,`discovered_at`);--> statement-breakpoint
CREATE TABLE `daily_action_items` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`type` text NOT NULL,
	`priority` integer DEFAULT 50 NOT NULL,
	`company_id` text,
	`job_id` text,
	`application_id` text,
	`interview_id` text,
	`reason` text NOT NULL,
	`due_at` text,
	`status` text DEFAULT 'open' NOT NULL,
	`dedup_key` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_action_items_owner_dedup_idx` ON `daily_action_items` (`owner_id`,`dedup_key`);--> statement-breakpoint
CREATE INDEX `daily_action_items_owner_status_idx` ON `daily_action_items` (`owner_id`,`status`,`priority`);--> statement-breakpoint
CREATE TABLE `experience_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`employer` text,
	`project` text,
	`title` text NOT NULL,
	`statement` text NOT NULL,
	`metric` text,
	`source_document_id` text,
	`source_span` text,
	`role_relevance` text,
	`approved` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `experience_evidence_owner_idx` ON `experience_evidence` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `interview_packs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`interview_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`sections_json` text DEFAULT '{}' NOT NULL,
	`source_meta_json` text DEFAULT '{}' NOT NULL,
	`model` text,
	`generated_at` text NOT NULL,
	`approved_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `interview_packs_version_idx` ON `interview_packs` (`owner_id`,`interview_id`,`version`);--> statement-breakpoint
CREATE TABLE `interviews` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`application_id` text NOT NULL,
	`round` text NOT NULL,
	`scheduled_at` text,
	`timezone` text DEFAULT 'Europe/Dublin' NOT NULL,
	`format` text,
	`location` text,
	`interviewer_info_json` text DEFAULT '{}' NOT NULL,
	`prep_status` text DEFAULT 'not-started' NOT NULL,
	`outcome` text,
	`notes` text,
	`next_steps` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `interviews_owner_date_idx` ON `interviews` (`owner_id`,`scheduled_at`);--> statement-breakpoint
CREATE TABLE `job_discovery_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`scope_json` text NOT NULL,
	`sources_json` text DEFAULT '[]' NOT NULL,
	`result_count` integer DEFAULT 0 NOT NULL,
	`api_cost_cents` integer DEFAULT 0 NOT NULL,
	`changes_count` integer DEFAULT 0 NOT NULL,
	`checkpoint_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`error` text,
	`started_at` text,
	`finished_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `job_discovery_runs_owner_idx` ON `job_discovery_runs` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `job_matches` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`job_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`scoring_version` text NOT NULL,
	`score` integer NOT NULL,
	`confidence` text NOT NULL,
	`dimensions_json` text DEFAULT '{}' NOT NULL,
	`hard_constraints_json` text DEFAULT '{}' NOT NULL,
	`explanation_json` text DEFAULT '{}' NOT NULL,
	`dismissed` integer DEFAULT false NOT NULL,
	`starred` integer DEFAULT false NOT NULL,
	`override_score` integer,
	`override_reason` text,
	`scored_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_matches_owner_job_profile_version_idx` ON `job_matches` (`owner_id`,`job_id`,`profile_id`,`scoring_version`);--> statement-breakpoint
CREATE INDEX `job_matches_owner_score_idx` ON `job_matches` (`owner_id`,`score`);--> statement-breakpoint
CREATE TABLE `job_search_metrics_daily` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`metric_date` text NOT NULL,
	`counts_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_search_metrics_owner_date_idx` ON `job_search_metrics_daily` (`owner_id`,`metric_date`);--> statement-breakpoint
CREATE TABLE `job_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`job_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`description` text,
	`pay_range` text,
	`currency` text,
	`requirements_json` text DEFAULT '[]' NOT NULL,
	`function` text,
	`seniority` text,
	`location` text,
	`work_model` text,
	`posted_at` text,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`source_id` text,
	`state` text DEFAULT 'current' NOT NULL,
	`diff_json` text DEFAULT '{}' NOT NULL,
	`extraction_confidence` text DEFAULT 'low' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `job_snapshots_owner_job_idx` ON `job_snapshots` (`owner_id`,`job_id`,`last_seen_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `job_snapshots_owner_hash_idx` ON `job_snapshots` (`owner_id`,`job_id`,`content_hash`);--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`timezone` text DEFAULT 'Europe/Dublin' NOT NULL,
	`digest_enabled` integer DEFAULT false NOT NULL,
	`quiet_start` text,
	`quiet_end` text,
	`cadence_json` text DEFAULT '{}' NOT NULL,
	`consent` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_preferences_owner_idx` ON `notification_preferences` (`owner_id`);--> statement-breakpoint
CREATE TABLE `outreach_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`application_id` text,
	`company_id` text NOT NULL,
	`contact_id` text,
	`channel` text DEFAULT 'gmail' NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`generation_json` text DEFAULT '{}' NOT NULL,
	`attachment_document_id` text,
	`approval_state` text DEFAULT 'draft' NOT NULL,
	`approved_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `outreach_drafts_owner_idx` ON `outreach_drafts` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `outreach_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`draft_id` text NOT NULL,
	`application_id` text,
	`provider_message_id` text,
	`thread_id` text,
	`send_state` text NOT NULL,
	`error` text,
	`dedup_key` text NOT NULL,
	`response_category` text,
	`approved_by` text,
	`approved_at` text,
	`sent_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outreach_events_owner_dedup_idx` ON `outreach_events` (`owner_id`,`dedup_key`);--> statement-breakpoint
CREATE INDEX `outreach_events_draft_idx` ON `outreach_events` (`owner_id`,`draft_id`);--> statement-breakpoint
CREATE TABLE `permit_evaluations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`company_id` text NOT NULL,
	`job_id` text,
	`rule_id` text,
	`status` text NOT NULL,
	`labels_json` text DEFAULT '[]' NOT NULL,
	`inputs_json` text DEFAULT '{}' NOT NULL,
	`explanation` text NOT NULL,
	`source_url` text,
	`evaluated_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `permit_evaluations_company_idx` ON `permit_evaluations` (`owner_id`,`company_id`,`evaluated_at`);--> statement-breakpoint
CREATE TABLE `permit_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_set` text NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`source_url` text NOT NULL,
	`title` text NOT NULL,
	`rules_json` text NOT NULL,
	`checked_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `permit_rules_set_effective_idx` ON `permit_rules` (`rule_set`,`effective_from`);--> statement-breakpoint
CREATE TABLE `recruitment_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`company_id` text NOT NULL,
	`name` text,
	`role` text,
	`department` text,
	`relevance_type` text DEFAULT 'unknown' NOT NULL,
	`email` text,
	`linkedin_url` text,
	`source_url` text,
	`observed_at` text,
	`verification_status` text DEFAULT 'unverified' NOT NULL,
	`contact_type` text DEFAULT 'unknown' NOT NULL,
	`quality_score` integer,
	`do_not_contact` integer DEFAULT false NOT NULL,
	`correction_flag` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recruitment_contacts_owner_identity_idx` ON `recruitment_contacts` (`owner_id`,`company_id`,`email`,`linkedin_url`);--> statement-breakpoint
CREATE INDEX `recruitment_contacts_company_idx` ON `recruitment_contacts` (`owner_id`,`company_id`);--> statement-breakpoint
CREATE TABLE `settings_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`namespace` text NOT NULL,
	`version` integer NOT NULL,
	`settings_json` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settings_versions_owner_namespace_version_idx` ON `settings_versions` (`owner_id`,`namespace`,`version`);--> statement-breakpoint
CREATE TABLE `user_activity_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`details_json` text DEFAULT '{}' NOT NULL,
	`redacted_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `user_activity_audit_owner_idx` ON `user_activity_audit` (`owner_id`,`created_at`);