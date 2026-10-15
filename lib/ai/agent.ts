import type { CompanyCategory } from "../domain/types";
import { and, eq } from "drizzle-orm";
import type { SearchResult } from "../research/types";
import { formatCitations } from "./citations";
import { buildAgentPrompt } from "./prompts";
import { createAgentTools, type AgentCompareInput, type AgentDependencies, type AgentSearchFilters, type FindingInput } from "./tools";
import type { AgentInput, AgentResponse, SavedCompanyContext } from "./types";

export function needsFreshResearch(question: string): boolean {
  return /\b(current|currently|latest|today|right now|recent|new|open roles?|hiring|available|refresh|up[- ]to[- ]date)\b/i.test(question);
}

export function buildSavedDataPrompt(ownerId: string, records: SavedCompanyContext[]): string {
  return `Owner scope: ${ownerId}\nRules: confirmed sponsorship and a potentially qualifying role are different evidence types.\n${JSON.stringify(records, null, 2)}`;
}

function asSavedContext(value: unknown): SavedCompanyContext[] {
  const values = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
  return values.filter((item): item is SavedCompanyContext => Boolean(item && typeof item === "object" && typeof (item as { name?: unknown }).name === "string"));
}

function sourceCitations(results: SearchResult[]) {
  return formatCitations(results.map((result) => ({ url: result.url, title: result.title, checkedAt: result.retrievedAt, confidence: result.hasFullContent ? "medium" : "low", sourceType: result.sourceType })));
}

async function defaultDependencies(): Promise<AgentDependencies & { freshSearch: (ownerId: string, question: string) => Promise<SearchResult[]>; persistConversation?: (ownerId: string, input: AgentInput, response: AgentResponse) => Promise<string> }> {
  const [{ listCompanies, getCompanyDetail }, { getRun }, { refreshExisting, runDiscovery }, providerModule] = await Promise.all([
    import("../repositories/company-repository"),
    import("../repositories/run-repository"),
    import("../research/run-worker"),
    import("../research/tavily-search-provider"),
  ]);
  const provider = providerModule.configuredSearchProvider();
  async function searchSaved(ownerId: string, filters: AgentSearchFilters) {
    const companies = await listCompanies(ownerId, filters as Parameters<typeof listCompanies>[1]);
    const details = await Promise.all(companies.slice(0, 40).map((company) => getCompanyDetail(ownerId, company.id)));
    return details.map((detail, index) => {
      const company = companies[index];
      if (!detail) return company;
      return {
        id: detail.id,
        name: detail.name,
        description: detail.description,
        locality: detail.locality,
        categories: detail.categories,
        permitEvidence: detail.permitEvidence.map((item) => ({ evidenceType: item.evidenceType, statement: item.statement })),
        jobs: detail.jobs.filter((job) => job.status !== "closed").map((job) => ({ title: job.title, location: job.location, url: job.url })),
        contacts: detail.contacts.map((contact) => ({ name: contact.name, role: contact.role, email: contact.email })),
        sources: formatCitations(detail.sources.map((source) => ({ url: source.url, title: source.title, checkedAt: source.checkedAt, confidence: source.status === "ok" ? "medium" : "low", sourceType: source.sourceType }))),
        freshness: detail.freshness,
        confidence: detail.confidence,
      } satisfies SavedCompanyContext;
    });
  }
  return {
    searchCompanies: searchSaved,
    getCompany: (ownerId, companyId) => getCompanyDetail(ownerId, companyId),
    compareCompanies: async (ownerId, companyIds: AgentCompareInput) => Promise.all(companyIds.slice(0, 6).map((companyId) => getCompanyDetail(ownerId, companyId))),
    discover: (ownerId, category) => runDiscovery(ownerId, category),
    refresh: (ownerId, scope) => refreshExisting(ownerId, scope),
    inspectRun: (ownerId, runId) => getRun(ownerId, runId),
    freshSearch: (_ownerId, question) => provider.search({ purpose: "bespoke", query: `${question} County Dublin technology employers`, maxResults: 6 }),
    exportRecords: (ownerId, filters) => listCompanies(ownerId, filters as Parameters<typeof listCompanies>[1]),
    saveFinding: async (ownerId, finding) => saveFindingToDatabase(ownerId, finding),
    persistConversation: async (ownerId, input, response) => persistConversation(ownerId, input, response),
  };
}

async function saveFindingToDatabase(ownerId: string, finding: FindingInput): Promise<{ id: string } | null> {
  if (!finding.companyId) return null;
  const [{ getDb }, schema] = await Promise.all([import("../../db"), import("../../db/schema")]);
  const db = getDb();
  const now = new Date().toISOString();
  const [company] = await db.select({ id: schema.companies.id }).from(schema.companies).where(and(eq(schema.companies.ownerId, ownerId), eq(schema.companies.id, finding.companyId))).limit(1);
  if (!company) return null;
  const sourceId = `src_${crypto.randomUUID()}`;
  const normalizedUrl = finding.source.url.toLowerCase().replace(/#.*$/, "").replace(/\/$/, "");
  await db.insert(schema.sources).values({ id: sourceId, ownerId, companyId: finding.companyId, url: finding.source.url, normalizedUrl, title: finding.source.title, provider: "ai-agent", sourceType: finding.source.sourceType, checkedAt: finding.source.checkedAt ?? now, retrievedAt: finding.source.checkedAt ?? now, status: "ok", createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: [schema.sources.ownerId, schema.sources.normalizedUrl], set: { checkedAt: finding.source.checkedAt ?? now, updatedAt: now } });
  const [source] = await db.select({ id: schema.sources.id }).from(schema.sources).where(and(eq(schema.sources.ownerId, ownerId), eq(schema.sources.normalizedUrl, normalizedUrl))).limit(1);
  const valueJson = JSON.stringify(finding.value);
  const normalizedValue = valueJson.toLowerCase();
  const [existing] = await db.select({ id: schema.companyClaims.id }).from(schema.companyClaims).where(and(eq(schema.companyClaims.ownerId, ownerId), eq(schema.companyClaims.companyId, finding.companyId), eq(schema.companyClaims.field, finding.field), eq(schema.companyClaims.normalizedValue, normalizedValue), eq(schema.companyClaims.status, "current"))).limit(1);
  if (existing) {
    await db.update(schema.companyClaims).set({ valueJson, confidence: finding.confidence, sourceId: source?.id ?? sourceId, checkedAt: finding.source.checkedAt ?? now, updatedAt: now }).where(and(eq(schema.companyClaims.ownerId, ownerId), eq(schema.companyClaims.id, existing.id)));
    return existing;
  }
  const claimId = `claim_${crypto.randomUUID()}`;
  await db.insert(schema.companyClaims).values({ id: claimId, ownerId, companyId: finding.companyId, field: finding.field, valueJson, normalizedValue, confidence: finding.confidence, sourceId: source?.id ?? sourceId, status: "current", checkedAt: finding.source.checkedAt ?? now, createdAt: now, updatedAt: now });
  await db.insert(schema.changeHistory).values({ id: `hist_${crypto.randomUUID()}`, ownerId, companyId: finding.companyId, entityType: "company_claim", entityId: claimId, field: finding.field, nextJson: valueJson, reason: "ai-sourced-finding", createdAt: now, updatedAt: now });
  return { id: claimId };
}

async function persistConversation(ownerId: string, input: AgentInput, response: AgentResponse): Promise<string> {
  const [{ getDb }, schema] = await Promise.all([import("../../db"), import("../../db/schema")]);
  const db = getDb();
  const now = new Date().toISOString();
  let conversationId = input.conversationId ?? `conv_${crypto.randomUUID()}`;
  if (input.conversationId) {
    const [existing] = await db.select({ id: schema.aiConversations.id }).from(schema.aiConversations).where(and(eq(schema.aiConversations.ownerId, ownerId), eq(schema.aiConversations.id, input.conversationId))).limit(1);
    if (!existing) conversationId = `conv_${crypto.randomUUID()}`;
  }
  if (!input.conversationId || conversationId !== input.conversationId) await db.insert(schema.aiConversations).values({ id: conversationId, ownerId, title: input.question.slice(0, 80), model: "gpt-5.6-luna", createdAt: now, updatedAt: now });
  else await db.update(schema.aiConversations).set({ updatedAt: now }).where(and(eq(schema.aiConversations.ownerId, ownerId), eq(schema.aiConversations.id, conversationId)));
  await db.insert(schema.aiMessages).values({ id: `msg_${crypto.randomUUID()}`, ownerId, conversationId, role: "user", content: input.question, citationsJson: "[]", createdAt: now, updatedAt: now });
  await db.insert(schema.aiMessages).values({ id: `msg_${crypto.randomUUID()}`, ownerId, conversationId, role: "assistant", content: response.answer, citationsJson: JSON.stringify(response.citations), createdAt: now, updatedAt: now });
  return conversationId;
}

export async function runResearchAgent(input: AgentInput, ownerId: string, overrides: Partial<AgentDependencies> & { freshSearch?: (ownerId: string, question: string) => Promise<SearchResult[]>; persistConversation?: (ownerId: string, input: AgentInput, response: AgentResponse) => Promise<string> } = {}): Promise<AgentResponse> {
  const defaults = await defaultDependencies();
  const dependencies = { ...defaults, ...overrides };
  const tools = createAgentTools(ownerId, dependencies);
  const savedValue = input.companyId ? await tools.getCompany(input.companyId) : await tools.searchSaved({});
  const savedRecords = asSavedContext(savedValue);
  const freshResearchUsed = needsFreshResearch(input.question) || savedRecords.length === 0;
  const freshResults = freshResearchUsed ? await dependencies.freshSearch(ownerId, input.question) : [];
  const savedCitations = formatCitations(savedRecords.flatMap((record) => record.sources ?? [])).slice(0, 6);
  const freshCitations = sourceCitations(freshResults).slice(0, 6);
  const citations = [...savedCitations, ...freshCitations].slice(0, 8);
  const savedPrompt = buildSavedDataPrompt(ownerId, savedRecords);
  const freshPrompt = freshResults.map((result) => `${result.title}\n${result.url}\n${result.snippet}`).join("\n\n");
  const { askOpenAI } = await import("./client");
  const modelResult = await askOpenAI(buildAgentPrompt(input.question, savedPrompt, freshPrompt));
  const response: AgentResponse = { answer: modelResult.text, citations, savedFindingIds: [], freshResearchUsed };
  if (input.companyId) {
    for (const citation of freshCitations) {
      const saved = await tools.saveFinding({ companyId: input.companyId, field: "ai-research-source", value: { question: input.question, title: citation.title }, confidence: citation.confidence, source: citation });
      if (saved) response.savedFindingIds.push(saved.id);
    }
  }
  if (dependencies.persistConversation) response.conversationId = await dependencies.persistConversation(ownerId, input, response);
  return response;
}

export type { AgentSearchFilters };
export type { CompanyCategory };
