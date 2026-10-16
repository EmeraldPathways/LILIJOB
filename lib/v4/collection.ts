import { and, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { companies, sources } from "../../db/schema";
import { createHiringSignal, createRecruitmentContact } from "./intelligence-repository";
import { classifyContact, type ContactClassificationInput } from "./contacts";
import { fetchOfficialPublicSource, type OfficialPublicSourceStatus } from "./job-radar";
import { allowedHostsForCompanySource, isSavedCompanyPublicSource, type CompanySourceRecord, type CompanySourceProfile } from "./source-scope";
import { isValidSignalDate, isValidSignalSourceUrl, type HiringSignalCandidate, type HiringSignalType } from "./signals";

export type CollectedPublicContact = ContactClassificationInput & {
  contactType: ReturnType<typeof classifyContact>["type"];
  emailStatus: "published" | "email-unavailable";
  inferredEmail: false;
  qualityScore: number;
};

export type OfficialPublicCollection = {
  contacts: CollectedPublicContact[];
  signals: HiringSignalCandidate[];
  contactStatus: "collected" | "unavailable";
  emailStatus: "published" | "unavailable";
  signalStatus: "collected" | "unavailable";
};

type PublicPageInput = {
  companyId: string;
  companyDomain?: string | null;
  sourceUrl: string;
  html: string;
  checkedAt?: string;
};

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function textValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = decodeHtml(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
  return cleaned || null;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function typesOf(value: Record<string, unknown>): string[] {
  const raw = value["@type"];
  return (Array.isArray(raw) ? raw : [raw]).filter((item): item is string => typeof item === "string").map((item) => item.toLowerCase().split(/[/:]/).pop() ?? item.toLowerCase());
}

function structuredNodes(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap((item) => structuredNodes(item));
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return [record, ...structuredNodes(record["@graph"]), ...structuredNodes(record.mainEntity), ...structuredNodes(record.itemListElement)];
}

function jsonLdNodes(html: string): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  const pattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    try { result.push(...structuredNodes(JSON.parse(match[1]))); } catch { /* Ignore malformed structured data and continue with other public evidence. */ }
  }
  return result;
}

function normalizedDomain(value: string | null | undefined, sourceUrl: string): string {
  try {
    const host = value ? new URL(value.includes("://") ? value : `https://${value}`).hostname : new URL(sourceUrl).hostname;
    return host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    return "";
  }
}

function cleanEmail(value: unknown, allowedDomain: string): string | null {
  if (typeof value !== "string") return null;
  let candidate = decodeHtml(value.trim());
  if (candidate.toLowerCase().startsWith("mailto:")) candidate = candidate.slice(7).split(/[?#]/, 1)[0];
  try { candidate = decodeURIComponent(candidate); } catch { /* Keep the source text if it has malformed percent escapes. */ }
  candidate = candidate.trim().toLowerCase();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(candidate)) return null;
  const emailDomain = candidate.split("@").pop() ?? "";
  return emailDomain === allowedDomain || emailDomain.endsWith(`.${allowedDomain}`) ? candidate : null;
}

function sameCompanyHost(value: string, companyDomain: string, sourceUrl: string): boolean {
  try {
    const host = new URL(value, sourceUrl).hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    const sourceHost = new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    return host === companyDomain || host.endsWith(`.${companyDomain}`) || host === sourceHost;
  } catch {
    return false;
  }
}

function contactCandidate(input: ContactClassificationInput): CollectedPublicContact | null {
  const classified = classifyContact(input);
  const relevantPerson = classified.type === "public-named-recruiter" || classified.type === "public-relevant-hiring-manager";
  if (!classified.email && !relevantPerson) return null;
  return {
    ...input,
    email: classified.email,
    contactType: classified.type,
    emailStatus: classified.email ? "published" : "email-unavailable",
    inferredEmail: false,
    qualityScore: classified.qualityScore,
  };
}

function signalTypeForHeadline(headline: string): HiringSignalType | null {
  if (/\b(raises?|raised|funding|series [a-d]|seed round|investment round)\b/i.test(headline)) return "funding";
  if (/\b(launch(?:es|ed)?|launched|introduces|released|rolls out)\b/i.test(headline) && /\b(product|platform|service|app|feature|tool)\b/i.test(headline)) return "product-launch";
  if (/\b(dublin office|ireland office|opens? (?:a )?(?:dublin|ireland) office|new dublin office)\b/i.test(headline)) return "dublin-office";
  if (/\b(appoints?|appointed|names? .{1,60} (?:ceo|chief|director)|new ceo|leadership change)\b/i.test(headline)) return "leadership-change";
  if (/\b(partner(?:s|ed|ship)?|partnership)\b/i.test(headline)) return "partnership";
  if (/\b(acquires?|acquired|acquisition|merger)\b/i.test(headline)) return "acquisition";
  if (/\b(hiring|recruit(?:ing|ment)|open roles|job openings|join our team|expanding .* team)\b/i.test(headline)) return "hiring-surge";
  if (/\b(team build[- ]out|building .* team|team expansion)\b/i.test(headline)) return "team-build-out";
  return null;
}

function eventDate(value: unknown): string | null {
  const text = textValue(value);
  if (!text) return null;
  const date = text.slice(0, 10);
  return isValidSignalDate(date) ? date : null;
}

function articleSignal(node: Record<string, unknown>, input: PublicPageInput, companyDomain: string, checkedAt: string): HiringSignalCandidate | null {
  const types = typesOf(node);
  if (!types.some((type) => ["newsarticle", "article", "blogposting"].includes(type))) return null;
  const headline = textValue(node.headline ?? node.name);
  if (!headline || headline.length > 300) return null;
  const signalType = signalTypeForHeadline(headline);
  if (!signalType || !isValidSignalSourceUrl(input.sourceUrl)) return null;
  const articleUrl = textValue(node.url ?? node.mainEntityOfPage) ?? input.sourceUrl;
  const resolvedUrl = (() => { try { return new URL(articleUrl, input.sourceUrl).toString(); } catch { return input.sourceUrl; } })();
  if (!sameCompanyHost(resolvedUrl, companyDomain, input.sourceUrl)) return null;
  const context = `${headline} ${textValue(node.description) ?? ""}`.toLowerCase();
  return {
    companyId: input.companyId,
    type: signalType,
    summary: headline,
    eventDate: eventDate(node.datePublished ?? node.dateCreated),
    discoveredAt: checkedAt,
    sourceUrl: input.sourceUrl,
    sourceReliability: "primary",
    dublinConnection: /\b(dublin|ireland)\b/.test(context) ? true : null,
    functionRelevance: 0,
    companyInterest: 0,
  };
}

/** Extracts only contact details and news metadata directly present in a saved public page. */
export function parseOfficialPublicPage(input: PublicPageInput): OfficialPublicCollection {
  const checkedAt = input.checkedAt ?? new Date().toISOString();
  const domain = normalizedDomain(input.companyDomain, input.sourceUrl);
  const contacts = new Map<string, CollectedPublicContact>();
  const addContact = (candidate: ContactClassificationInput) => {
    const contact = contactCandidate({ ...candidate, sourceUrl: input.sourceUrl, observedAt: checkedAt });
    if (!contact) return;
    const key = contact.email ?? contact.linkedinUrl ?? `${contact.name ?? ""}|${contact.role ?? ""}`;
    const existing = contacts.get(key);
    if (!existing || (!existing.email && contact.email)) contacts.set(key, contact);
  };

  const nodes = jsonLdNodes(input.html);
  for (const node of nodes) {
    const types = typesOf(node);
    if (!types.includes("person")) continue;
    const name = textValue(node.name) ?? undefined;
    const role = textValue(node.jobTitle ?? node.roleName) ?? undefined;
    const departmentValue = node.department;
    const department = typeof departmentValue === "string" ? textValue(departmentValue) ?? undefined : textValue(object(departmentValue).name) ?? undefined;
    const email = cleanEmail(node.email, domain);
    const rawUrl = textValue(node.url ?? node.sameAs);
    const linkedinUrl = rawUrl && /(^|\.)linkedin\.com$/i.test((() => { try { return new URL(rawUrl).hostname; } catch { return ""; } })()) ? rawUrl : null;
    addContact({ name, role, department, email, linkedinUrl });
  }

  const rawEmails = [
    ...[...input.html.matchAll(/href\s*=\s*["']mailto:([^"']+)["']/gi)].map((match) => match[1]),
    ...[...decodeHtml(input.html.replace(/<[^>]*>/g, " ")).matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((match) => match[0]),
  ];
  for (const rawEmail of rawEmails) {
    const email = cleanEmail(rawEmail, domain);
    if (email) addContact({ email });
  }

  const signalsByKey = new Map<string, HiringSignalCandidate>();
  for (const node of nodes) {
    const signal = articleSignal(node, input, domain, checkedAt);
    if (signal) signalsByKey.set(`${signal.type}|${signal.sourceUrl}|${signal.summary.toLowerCase()}`, signal);
  }
  const collectedContacts = [...contacts.values()].slice(0, 20);
  const signals = [...signalsByKey.values()].slice(0, 5);
  return {
    contacts: collectedContacts,
    signals,
    contactStatus: collectedContacts.length ? "collected" : "unavailable",
    emailStatus: collectedContacts.some((contact) => contact.email) ? "published" : "unavailable",
    signalStatus: signals.length ? "collected" : "unavailable",
  };
}

type CompanyForCollection = CompanySourceProfile & { id: string; ownerId: string };

async function loadCompanyAndSources(ownerId: string, companyId: string): Promise<{ company: CompanyForCollection | null; sourceRecords: CompanySourceRecord[] }> {
  const db = getDb();
  const [company] = await db.select({ id: companies.id, ownerId: companies.ownerId, website: companies.website, domain: companies.domain, metadataJson: companies.metadataJson })
    .from(companies).where(and(eq(companies.ownerId, ownerId), eq(companies.id, companyId))).limit(1);
  if (!company) return { company: null, sourceRecords: [] };
  const sourceRecords = await db.select({ url: sources.url, sourceType: sources.sourceType, provider: sources.provider })
    .from(sources).where(and(eq(sources.ownerId, ownerId), eq(sources.companyId, companyId)));
  return { company, sourceRecords };
}

async function recordFetchedSource(ownerId: string, companyId: string, sourceUrl: string, checkedAt: string, summary: string): Promise<string> {
  const db = getDb();
  const normalizedUrl = new URL(sourceUrl);
  normalizedUrl.hash = "";
  const canonical = normalizedUrl.toString();
  const [existing] = await db.select({ id: sources.id, companyId: sources.companyId }).from(sources)
    .where(and(eq(sources.ownerId, ownerId), eq(sources.normalizedUrl, canonical))).limit(1);
  if (existing && existing.companyId && existing.companyId !== companyId) throw new Error("Public source belongs to another company.");
  const timestamp = new Date().toISOString();
  if (existing) {
    await db.update(sources).set({ companyId, retrievedAt: checkedAt, checkedAt, status: "ok", snippet: summary.slice(0, 500), updatedAt: timestamp })
      .where(and(eq(sources.ownerId, ownerId), eq(sources.id, existing.id)));
    return existing.id;
  }
  const id = `source_${crypto.randomUUID()}`;
  await db.insert(sources).values({
    id, ownerId, companyId, url: canonical, normalizedUrl: canonical, title: "Official public company page", snippet: summary.slice(0, 500),
    provider: "official-public", sourceType: "official-public", retrievedAt: checkedAt, checkedAt, status: "ok", createdAt: timestamp, updatedAt: timestamp,
  });
  return id;
}

export async function persistOfficialPublicFindings(ownerId: string, input: PublicPageInput) {
  const extracted = parseOfficialPublicPage(input);
  let contactsCreated = 0;
  for (const contact of extracted.contacts) {
    const saved = await createRecruitmentContact(ownerId, { ...contact, companyId: input.companyId });
    if (saved) contactsCreated += 1;
  }
  let signalsCreated = 0;
  if (extracted.signals.length) {
    const sourceId = await recordFetchedSource(ownerId, input.companyId, input.sourceUrl, input.checkedAt ?? new Date().toISOString(), extracted.signals.map((signal) => signal.summary).join("; "));
    for (const signal of extracted.signals) {
      const saved = await createHiringSignal(ownerId, { ...signal, sourceId });
      if (saved) signalsCreated += 1;
    }
  }
  return { ...extracted, contactsCreated, signalsCreated };
}

export type PublicCollectionResult = {
  status: "collected" | "unavailable" | "blocked" | "unsupported" | "stale" | "error" | "not-found";
  sourceUrl: string;
  checkedAt: string;
  emailStatus: "published" | "unavailable";
  contactStatus: "collected" | "unavailable";
  signalStatus: "collected" | "unavailable";
  contactsFound: number;
  signalsFound: number;
  contactsCreated: number;
  signalsCreated: number;
  sourceVerificationStatus: "not-independently-verified";
  error?: string;
};

function unavailableResult(status: OfficialPublicSourceStatus | "not-found", sourceUrl: string, checkedAt: string, error?: string): PublicCollectionResult {
  return {
    status: status === "fetched" ? "unavailable" : status === "source-blocked" ? "blocked" : status,
    sourceUrl,
    checkedAt,
    emailStatus: "unavailable",
    contactStatus: "unavailable",
    signalStatus: "unavailable",
    contactsFound: 0,
    signalsFound: 0,
    contactsCreated: 0,
    signalsCreated: 0,
    sourceVerificationStatus: "not-independently-verified",
    ...(error ? { error } : {}),
  };
}

/** Fetches at most one explicitly saved public URL for a company owned by this user. */
export async function collectPublicCompanyData(ownerId: string, companyId: string, sourceUrl: string, fetcher: (input: string, init?: RequestInit) => Promise<Response> = fetch): Promise<PublicCollectionResult> {
  const checkedAt = new Date().toISOString();
  const { company, sourceRecords } = await loadCompanyAndSources(ownerId, companyId);
  if (!company) return unavailableResult("not-found", sourceUrl, checkedAt, "Company was not found for this owner.");
  if (!isSavedCompanyPublicSource(company, sourceRecords, sourceUrl)) return unavailableResult("unsupported", sourceUrl, checkedAt, "Choose an official URL already saved for this company.");
  const page = await fetchOfficialPublicSource(sourceUrl, fetcher, { checkedAt, allowedHosts: allowedHostsForCompanySource(company, sourceUrl) });
  if (page.status !== "fetched" || page.body === undefined) return unavailableResult(page.status, sourceUrl, checkedAt, page.error);
  const findings = await persistOfficialPublicFindings(ownerId, {
    companyId,
    companyDomain: company.domain,
    sourceUrl: page.finalUrl,
    html: page.body,
    checkedAt,
  });
  const hasResults = findings.contacts.length > 0 || findings.signals.length > 0;
  return {
    status: "collected",
    sourceUrl: page.finalUrl,
    checkedAt,
    emailStatus: findings.emailStatus,
    contactStatus: findings.contactStatus,
    signalStatus: findings.signalStatus,
    contactsFound: findings.contacts.length,
    signalsFound: findings.signals.length,
    contactsCreated: findings.contactsCreated,
    signalsCreated: findings.signalsCreated,
    sourceVerificationStatus: "not-independently-verified",
    ...(!hasResults ? { error: "The official page did not publish a matching contact or structured hiring signal." } : {}),
  };
}
