import { isSafePublicUrl } from "./job-radar";

export type CompanySourceProfile = {
  website?: string | null;
  domain?: string | null;
  metadataJson?: string | null;
};

export type CompanySourceRecord = {
  url: string;
  sourceType?: string | null;
  provider?: string | null;
};

const OFFICIAL_SOURCE_TYPES = new Set(["official-careers", "official-company", "official-public", "company-website"]);
const DOMAIN_MARKETPLACES = new Set(["hugedomains.com", "sedoparking.com", "parkingcrew.net", "afternic.com", "dan.com"]);

function canonicalPublicUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  let url: URL;
  try { url = new URL(value.trim()); } catch { return null; }
  if (!isSafePublicUrl(url.toString())) return null;
  url.hash = "";
  return url.toString();
}

export function isEligibleCareerSourceUrl(value: string): boolean {
  const canonical = canonicalPublicUrl(value);
  if (!canonical) return false;
  const url = new URL(canonical);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  let path = `${url.pathname}${url.search}`.toLowerCase();
  try { path = decodeURIComponent(path); } catch { /* Keep the encoded path for matching. */ }
  if ([...DOMAIN_MARKETPLACES].some((domain) => host === domain || host.endsWith(`.${domain}`))) return false;
  if (/(domain_profile|domain-for-sale|buy-this-domain|parked-domain|domain-parking|\/parking(?:\/|$)|become-a-partner|partner-program|\/partners?(?:\/|$)|\/partnerships?(?:\/|$))/.test(path)) return false;
  return true;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function metadata(company: CompanySourceProfile): Record<string, unknown> {
  try { return object(JSON.parse(company.metadataJson ?? "{}")); } catch { return {}; }
}

function firstString(record: Record<string, unknown>, names: string[]): string | null {
  for (const name of names) if (typeof record[name] === "string" && (record[name] as string).trim()) return (record[name] as string).trim();
  return null;
}

function sourceUrlsFromValue(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((item) => {
    if (typeof item === "string") return [item];
    const record = object(item);
    const url = firstString(record, ["url", "href", "sourceUrl"]);
    return url ? [url] : [];
  });
}

function sourceUrlsFromFields(record: Record<string, unknown>, names: string[]): string[] {
  return names.flatMap((name) => sourceUrlsFromValue(record[name]));
}

function metadataUrls(company: CompanySourceProfile): { careers: string[]; websites: string[]; public: string[] } {
  const root = metadata(company);
  const original = object(root.original);
  const careers = [
    ...sourceUrlsFromFields(original, ["Careers", "careers", "Career Page", "careerPage"]),
    ...sourceUrlsFromFields(root, ["careers", "careerUrl", "careerPageUrl"]),
  ];
  const websites = [
    company.website ?? "",
    ...sourceUrlsFromFields(original, ["Website", "website", "Company Website", "companyWebsite"]),
    ...sourceUrlsFromFields(root, ["website", "companyWebsite", "companyUrl"]),
  ];
  const publicSources = sourceUrlsFromValue(root.publicSources ?? root.publicSourceUrls ?? root.officialSources);
  return { careers, websites, public: publicSources };
}

function officialSavedRecordUrls(records: CompanySourceRecord[]): string[] {
  return records.flatMap((record) => {
    const sourceType = record.sourceType?.toLowerCase() ?? "";
    const provider = record.provider?.toLowerCase() ?? "";
    return OFFICIAL_SOURCE_TYPES.has(sourceType) || OFFICIAL_SOURCE_TYPES.has(provider) ? [record.url] : [];
  });
}

export function savedCompanyPublicSourceUrls(company: CompanySourceProfile, records: CompanySourceRecord[] = []): string[] {
  const { careers, websites, public: publicSources } = metadataUrls(company);
  const unique = new Set<string>();
  for (const value of [...websites, ...careers, ...publicSources, ...officialSavedRecordUrls(records)]) {
    const canonical = canonicalPublicUrl(value);
    if (canonical) unique.add(canonical);
  }
  return [...unique];
}

export function isSavedCompanyPublicSource(company: CompanySourceProfile, records: CompanySourceRecord[], sourceUrl: string): boolean {
  const target = canonicalPublicUrl(sourceUrl);
  return Boolean(target && savedCompanyPublicSourceUrls(company, records).includes(target));
}

export function companyCareerSourceUrl(company: CompanySourceProfile, records: CompanySourceRecord[] = []): string | null {
  const { careers } = metadataUrls(company);
  for (const value of careers) {
    const canonical = canonicalPublicUrl(value);
    if (canonical && isEligibleCareerSourceUrl(canonical)) return canonical;
  }
  for (const record of records) {
    if (record.sourceType?.toLowerCase() === "official-careers" || record.provider?.toLowerCase() === "official-careers") {
      const canonical = canonicalPublicUrl(record.url);
      if (canonical && isEligibleCareerSourceUrl(canonical)) return canonical;
    }
  }
  for (const record of records) {
    if (record.sourceType?.toLowerCase() === "company-website" || record.sourceType?.toLowerCase() === "official-company" || record.provider?.toLowerCase() === "company-website" || record.provider?.toLowerCase() === "official-company") {
      const canonical = canonicalPublicUrl(record.url);
      if (canonical && isEligibleCareerSourceUrl(canonical)) return canonical;
    }
  }
  const { websites } = metadataUrls(company);
  for (const value of websites) {
    const canonical = canonicalPublicUrl(value);
    if (canonical && isEligibleCareerSourceUrl(canonical)) return canonical;
  }
  return null;
}

export function allowedHostsForCompanySource(company: CompanySourceProfile, sourceUrl: string): string[] {
  const hosts = new Set<string>();
  const addHost = (value: string | null | undefined) => {
    if (!value) return;
    const canonical = canonicalPublicUrl(value.includes("://") ? value : `https://${value}`);
    if (!canonical) return;
    try { hosts.add(new URL(canonical).hostname.toLowerCase().replace(/\.$/, "")); } catch { /* invalid saved hostname */ }
  };
  addHost(sourceUrl);
  addHost(company.domain);
  addHost(company.website);
  return [...hosts];
}
