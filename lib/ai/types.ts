import type { CompanyCategory, ConfidenceLevel, SourceType } from "../domain/types";

export type AgentCitation = {
  url: string;
  title: string;
  checkedAt: string | null;
  confidence: ConfidenceLevel;
  sourceType: SourceType;
};

export type AgentInput = {
  question: string;
  companyId?: string | null;
  conversationId?: string | null;
};

export type AgentResponse = {
  answer: string;
  citations: AgentCitation[];
  conversationId?: string;
  savedFindingIds: string[];
  freshResearchUsed: boolean;
};

export type SavedPermitEvidence = {
  evidenceType: string;
  statement: string;
};

export type SavedCompanyContext = {
  id?: string;
  name: string;
  description?: string | null;
  locality?: string | null;
  categories?: CompanyCategory[];
  permitEvidence?: SavedPermitEvidence[];
  jobs?: Array<{ title: string; location?: string | null; url?: string | null }>;
  contacts?: Array<{ name?: string | null; role?: string | null; email?: string | null }>;
  sources?: AgentCitation[];
  freshness?: string;
  confidence?: ConfidenceLevel | null;
};
