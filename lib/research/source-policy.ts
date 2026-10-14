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

export function classifySource(url: string, title = ""): SourceType {
  const normalized = `${url} ${title}`.toLowerCase();
  if (/enterprise\.gov\.ie|enterprise-ireland\.com|gov\.ie\/.*permit|employment.?permit/.test(normalized)) {
    return "irish-permit";
  }
  if (/\/careers?\b|\/jobs?\b|jobs\.|careers\.|work-with-us|join-us/.test(normalized)) {
    return "official-careers";
  }
  if (/linkedin\.com\/jobs|indeed\.|irishjobs\.|jobs\.ie/.test(normalized)) return "job-board";
  if (/crunchbase|dealroom|startups|directory|wikipedia/.test(normalized)) return "directory";
  if (/news|businesspost|siliconrepublic|techcrunch/.test(normalized)) return "news";
  try {
    const path = new URL(url).pathname;
    if (path === "/" || path === "") return "official-company";
  } catch {
    // Keep the conservative search type for malformed URLs.
  }
  return "search";
}

export function rankSearchResults(results: SearchResult[]): SearchResult[] {
  return [...results].sort((left, right) => {
    const leftType = left.sourceType ?? classifySource(left.url, left.title);
    const rightType = right.sourceType ?? classifySource(right.url, right.title);
    return SOURCE_SCORES[rightType] - SOURCE_SCORES[leftType];
  });
}

export function buildCompanySearchRequests(company: ResearchCompanySeed): SearchRequest[] {
  const domain = company.domain ? ` site:${company.domain}` : "";
  const name = company.name;
  return [
    { purpose: "official-profile", query: `${name} official company profile${domain}` },
    { purpose: "careers", query: `${name} careers Dublin hiring${domain}` },
    { purpose: "open-roles", query: `${name} open technology roles Dublin jobs${domain}` },
    { purpose: "permit-evidence", query: `${name} Ireland employment permit sponsorship` },
    { purpose: "dublin-locality", query: `${name} Dublin office headquarters location${domain}` },
    { purpose: "category-evidence", query: `${name} Dublin technology fintech startup ecommerce` },
  ];
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
