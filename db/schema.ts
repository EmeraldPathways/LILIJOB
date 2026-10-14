import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
};

export const companies = sqliteTable(
  "companies",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    domain: text("domain"),
    website: text("website"),
    aliasesJson: text("aliases_json").notNull().default("[]"),
    description: text("description"),
    locality: text("locality"),
    locationText: text("location_text"),
    employeeBand: text("employee_band"),
    foundedYear: integer("founded_year"),
    headquarters: text("headquarters"),
    enrichmentStatus: text("enrichment_status").notNull().default("queued"),
    lastEnrichedAt: text("last_enriched_at"),
    nextRefreshAt: text("next_refresh_at"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    ...timestamps,
  },
  (table) => ({
    ownerNormalizedName: uniqueIndex("companies_owner_normalized_name_idx").on(
      table.ownerId,
      table.normalizedName,
    ),
    ownerDomain: uniqueIndex("companies_owner_domain_idx").on(table.ownerId, table.domain),
    ownerLocality: index("companies_owner_locality_idx").on(table.ownerId, table.locality),
    ownerFreshness: index("companies_owner_freshness_idx").on(
      table.ownerId,
      table.nextRefreshAt,
    ),
  }),
);

export const companyCategories = sqliteTable(
  "company_categories",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    companyId: text("company_id").notNull(),
    category: text("category").notNull(),
    confidence: text("confidence").notNull().default("medium"),
    sourceId: text("source_id"),
    ...timestamps,
  },
  (table) => ({
    uniqueCompanyCategory: uniqueIndex("company_categories_unique_idx").on(
      table.ownerId,
      table.companyId,
      table.category,
    ),
    categoryIndex: index("company_categories_category_idx").on(table.ownerId, table.category),
  }),
);

export const sources = sqliteTable(
  "sources",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    companyId: text("company_id"),
    url: text("url").notNull(),
    normalizedUrl: text("normalized_url").notNull(),
    title: text("title"),
    snippet: text("snippet"),
    provider: text("provider").notNull(),
    sourceType: text("source_type").notNull().default("search"),
    retrievedAt: text("retrieved_at"),
    checkedAt: text("checked_at"),
    status: text("status").notNull().default("ok"),
    ...timestamps,
  },
  (table) => ({
    ownerNormalizedUrl: uniqueIndex("sources_owner_normalized_url_idx").on(
      table.ownerId,
      table.normalizedUrl,
    ),
    companySource: index("sources_company_idx").on(table.ownerId, table.companyId),
  }),
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    companyId: text("company_id").notNull(),
    title: text("title").notNull(),
    url: text("url"),
    location: text("location"),
    employmentType: text("employment_type"),
    salary: text("salary"),
    postedAt: text("posted_at"),
    status: text("status").notNull().default("open"),
    sourceId: text("source_id"),
    confidence: text("confidence").notNull().default("medium"),
    ...timestamps,
  },
  (table) => ({
    companyJob: uniqueIndex("jobs_company_identity_idx").on(
      table.ownerId,
      table.companyId,
      table.title,
      table.url,
    ),
    jobsByCompany: index("jobs_company_idx").on(table.ownerId, table.companyId),
  }),
);

export const permitEvidence = sqliteTable(
  "permit_evidence",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    companyId: text("company_id").notNull(),
    evidenceType: text("evidence_type").notNull(),
    statement: text("statement").notNull(),
    excerpt: text("excerpt"),
    sourceId: text("source_id"),
    confidence: text("confidence").notNull().default("low"),
    checkedAt: text("checked_at"),
    ...timestamps,
  },
  (table) => ({
    permitByCompany: index("permit_evidence_company_idx").on(table.ownerId, table.companyId),
  }),
);

export const contacts = sqliteTable(
  "contacts",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    companyId: text("company_id").notNull(),
    name: text("name"),
    role: text("role"),
    email: text("email"),
    linkedinUrl: text("linkedin_url"),
    sourceId: text("source_id"),
    confidence: text("confidence").notNull().default("low"),
    ...timestamps,
  },
  (table) => ({
    contactsByCompany: index("contacts_company_idx").on(table.ownerId, table.companyId),
  }),
);

export const companyClaims = sqliteTable(
  "company_claims",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    companyId: text("company_id").notNull(),
    field: text("field").notNull(),
    valueJson: text("value_json").notNull(),
    normalizedValue: text("normalized_value"),
    confidence: text("confidence").notNull().default("low"),
    sourceId: text("source_id"),
    status: text("status").notNull().default("current"),
    checkedAt: text("checked_at"),
    ...timestamps,
  },
  (table) => ({
    claimsByCompany: index("company_claims_company_idx").on(table.ownerId, table.companyId),
    claimsByField: index("company_claims_field_idx").on(
      table.ownerId,
      table.companyId,
      table.field,
    ),
  }),
);

export const changeHistory = sqliteTable(
  "change_history",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    companyId: text("company_id"),
    runId: text("run_id"),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    field: text("field"),
    previousJson: text("previous_json"),
    nextJson: text("next_json"),
    reason: text("reason"),
    ...timestamps,
  },
  (table) => ({
    historyByCompany: index("change_history_company_idx").on(table.ownerId, table.companyId),
    historyByRun: index("change_history_run_idx").on(table.ownerId, table.runId),
  }),
);

export const imports = sqliteTable(
  "imports",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    fileKey: text("file_key"),
    fileName: text("file_name").notNull(),
    fileType: text("file_type").notNull(),
    status: text("status").notNull().default("queued"),
    rowCount: integer("row_count").notNull().default(0),
    acceptedCount: integer("accepted_count").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    errorsJson: text("errors_json").notNull().default("[]"),
    runId: text("run_id"),
    ...timestamps,
  },
  (table) => ({
    importsByOwner: index("imports_owner_idx").on(table.ownerId, table.createdAt),
  }),
);

export const refreshRuns = sqliteTable(
  "refresh_runs",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("queued"),
    category: text("category"),
    companyId: text("company_id"),
    requestedBy: text("requested_by").notNull().default("user"),
    total: integer("total").notNull().default(0),
    processed: integer("processed").notNull().default(0),
    succeeded: integer("succeeded").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    cursor: text("cursor"),
    error: text("error"),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    ...timestamps,
  },
  (table) => ({
    runsByOwner: index("refresh_runs_owner_idx").on(table.ownerId, table.createdAt),
    runsByStatus: index("refresh_runs_status_idx").on(table.ownerId, table.status),
  }),
);

export const aiConversations = sqliteTable(
  "ai_conversations",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull().default("Research assistant"),
    model: text("model").notNull(),
    ...timestamps,
  },
  (table) => ({
    conversationsByOwner: index("ai_conversations_owner_idx").on(table.ownerId, table.updatedAt),
  }),
);

export const aiMessages = sqliteTable(
  "ai_messages",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    citationsJson: text("citations_json").notNull().default("[]"),
    ...timestamps,
  },
  (table) => ({
    messagesByConversation: index("ai_messages_conversation_idx").on(
      table.ownerId,
      table.conversationId,
      table.createdAt,
    ),
  }),
);

export const savedSearches = sqliteTable(
  "saved_searches",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    queryJson: text("query_json").notNull(),
    lastRunAt: text("last_run_at"),
    ...timestamps,
  },
  (table) => ({
    savedSearchesByOwner: index("saved_searches_owner_idx").on(table.ownerId, table.updatedAt),
  }),
);

export const runConfigs = sqliteTable(
  "run_configs",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    newCompaniesPerCategory: integer("new_companies_per_category").notNull().default(25),
    searchesPerCompany: integer("searches_per_company").notNull().default(6),
    existingCompaniesPerRefresh: integer("existing_companies_per_refresh").notNull().default(500),
    paused: integer("paused", { mode: "boolean" }).notNull().default(false),
    continuationCategory: text("continuation_category"),
    providerCalls: integer("provider_calls").notNull().default(0),
    estimatedCostCents: integer("estimated_cost_cents").notNull().default(0),
    lastSuccessfulRunAt: text("last_successful_run_at"),
    ...timestamps,
  },
  (table) => ({
    ownerConfig: uniqueIndex("run_configs_owner_idx").on(table.ownerId),
  }),
);

export const schema = {
  companies,
  companyCategories,
  jobs,
  permitEvidence,
  contacts,
  sources,
  companyClaims,
  changeHistory,
  imports,
  refreshRuns,
  aiConversations,
  aiMessages,
  savedSearches,
  runConfigs,
};
