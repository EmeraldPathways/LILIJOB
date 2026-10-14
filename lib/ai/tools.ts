import type { CompanyCategory } from "../domain/types";
import type { AgentCitation } from "./types";

export type AgentSearchFilters = {
  query?: string;
  category?: CompanyCategory | "all";
  locality?: string | "all";
  status?: string | "all";
};

export type AgentRefreshScope = {
  companyId?: string;
  category?: CompanyCategory | "all";
};

export type FindingInput = {
  companyId?: string;
  field: string;
  value: unknown;
  excerpt?: string;
  confidence: "high" | "medium" | "low";
  source: AgentCitation;
};

export type AgentDependencies = {
  searchCompanies?: (ownerId: string, filters: AgentSearchFilters) => Promise<unknown>;
  getCompany?: (ownerId: string, companyId: string) => Promise<unknown>;
  discover?: (ownerId: string, category: CompanyCategory) => Promise<unknown>;
  refresh?: (ownerId: string, scope: AgentRefreshScope) => Promise<unknown>;
  inspectRun?: (ownerId: string, runId: string) => Promise<unknown>;
  saveFinding?: (ownerId: string, finding: FindingInput) => Promise<{ id: string } | null>;
  exportRecords?: (ownerId: string, filters: AgentSearchFilters) => Promise<unknown>;
};

function missingDependency(name: string): never {
  throw new Error(`AI tool ${name} is not available in this runtime.`);
}

export function createAgentTools(ownerId: string, dependencies: AgentDependencies = {}) {
  return {
    searchSaved: (filters: AgentSearchFilters = {}) => dependencies.searchCompanies?.(ownerId, filters) ?? missingDependency("searchSaved"),
    getCompany: (companyId: string) => dependencies.getCompany?.(ownerId, companyId) ?? missingDependency("getCompany"),
    discover: (category: CompanyCategory) => dependencies.discover?.(ownerId, category) ?? missingDependency("discover"),
    refresh: (scope: AgentRefreshScope = {}) => dependencies.refresh?.(ownerId, scope) ?? missingDependency("refresh"),
    inspectRun: (runId: string) => dependencies.inspectRun?.(ownerId, runId) ?? missingDependency("inspectRun"),
    saveFinding: (finding: FindingInput) => dependencies.saveFinding?.(ownerId, finding) ?? missingDependency("saveFinding"),
    exportRecords: (filters: AgentSearchFilters = {}) => dependencies.exportRecords?.(ownerId, filters) ?? missingDependency("exportRecords"),
  };
}

export type AgentToolSet = ReturnType<typeof createAgentTools>;
