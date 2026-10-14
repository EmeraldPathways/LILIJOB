import type { CompanyCategory } from "../domain/types";
import { and, eq } from "drizzle-orm";
import type { SearchResult } from "../research/types";
import { formatCitations } from "./citations";
import { buildAgentPrompt } from "./prompts";
import { createAgentTools, type AgentDependencies, type AgentSearchFilters, type FindingInput } from "./tools";
import type { AgentInput, AgentResponse, SavedCompanyContext } from "./types";

export function needsFreshResearch(question: string): boolean {
  return /\b(current|currently|latest|today|right now|recent|new|open roles?|hiring|available|refresh|up[- ]to[- ]date)\b/i.test(question);
}

export function buildSavedDataPrompt(ownerId: string, records: SavedCompanyContext[]): string {
  return `Owner scope: ${ownerId}\nRules: confirmed sponsorship and a potentially qualifying role are different evidence types.\n${JSON.stringify(records, null, 2)}`;
}

function asSavedContext(value: unknown): SavedCompanyContext[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is SavedCompanyContext => Boolean(item && typeof item === "object" && typeof (item as { name?: unknown }).name === "string"));
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
  return {
    searchCompanies: (ownerId, filters) => listCompanies(ownerId, filters as Parameters<typeof listCompanies>[1]),
    getCompany: (ownerId, companyId) => getCompanyDetail(ownerId, companyId),
    discover: (ownerId, category) => runDiscovery(ownerId, category),
    refresh: (ownerId, scope) => refreshExisting(ownerId, scope),
    inspectRun: (ownerId, runId) => getRun(ownerId, runId),
    freshSearch: (_ownerId, question) => provider.search({ purpose: "category-evidence", query: `${question} County Dublin technology employers`, maxResults: 6 }),
    saveFinding: async (ownerId, finding) => saveFindingToDatabase(ownerId, finding),
    persistConversation: async (ownerId, input, response) => persistConversation(ownerId, input, response),
  };
}

async function saveFindingToDatabase(ownerId: string, finding: FindingInput): Promise<{ id: string } | null> {
  if (!finding.companyId) return null;
  const [{ getDb }, schema] = await Promise.all([import("../../db"), import("../../db/schema")]);
  const db = getDb();
  const now = new Date().toISOString();
  const sourceId = `src_${crypto.randomUUID()}`;
  const normalizedUrl = finding.source.url.toLowerCase().replace(/#.*$/, "").replace(/\/$/, "");
  await db.insert(schema.sources).values({ id: sourceId, ownerId, companyId: finding.companyId, url: finding.source.url, normalizedUrl, title: finding.source.title, provider: "ai-agent", sourceType: finding.source.sourceType, checkedAt: finding.source.checkedAt ?? now, retrievedAt: finding.source.checkedAt ?? now, status: "ok", createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: [schema.sources.ownerId, schema.sources.normalizedUrl], set: { checkedAt: finding.source.checkedAt ?? now, updatedAt: now } });
  const [source] = await db.select({ id: schema.sources.id }).from(schema.sources).where(and(eq(schema.sources.ownerId, ownerId), eq(schema.sources.normalizedUrl, normalizedUrl))).limit(1);
  const claimId = `claim_${crypto.randomUUID()}`;
  await db.insert(schema.companyClaims).values({ id: claimId, ownerId, companyId: finding.companyId, field: finding.field, valueJson: JSON.stringify(finding.value), normalizedValue: JSON.stringify(finding.value).toLowerCase(), confidence: finding.confidence, sourceId: source?.id ?? sourceId, status: "current", checkedAt: finding.source.checkedAt ?? now, createdAt: now, updatedAt: now });
  await db.insert(schema.changeHistory).values({ id: `hist_${crypto.randomUUID()}`, ownerId, companyId: finding.companyId, entityType: "company_claim", entityId: claimId, field: finding.field, nextJson: JSON.stringify(finding.value), reason: "ai-sourced-finding", createdAt: now, updatedAt: now });
  return { id: claimId };
}

async function persistConversation(ownerId: string, input: AgentInput, response: AgentResponse): Promise<string> {
  const [{ getDb }, schema] = await Promise.all([import("../../db"), import("../../db/schema")]);
  const db = getDb();
  const now = new Date().toISOString();
  const conversationId = input.conversationId ?? `conv_${crypto.randomUUID()}`;
  if (!input.conversationId) await db.insert(schema.aiConversations).values({ id: conversationId, ownerId, title: input.question.slice(0, 80), model: "gpt-5.6-luna", createdAt: now, updatedAt: now });
  await db.insert(schema.aiMessages).values({ id: `msg_${crypto.randomUUID()}`, ownerId, conversationId, role: "user", content: input.question, citationsJson: "[]", createdAt: now, updatedAt: now });
  await db.insert(schema.aiMessages).values({ id: `msg_${crypto.randomUUID()}`, ownerId, conversationId, role: "assistant", content: response.answer, citationsJson: JSON.stringify(response.citations), createdAt: now, updatedAt: now });
  return conversationId;
}

export async function runResearchAgent(input: AgentInput, ownerId: string, overrides: Partial<AgentDependencies> & { freshSearch?: (ownerId: string, question: string) => Promise<SearchResult[]>; persistConversation?: (ownerId: string, input: AgentInput, response: AgentResponse) => Promise<string> } = {}): Promise<AgentResponse> {
  const defaults = await defaultDependencies();
  const dependencies = { ...defaults, ...overrides };
  const tools = createAgentTools(ownerId, dependencies);
  const savedValue = await tools.searchSaved({ query: input.question, ...(input.companyId ? { } : {}) });
  const savedRecords = asSavedContext(savedValue);
  const freshResearchUsed = needsFreshResearch(input.question) || savedRecords.length === 0;
  const freshResults = freshResearchUsed ? await dependencies.freshSearch(ownerId, input.question) : [];
  const citations = sourceCitations(freshResults);
  const savedPrompt = buildSavedDataPrompt(ownerId, savedRecords);
  const freshPrompt = freshResults.map((result) => `${result.title}\n${result.url}\n${result.snippet}`).join("\n\n");
  const { askOpenAI } = await import("./client");
  const modelResult = await askOpenAI(buildAgentPrompt(input.question, savedPrompt, freshPrompt));
  const response: AgentResponse = { answer: modelResult.text, citations, savedFindingIds: [], freshResearchUsed };
  if (input.companyId) {
    for (const citation of citations.slice(0, 6)) {
      const saved = await tools.saveFinding({ companyId: input.companyId, field: "ai-research-source", value: { question: input.question, title: citation.title }, confidence: citation.confidence, source: citation });
      if (saved) response.savedFindingIds.push(saved.id);
    }
  }
  if (dependencies.persistConversation) response.conversationId = await dependencies.persistConversation(ownerId, input, response);
  return response;
}

export type { AgentSearchFilters };
export type { CompanyCategory };
