declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
    OPENAI_REASONING_EFFORT?: string;
    OPENAI_ENRICHMENT_REASONING_EFFORT?: string;
    AUTOMATIC_RESEARCH_ENABLED?: string;
    SEARCH_PROVIDER?: string;
    TAVILY_API_KEY?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    GOOGLE_REDIRECT_URI?: string;
    GMAIL_TOKEN_ENCRYPTION_KEY?: string;
  }
}
