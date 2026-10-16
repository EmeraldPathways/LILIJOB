declare namespace Cloudflare {
  interface Env {
    ADMIN_IMPORT_TOKEN?: string;
    ADMIN_IMPORT_OWNER_ID?: string;
    ADMIN_IMPORT_SHA256?: string;
    ADMIN_IMPORT_EXPIRES_AT?: string;
    RELEASE_OPERATIONS_TOKEN?: string;
    RELEASE_OPERATIONS_OWNER_ID?: string;
    RELEASE_OPERATIONS_EXPIRES_AT?: string;
    DB?: D1Database;
    BUCKET?: R2Bucket;
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
    OPENAI_REASONING_EFFORT?: string;
    OPENAI_ENRICHMENT_REASONING_EFFORT?: string;
    AUTOMATIC_RESEARCH_ENABLED?: string;
    SEARCH_PROVIDER?: string;
    TAVILY_API_KEY?: string;
    V4_MIGRATION_TOKEN?: string;
    V4_MIGRATION_OWNER_ID?: string;
    V4_JOB_RADAR_SCHEDULE_TOKEN?: string;
    V4_PERMIT_RULE_ADMIN_ID?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    GOOGLE_REDIRECT_URI?: string;
    GMAIL_TOKEN_ENCRYPTION_KEY?: string;
  }
}
