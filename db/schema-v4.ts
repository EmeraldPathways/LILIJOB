import { sql } from "drizzle-orm";
import { AnySQLiteColumn, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const t = {
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
};
const ownerIndex = (name: string, table: { ownerId: AnySQLiteColumn; updatedAt: AnySQLiteColumn }) => ({
  owner: index(`${name}_owner_idx`).on(table.ownerId, table.updatedAt),
});

export const candidateProfiles = sqliteTable("candidate_profiles", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), name: text("name").notNull(),
  targetFamiliesJson: text("target_families_json").notNull().default("[]"), constraintsJson: text("constraints_json").notNull().default("{}"),
  workAuthorizationJson: text("work_authorization_json").notNull().default("{}"), availabilityJson: text("availability_json").notNull().default("{}"),
  weightConfigJson: text("weight_config_json").notNull().default("{}"), isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  approvedVersion: integer("approved_version").notNull().default(1), ...t,
}, (table) => ({ ownerName: uniqueIndex("candidate_profiles_owner_name_idx").on(table.ownerId, table.name), ...ownerIndex("candidate_profiles", table) }));

export const candidateDocuments = sqliteTable("candidate_documents", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), profileId: text("profile_id").notNull(),
  type: text("type").notNull(), originalFilename: text("original_filename").notNull(), objectKey: text("object_key").notNull(),
  parsedText: text("parsed_text"), derivedJson: text("derived_json").notNull().default("{}"), consentStatus: text("consent_status").notNull().default("pending"), approvedAt: text("approved_at"), ...t,
}, (table) => ({ owner: index("candidate_documents_owner_idx").on(table.ownerId, table.profileId), uniqueObject: uniqueIndex("candidate_documents_object_idx").on(table.ownerId, table.objectKey) }));

export const experienceEvidence = sqliteTable("experience_evidence", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), profileId: text("profile_id").notNull(), employer: text("employer"), project: text("project"),
  title: text("title").notNull(), statement: text("statement").notNull(), metric: text("metric"), sourceDocumentId: text("source_document_id"), sourceSpan: text("source_span"), roleRelevance: text("role_relevance"), approved: integer("approved", { mode: "boolean" }).notNull().default(false), ...t,
}, (table) => ownerIndex("experience_evidence", table));

export const jobSnapshots = sqliteTable("job_snapshots", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), jobId: text("job_id").notNull(), contentHash: text("content_hash").notNull(), description: text("description"), payRange: text("pay_range"), currency: text("currency"), requirementsJson: text("requirements_json").notNull().default("[]"), function: text("function"), seniority: text("seniority"), location: text("location"), workModel: text("work_model"), postedAt: text("posted_at"), firstSeenAt: text("first_seen_at").notNull(), lastSeenAt: text("last_seen_at").notNull(), sourceId: text("source_id"), state: text("state").notNull().default("current"), diffJson: text("diff_json").notNull().default("{}"), extractionConfidence: text("extraction_confidence").notNull().default("low"), ...t,
}, (table) => ({ ownerJob: index("job_snapshots_owner_job_idx").on(table.ownerId, table.jobId, table.lastSeenAt), hash: uniqueIndex("job_snapshots_owner_hash_idx").on(table.ownerId, table.jobId, table.contentHash) }));

export const jobDiscoveryRuns = sqliteTable("job_discovery_runs", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), scopeJson: text("scope_json").notNull(), sourcesJson: text("sources_json").notNull().default("[]"), resultCount: integer("result_count").notNull().default(0), apiCostCents: integer("api_cost_cents").notNull().default(0), changesCount: integer("changes_count").notNull().default(0), checkpointJson: text("checkpoint_json").notNull().default("{}"), status: text("status").notNull().default("queued"), error: text("error"), startedAt: text("started_at"), finishedAt: text("finished_at"), ...t,
}, (table) => ownerIndex("job_discovery_runs", table));

export const jobRadarSchedules = sqliteTable("job_radar_schedules", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), companyIdsJson: text("company_ids_json").notNull().default("[]"), cadence: text("cadence").notNull(), enabled: integer("enabled", { mode: "boolean" }).notNull().default(false), nextRunAt: text("next_run_at"), cursorIndex: integer("cursor_index").notNull().default(0), lastRunAt: text("last_run_at"), lastStatus: text("last_status"), lastResultJson: text("last_result_json").notNull().default("{}"), leaseUntil: text("lease_until"), ...t,
}, (table) => ({ uniqueOwner: uniqueIndex("job_radar_schedules_owner_idx").on(table.ownerId), due: index("job_radar_schedules_due_idx").on(table.enabled, table.nextRunAt, table.leaseUntil) }));

export const jobMatches = sqliteTable("job_matches", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), jobId: text("job_id").notNull(), profileId: text("profile_id").notNull(), profileVersion: integer("profile_version").notNull().default(1), scoringConfigVersion: text("scoring_config_version").notNull().default("v5-default-1"), scoringVersion: text("scoring_version").notNull(), score: integer("score").notNull(), confidence: text("confidence").notNull(), dimensionsJson: text("dimensions_json").notNull().default("{}"), hardConstraintsJson: text("hard_constraints_json").notNull().default("{}"), explanationJson: text("explanation_json").notNull().default("{}"), dismissed: integer("dismissed", { mode: "boolean" }).notNull().default(false), starred: integer("starred", { mode: "boolean" }).notNull().default(false), overrideScore: integer("override_score"), overrideReason: text("override_reason"), scoredAt: text("scored_at").notNull(), ...t,
}, (table) => ({ uniqueMatch: uniqueIndex("job_matches_owner_job_profile_version_idx").on(table.ownerId, table.jobId, table.profileId, table.scoringVersion), byScore: index("job_matches_owner_score_idx").on(table.ownerId, table.score) }));

export const companySignals = sqliteTable("company_signals", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), companyId: text("company_id").notNull(), type: text("type").notNull(), summary: text("summary").notNull(), eventDate: text("event_date"), discoveredAt: text("discovered_at").notNull(), sourceId: text("source_id"), relevanceScore: integer("relevance_score"), confidence: text("confidence").notNull().default("low"), verifiedStatus: text("verified_status").notNull().default("unverified"), expiresAt: text("expires_at"), ...t,
}, (table) => ({ byCompany: index("company_signals_company_idx").on(table.ownerId, table.companyId, table.discoveredAt) }));

export const recruitmentContacts = sqliteTable("recruitment_contacts", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), companyId: text("company_id").notNull(), name: text("name"), role: text("role"), department: text("department"), relevanceType: text("relevance_type").notNull().default("unknown"), email: text("email"), linkedinUrl: text("linkedin_url"), sourceUrl: text("source_url"), observedAt: text("observed_at"), verificationStatus: text("verification_status").notNull().default("unverified"), contactType: text("contact_type").notNull().default("unknown"), qualityScore: integer("quality_score"), doNotContact: integer("do_not_contact", { mode: "boolean" }).notNull().default(false), correctionFlag: integer("correction_flag", { mode: "boolean" }).notNull().default(false), ...t,
}, (table) => ({ uniqueContact: uniqueIndex("recruitment_contacts_owner_identity_idx").on(table.ownerId, table.companyId, table.email, table.linkedinUrl), byCompany: index("recruitment_contacts_company_idx").on(table.ownerId, table.companyId) }));

export const applications = sqliteTable("applications", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), jobId: text("job_id"), companyId: text("company_id").notNull(), title: text("title").notNull(), manualUrl: text("manual_url"), stage: text("stage").notNull().default("Target"), cvDocumentId: text("cv_document_id"), channel: text("channel"), appliedAt: text("applied_at"), lastEventAt: text("last_event_at"), followupDueAt: text("followup_due_at"), nextAction: text("next_action"), notes: text("notes"), rejectionReason: text("rejection_reason"), dedupKey: text("dedup_key").notNull(), ...t,
}, (table) => ({ uniqueActive: uniqueIndex("applications_owner_dedup_idx").on(table.ownerId, table.dedupKey), byStage: index("applications_owner_stage_idx").on(table.ownerId, table.stage) }));

export const applicationEvents = sqliteTable("application_events", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), applicationId: text("application_id").notNull(), type: text("type").notNull(), stageFrom: text("stage_from"), stageTo: text("stage_to"), note: text("note"), actor: text("actor").notNull().default("user"), eventAt: text("event_at").notNull(), metadataJson: text("metadata_json").notNull().default("{}"), ...t,
}, (table) => ({ byApplication: index("application_events_app_idx").on(table.ownerId, table.applicationId, table.eventAt) }));

export const outreachDrafts = sqliteTable("outreach_drafts", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), applicationId: text("application_id"), companyId: text("company_id").notNull(), contactId: text("contact_id"), channel: text("channel").notNull().default("gmail"), subject: text("subject").notNull(), body: text("body").notNull(), generationJson: text("generation_json").notNull().default("{}"), attachmentDocumentId: text("attachment_document_id"), revision: integer("revision").notNull().default(1), approvalFingerprint: text("approval_fingerprint"), approvalState: text("approval_state").notNull().default("draft"), approvedAt: text("approved_at"), ...t,
}, (table) => ownerIndex("outreach_drafts", table));

export const outreachEvents = sqliteTable("outreach_events", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), draftId: text("draft_id").notNull(), applicationId: text("application_id"), providerMessageId: text("provider_message_id"), threadId: text("thread_id"), sendState: text("send_state").notNull(), error: text("error"), dedupKey: text("dedup_key").notNull(), payloadFingerprint: text("payload_fingerprint"), responseCategory: text("response_category"), approvedBy: text("approved_by"), approvedAt: text("approved_at"), sentAt: text("sent_at"), ...t,
}, (table) => ({ uniqueSend: uniqueIndex("outreach_events_owner_dedup_idx").on(table.ownerId, table.dedupKey), byDraft: index("outreach_events_draft_idx").on(table.ownerId, table.draftId) }));

export const applicationPacks = sqliteTable("application_packs", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), applicationId: text("application_id").notNull(), profileId: text("profile_id"), version: integer("version").notNull().default(1), sourceUrl: text("source_url").notNull(), payloadJson: text("payload_json").notNull().default("{}"), approvalState: text("approval_state").notNull().default("draft"), approvedAt: text("approved_at"), ...t,
}, (table) => ({ uniqueVersion: uniqueIndex("application_packs_version_idx").on(table.ownerId, table.applicationId, table.version), byApplication: index("application_packs_application_idx").on(table.ownerId, table.applicationId, table.updatedAt) }));

export const sectorPitches = sqliteTable("sector_pitches", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), profileId: text("profile_id"), sector: text("sector").notNull(), companyName: text("company_name").notNull(), role: text("role").notNull(), payloadJson: text("payload_json").notNull().default("{}"), version: integer("version").notNull().default(1), ...t,
}, (table) => ({ ownerVersion: uniqueIndex("sector_pitches_owner_key_version_idx").on(table.ownerId, table.sector, table.companyName, table.role, table.version), ownerRecent: index("sector_pitches_owner_recent_idx").on(table.ownerId, table.updatedAt) }));

export const interviews = sqliteTable("interviews", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), applicationId: text("application_id").notNull(), round: text("round").notNull(), scheduledAt: text("scheduled_at"), timezone: text("timezone").notNull().default("Europe/Dublin"), format: text("format"), location: text("location"), interviewerInfoJson: text("interviewer_info_json").notNull().default("{}"), prepStatus: text("prep_status").notNull().default("not-started"), outcome: text("outcome"), notes: text("notes"), nextSteps: text("next_steps"), ...t,
}, (table) => ({ byDate: index("interviews_owner_date_idx").on(table.ownerId, table.scheduledAt) }));

export const interviewPacks = sqliteTable("interview_packs", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), interviewId: text("interview_id").notNull(), version: integer("version").notNull().default(1), sectionsJson: text("sections_json").notNull().default("{}"), sourceMetaJson: text("source_meta_json").notNull().default("{}"), model: text("model"), generatedAt: text("generated_at").notNull(), approvedAt: text("approved_at"), ...t,
}, (table) => ({ uniqueVersion: uniqueIndex("interview_packs_version_idx").on(table.ownerId, table.interviewId, table.version) }));

export const dailyActionItems = sqliteTable("daily_action_items", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), type: text("type").notNull(), priority: integer("priority").notNull().default(50), companyId: text("company_id"), jobId: text("job_id"), applicationId: text("application_id"), interviewId: text("interview_id"), reason: text("reason").notNull(), dueAt: text("due_at"), status: text("status").notNull().default("open"), dedupKey: text("dedup_key").notNull(), ...t,
}, (table) => ({ uniqueAction: uniqueIndex("daily_action_items_owner_dedup_idx").on(table.ownerId, table.dedupKey), byStatus: index("daily_action_items_owner_status_idx").on(table.ownerId, table.status, table.priority) }));

export const jobSearchMetricsDaily = sqliteTable("job_search_metrics_daily", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), metricDate: text("metric_date").notNull(), countsJson: text("counts_json").notNull().default("{}"), ...t,
}, (table) => ({ uniqueDate: uniqueIndex("job_search_metrics_owner_date_idx").on(table.ownerId, table.metricDate) }));

export const notificationPreferences = sqliteTable("notification_preferences", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), timezone: text("timezone").notNull().default("Europe/Dublin"), digestEnabled: integer("digest_enabled", { mode: "boolean" }).notNull().default(false), quietStart: text("quiet_start"), quietEnd: text("quiet_end"), cadenceJson: text("cadence_json").notNull().default("{}"), consent: integer("consent", { mode: "boolean" }).notNull().default(false), ...t,
}, (table) => ({ uniqueOwner: uniqueIndex("notification_preferences_owner_idx").on(table.ownerId) }));

export const userActivityAudit = sqliteTable("user_activity_audit", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), actor: text("actor").notNull(), action: text("action").notNull(), entityType: text("entity_type"), entityId: text("entity_id"), detailsJson: text("details_json").notNull().default("{}"), redactedAt: text("redacted_at"), ...t,
}, (table) => ({ byOwner: index("user_activity_audit_owner_idx").on(table.ownerId, table.createdAt) }));

export const agentRuns = sqliteTable("agent_runs", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), request: text("request").notNull(), scopeJson: text("scope_json").notNull().default("{}"), authorisedToolsJson: text("authorised_tools_json").notNull().default("[]"), status: text("status").notNull().default("queued"), checkpointJson: text("checkpoint_json").notNull().default("{}"), budgetJson: text("budget_json").notNull().default("{}"), costJson: text("cost_json").notNull().default("{}"), summary: text("summary"), error: text("error"), startedAt: text("started_at"), finishedAt: text("finished_at"), ...t,
}, (table) => ownerIndex("agent_runs", table));

export const agentSteps = sqliteTable("agent_steps", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), runId: text("run_id").notNull(), stepIndex: integer("step_index").notNull(), tool: text("tool").notNull(), status: text("status").notNull().default("queued"), inputJson: text("input_json").notNull().default("{}"), outputJson: text("output_json").notNull().default("{}"), evidenceJson: text("evidence_json").notNull().default("[]"), costCents: integer("cost_cents").notNull().default(0), error: text("error"), startedAt: text("started_at"), finishedAt: text("finished_at"), ...t,
}, (table) => ({ uniqueStep: uniqueIndex("agent_steps_run_index_idx").on(table.ownerId, table.runId, table.stepIndex) }));

export const settingsVersions = sqliteTable("settings_versions", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), namespace: text("namespace").notNull(), version: integer("version").notNull(), settingsJson: text("settings_json").notNull(), createdBy: text("created_by").notNull(), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({ uniqueVersion: uniqueIndex("settings_versions_owner_namespace_version_idx").on(table.ownerId, table.namespace, table.version) }));

export const providerUsageEvents = sqliteTable("provider_usage_events", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), operationId: text("operation_id").notNull(), runId: text("run_id"), stepId: text("step_id"), attemptId: text("attempt_id").notNull(), provider: text("provider").notNull(), model: text("model"), status: text("status").notNull(), inputTokens: integer("input_tokens"), outputTokens: integer("output_tokens"), reasoningTokens: integer("reasoning_tokens"), cachedTokens: integer("cached_tokens"), searchUnits: integer("search_units"), priceVersion: text("price_version"), estimatedCostMinor: integer("estimated_cost_minor"), measuredCostMinor: integer("measured_cost_minor"), currency: text("currency").notNull().default("EUR"), metadataJson: text("metadata_json").notNull().default("{}"), observedAt: text("observed_at").notNull(), ...t,
}, (table) => ({ uniqueAttempt: uniqueIndex("provider_usage_owner_attempt_idx").on(table.ownerId, table.attemptId), byOwner: index("provider_usage_owner_observed_idx").on(table.ownerId, table.observedAt) }));

export const usageBudgets = sqliteTable("usage_budgets", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), scope: text("scope").notNull(), periodKey: text("period_key").notNull(), ceilingMinor: integer("ceiling_minor").notNull(), reservedMinor: integer("reserved_minor").notNull().default(0), usedMinor: integer("used_minor").notNull().default(0), currency: text("currency").notNull().default("EUR"), ...t,
}, (table) => ({ uniquePeriod: uniqueIndex("usage_budgets_owner_scope_period_idx").on(table.ownerId, table.scope, table.periodKey), byOwner: index("usage_budgets_owner_idx").on(table.ownerId, table.periodKey) }));

export const usageReservations = sqliteTable("usage_reservations", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), operationId: text("operation_id").notNull(), scope: text("scope").notNull(), periodKey: text("period_key").notNull(), amountMinor: integer("amount_minor").notNull(), status: text("status").notNull().default("reserved"), ...t,
}, (table) => ({ uniqueOperation: uniqueIndex("usage_reservations_owner_operation_idx").on(table.ownerId, table.operationId), byBudget: index("usage_reservations_budget_idx").on(table.ownerId, table.scope, table.periodKey) }));

export const scheduledTaskRuns = sqliteTable("scheduled_task_runs", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), scheduleId: text("schedule_id").notNull(), dueSlot: text("due_slot").notNull(), scopeVersion: text("scope_version").notNull(), checkpointJson: text("checkpoint_json").notNull().default("{}"), leaseUntil: text("lease_until"), status: text("status").notNull().default("queued"), attempts: integer("attempts").notNull().default(0), error: text("error"), startedAt: text("started_at"), finishedAt: text("finished_at"), ...t,
}, (table) => ({ uniqueSlot: uniqueIndex("scheduled_task_runs_owner_slot_idx").on(table.ownerId, table.scheduleId, table.dueSlot), due: index("scheduled_task_runs_due_idx").on(table.status, table.dueSlot, table.leaseUntil) }));

export const notificationEvents = sqliteTable("notification_events", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), dedupKey: text("dedup_key").notNull(), type: text("type").notNull(), sourceEntityId: text("source_entity_id"), sourceVersion: text("source_version"), severity: text("severity").notNull().default("info"), state: text("state").notNull().default("open"), payloadJson: text("payload_json").notNull().default("{}"), dueAt: text("due_at"), readAt: text("read_at"), dismissedAt: text("dismissed_at"), ...t,
}, (table) => ({ uniqueEvent: uniqueIndex("notification_events_owner_dedup_idx").on(table.ownerId, table.dedupKey), byOwner: index("notification_events_owner_state_idx").on(table.ownerId, table.state, table.createdAt) }));

export const cvEditProposals = sqliteTable("cv_edit_proposals", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), applicationId: text("application_id"), profileId: text("profile_id").notNull(), masterDocumentId: text("master_document_id").notNull(), jobSnapshotId: text("job_snapshot_id"), baseProfileVersion: integer("base_profile_version").notNull(), proposalVersion: integer("proposal_version").notNull(), status: text("status").notNull().default("draft"), changesJson: text("changes_json").notNull().default("[]"), warningsJson: text("warnings_json").notNull().default("[]"), artifactDocumentId: text("artifact_document_id"), ...t,
}, (table) => ({ uniqueVersion: uniqueIndex("cv_edit_proposals_owner_version_idx").on(table.ownerId, table.profileId, table.masterDocumentId, table.proposalVersion), byApplication: index("cv_edit_proposals_application_idx").on(table.ownerId, table.applicationId, table.updatedAt) }));

export const outreachAttachments = sqliteTable("outreach_attachments", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), draftId: text("draft_id").notNull(), documentId: text("document_id").notNull(), objectKey: text("object_key").notNull(), sha256: text("sha256").notNull(), filename: text("filename").notNull(), mimeType: text("mime_type").notNull(), bytes: integer("bytes").notNull(), approvalFingerprint: text("approval_fingerprint"), ...t,
}, (table) => ({ byDraft: index("outreach_attachments_draft_idx").on(table.ownerId, table.draftId), uniqueDocument: uniqueIndex("outreach_attachments_document_idx").on(table.ownerId, table.draftId, table.documentId) }));

export const applicationTasks = sqliteTable("application_tasks", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), applicationId: text("application_id").notNull(), type: text("type").notNull(), reason: text("reason").notNull(), dueAt: text("due_at"), status: text("status").notNull().default("open"), snoozedUntil: text("snoozed_until"), dedupKey: text("dedup_key").notNull(), ...t,
}, (table) => ({ uniqueTask: uniqueIndex("application_tasks_owner_dedup_idx").on(table.ownerId, table.dedupKey), byDue: index("application_tasks_owner_due_idx").on(table.ownerId, table.status, table.dueAt) }));

export const candidateWorkPermissions = sqliteTable("candidate_work_permissions", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), profileId: text("profile_id").notNull(), permissionType: text("permission_type").notNull(), effectiveFrom: text("effective_from").notNull(), effectiveTo: text("effective_to"), weeklyHours: integer("weekly_hours"), conditionsJson: text("conditions_json").notNull().default("[]"), evidenceJson: text("evidence_json").notNull().default("[]"), confirmationStatus: text("confirmation_status").notNull().default("unconfirmed"), ...t,
}, (table) => ({ byProfile: index("candidate_work_permissions_profile_idx").on(table.ownerId, table.profileId, table.effectiveFrom) }));

export const pitchUsages = sqliteTable("pitch_usages", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), pitchId: text("pitch_id").notNull(), applicationId: text("application_id"), outreachDraftId: text("outreach_draft_id"), variant: text("variant").notNull(), outcome: text("outcome"), recordedAt: text("recorded_at").notNull(), ...t,
}, (table) => ({ byPitch: index("pitch_usages_owner_pitch_idx").on(table.ownerId, table.pitchId, table.recordedAt) }));

export const permitRules = sqliteTable("permit_rules", {
  id: text("id").primaryKey(), ruleSet: text("rule_set").notNull(), effectiveFrom: text("effective_from").notNull(), effectiveTo: text("effective_to"), sourceUrl: text("source_url").notNull(), title: text("title").notNull(), rulesJson: text("rules_json").notNull(), checkedAt: text("checked_at").notNull(), ...t,
}, (table) => ({ uniqueRule: uniqueIndex("permit_rules_set_effective_idx").on(table.ruleSet, table.effectiveFrom) }));

export const permitEvaluations = sqliteTable("permit_evaluations", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), companyId: text("company_id").notNull(), jobId: text("job_id"), ruleId: text("rule_id"), status: text("status").notNull(), labelsJson: text("labels_json").notNull().default("[]"), inputsJson: text("inputs_json").notNull().default("{}"), explanation: text("explanation").notNull(), sourceUrl: text("source_url"), evaluatedAt: text("evaluated_at").notNull(), ...t,
}, (table) => ({ byCompany: index("permit_evaluations_company_idx").on(table.ownerId, table.companyId, table.evaluatedAt) }));

export const v4Tables = { candidateProfiles, candidateDocuments, experienceEvidence, jobSnapshots, jobDiscoveryRuns, jobRadarSchedules, jobMatches, companySignals, recruitmentContacts, applications, applicationEvents, outreachDrafts, outreachEvents, applicationPacks, sectorPitches, interviews, interviewPacks, dailyActionItems, jobSearchMetricsDaily, notificationPreferences, userActivityAudit, agentRuns, agentSteps, settingsVersions, permitRules, permitEvaluations, providerUsageEvents, usageBudgets, usageReservations, scheduledTaskRuns, notificationEvents, cvEditProposals, outreachAttachments, applicationTasks, candidateWorkPermissions, pitchUsages };
export type V4Tables = typeof v4Tables;
