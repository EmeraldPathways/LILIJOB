import type {
  CompanyCategory,
  DublinLocality,
  PermitEvidenceType,
} from "./types";

export const CATEGORY_LABELS: Record<CompanyCategory, string> = {
  "work-permit": "Work Permit Companies",
  startups: "Startups",
  fintech: "Fintech",
  "e-commerce": "E-commerce",
};

export const DUBLIN_LOCALITY_LABELS: Record<DublinLocality, string> = {
  "Dublin City": "Dublin City",
  Fingal: "Fingal",
  "South Dublin": "South Dublin",
  "Dún Laoghaire–Rathdown": "Dún Laoghaire–Rathdown",
};

export const PERMIT_EVIDENCE_LABELS: Record<PermitEvidenceType, string> = {
  "confirmed-sponsor": "Confirmed sponsorship",
  "potentially-qualifying-role": "Potentially qualifying role",
  "not-found": "No evidence found",
  conflicting: "Conflicting evidence",
};

export const DEFAULT_DISCOVERY_LIMITS = {
  newCompaniesPerCategory: 25,
  searchesPerCompany: 6,
  existingCompaniesPerRefresh: 500,
} as const;
