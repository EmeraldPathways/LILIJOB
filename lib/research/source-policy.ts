import type { SourceType } from "../domain/types";
import type { ResearchCompanySeed, SearchRequest, SearchResult } from "./types";

const SOURCE_SCORES: Record<SourceType, number> = {
  "official-careers": 100,
  "irish-permit": 95,
  "official-company": 90,
  "job-board": 60,
  news: 50,
  directory: 30,
  search: 10,
};

function hostname(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const parsed = new URL(value.includes("://") ? value : `https://${value}`);
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function sameDomain(host: string, domain: string | null | undefined): boolean {
  const expected = hostname(domain);
  return Boolean(expected && (host === expected || host.endsWith(`.${expected}`)));
}

export function textMentionsCompany(title: string, companyName: string): boolean {
  const tokens = companyName.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  if (!tokens.length) return false;
  const pattern = tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s-]+");
  return new RegExp(`(?:^|[^a-z0-9])${pattern}(?:$|[^a-z0-9])`, "i").test(title.replace(/[–—]/g, "-"));
}

export function companyNameFromSearchTitle(title: string): string | null {
  const candidate = title.trim().split(/\s+(?:\||·|–|—|-)\s+/)[0]?.trim() ?? "";
  const cleaned = candidate.replace(/\s+(?:careers?|jobs?|about(?: us)?|company profile|official site)$/i, "").trim();
  if (!cleaned || cleaned.length > 80 || !/[a-z]/i.test(cleaned)) return null;
  if (/\b(?:companies|hiring|careers?|vacanc(?:y|ies)|open roles?|find|list of|top \d+|directory|county dublin|dublin|ireland|employers)\b/i.test(cleaned)) return null;
  if (/^(?:fintech|e-?commerce|startups?|technology|software|payments?|banking|healthtech|company)$/i.test(cleaned)) return null;
  if (cleaned.split(/\s+/).length > 8) return null;
  return cleaned;
}

export function classifySource(url: string, title = ""): SourceType {
  let host = "";
  let path = "";
  try {
    const parsed = new URL(url);
    host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    path = parsed.pathname.toLowerCase();
  } catch {
    // Keep the conservative search type for malformed URLs.
  }

  if (/^enterprise\.gov\.ie$/.test(host) || (host === "gov.ie" && /permit/.test(`${path} ${title.toLowerCase()}`))) {
    return "irish-permit";
  }
  if (/^(?:linkedin\.com|indeed\.[a-z.]+|irishjobs\.[a-z.]+|jobs\.ie|glassdoor\.[a-z.]+|workable\.com|greenhouse\.io)$/.test(host) || /(?:^|\.)jobs\.[a-z.]+$/.test(host)) {
    return "job-board";
  }
  if (/crunchbase|dealroom|startups|directory|wikipedia/.test(`${host} ${title.toLowerCase()}`)) return "directory";
  if (/news|businesspost|siliconrepublic|techcrunch/.test(`${host} ${title.toLowerCase()}`)) return "news";
  if (/\/careers?\b|\/jobs?\b|jobs\.|careers\.|work-with-us|join-us/.test(`${host}${path}`)) return "official-careers";
  if (path === "/" || path === "") return "official-company";
  return "search";
}

export function matchesCompany(company: ResearchCompanySeed, result: SearchResult): boolean {
  let host = "";
  try {
    const parsed = new URL(result.url);
    host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return textMentionsCompany(`${result.title} ${result.snippet} ${result.content ?? ""}`, company.name);
  }
  if (sameDomain(host, company.domain) || sameDomain(host, company.website)) return true;
  return textMentionsCompany(`${result.title} ${result.snippet} ${result.content ?? ""}`, company.name);
}

export function isVerifiedCompanySite(company: ResearchCompanySeed, result: SearchResult): boolean {
  let parsed: URL;
  try {
    parsed = new URL(result.url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (sameDomain(host, company.domain) || sameDomain(host, company.website)) return true;
  const inferredType = classifySource(result.url, result.title);
  return parsed.pathname === "/"
    && (inferredType === "official-company" || inferredType === "search")
    && textMentionsCompany(result.title, company.name);
}

function hasText(value: string | number | null | undefined): boolean {
  return typeof value === "string" ? Boolean(value.trim()) : value !== null && value !== undefined;
}

export function buildCompanySearchRequests(company: ResearchCompanySeed): SearchRequest[] {
  const gaps: string[] = [];
  if (!hasText(company.website) && !hasText(company.domain)) gaps.push("official website and domain");
  if (!hasText(company.description)) gaps.push("company description and products");
  if (!hasText(company.locality) && !hasText(company.headquarters)) gaps.push("Dublin locality and headquarters");
  if (!hasText(company.employeeBand)) gaps.push("employee count or team size");
  if (!hasText(company.foundedYear)) gaps.push("founding year");
  gaps.push("current careers page and open technology roles");
  gaps.push("explicit Irish employment permit listing or company sponsorship policy");

  const domain = hostname(company.domain ?? company.website);
  const site = domain ? ` site:${domain}` : "";
  return [{
    purpose: "official-profile",
    query: `${company.name.trim()} ${gaps.join(", ")}${site}`,
    maxResults: 5,
  }];
}

export function shouldUseHighConfidence(input: {
  sourceType: SourceType;
  hasFullContent: boolean;
}): boolean {
  return input.hasFullContent && ["official-company", "official-careers", "irish-permit"].includes(input.sourceType);
}

export function sourceScore(sourceType: SourceType): number {
  return SOURCE_SCORES[sourceType];
}

export function rankSearchResults(results: SearchResult[]): SearchResult[] {
  return [...results].sort((left, right) => {
    const leftType = left.sourceType ?? classifySource(left.url, left.title);
    const rightType = right.sourceType ?? classifySource(right.url, right.title);
    return SOURCE_SCORES[rightType] - SOURCE_SCORES[leftType];
  });
}
