import type { ConfidenceLevel, CompanyCategory, SourceType } from "../domain/types";
import type { UsageContext } from "../v5/usage/provider";

export type SearchPurpose =
  | "official-profile"
  | "careers"
  | "open-roles"
  | "permit-evidence"
  | "dublin-locality"
  | "category-evidence"
  | "bespoke";

export type SearchRequest = {
  query: string;
  purpose: SearchPurpose;
  maxResults?: number;
  usage?: UsageContext;
};

export type SearchResult = {
  url: string;
  title: string;
  snippet: string;
  content?: string;
  provider: string;
  retrievedAt: string;
  sourceType?: SourceType;
  hasFullContent?: boolean;
  status?: "ok" | "timeout" | "rate-limited" | "malformed" | "error";
};

export type ResearchCompanySeed = {
  name: string;
  domain?: string | null;
  website?: string | null;
  description?: string | null;
  locality?: string | null;
  location?: string | null;
  headquarters?: string | null;
  employeeBand?: string | null;
  foundedYear?: number | null;
  category?: CompanyCategory | null;
};

export type ClaimSource = {
  url: string;
  title: string;
  sourceType: SourceType;
  provider: string;
  retrievedAt: string;
  hasFullContent: boolean;
};

export type ExtractedClaim = {
  field: string;
  value: unknown;
  normalizedValue: string;
  confidence: ConfidenceLevel;
  source: ClaimSource;
  excerpt: string;
};

export type ExistingClaim = ExtractedClaim & {
  id?: string;
  sourceId?: string | null;
  status?: string;
  checkedAt?: string | null;
};

export type ClaimChange = {
  field: string;
  previous: unknown;
  next: unknown;
  runId: string;
  reason: string;
};

export type ClaimConflict = {
  field: string;
  values: unknown[];
  runId: string;
};

export type MergeResult = {
  current: ExistingClaim[];
  changes: ClaimChange[];
  conflicts: ClaimConflict[];
};

export type DiscoveryLimits = {
  newCompaniesPerCategory: number;
  searchesPerCompany: number;
  existingCompaniesPerRefresh: number;
};

export type EnrichmentSummary = {
  companyId: string;
  runId: string;
  sourcesChecked: number;
  claimsAdded: number;
  jobsFound: number;
  contactsFound: number;
  permitEvidenceFound: number;
  status: "completed" | "partial" | "failed";
  error?: string;
};
