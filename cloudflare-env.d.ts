declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
    SEARCH_PROVIDER?: string;
    TAVILY_API_KEY?: string;
  }
}
