export const COMPANY_CATEGORIES = [
  "work-permit",
  "startups",
  "fintech",
  "e-commerce",
] as const;

export type CompanyCategory = (typeof COMPANY_CATEGORIES)[number];

export const DUBLIN_LOCALITIES = [
  "Dublin City",
  "Fingal",
  "South Dublin",
  "Dún Laoghaire–Rathdown",
] as const;

export type DublinLocality = (typeof DUBLIN_LOCALITIES)[number];

export const PERMIT_EVIDENCE_TYPES = [
  "confirmed-sponsor",
  "potentially-qualifying-role",
  "not-found",
  "conflicting",
] as const;

export type PermitEvidenceType = (typeof PERMIT_EVIDENCE_TYPES)[number];

export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const SOURCE_TYPES = [
  "official-company",
  "official-careers",
  "irish-permit",
  "job-board",
  "news",
  "directory",
  "search",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const RUN_STATUSES = [
  "queued",
  "running",
  "completed",
  "partial",
  "failed",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export interface RawCompanyIdentity {
  companyName: string;
  website?: string | null;
  aliases?: string | string[] | null;
  location?: string | null;
  [key: string]: unknown;
}

export interface NormalizedCompanyIdentity {
  name: string;
  normalizedName: string;
  domain: string | null;
  aliases: string[];
  location: string | null;
  dedupeKey: string;
  original: RawCompanyIdentity;
}
