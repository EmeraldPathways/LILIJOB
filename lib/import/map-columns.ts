import type { ColumnMapping } from "./types";

export function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type MappedField =
  | "companyName"
  | "website"
  | "aliases"
  | "category"
  | "location"
  | "careersUrl"
  | "description"
  | "employeeBand"
  | "foundedYear";

const aliases: Record<MappedField, string[]> = {
  companyName: [
    "company",
    "company name",
    "employer",
    "organization",
    "organisation",
    "business",
  ],
  website: ["website", "website url", "url", "domain", "homepage", "company website"],
  aliases: ["alias", "aliases", "also known as", "aka"],
  category: ["category", "sector", "industry", "company type", "type"],
  location: [
    "location",
    "hq location",
    "headquarters",
    "headquarters location",
    "county",
    "address",
  ],
  careersUrl: ["careers", "careers url", "career page", "jobs", "jobs url", "job page"],
  description: ["description", "about", "company description", "summary"],
  employeeBand: ["employees", "employee count", "employee band", "company size", "size"],
  foundedYear: ["founded", "founded year", "year founded"],
};

const recognizedHeaders = new Set(Object.values(aliases).flat());

export function isLikelyHeaderRow(headers: string[]): boolean {
  const normalized = headers.map(normalizeHeader).filter(Boolean);
  const recognized = new Set(normalized.filter((header) => recognizedHeaders.has(header)));
  return recognized.has("company") || recognized.has("company name") || recognized.has("employer") || recognized.has("organization") || recognized.has("organisation") || recognized.has("business") || (recognized.has("website") && recognized.size >= 2);
}

export function mapWorkbookColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = { unknown: [] };
  const claimed = new Set<string>();

  for (const header of headers) {
    const normalized = normalizeHeader(header);
    if (!normalized) continue;

    let field: MappedField | undefined;
    for (const [candidate, names] of Object.entries(aliases) as Array<[
      MappedField,
      string[],
    ]>) {
      if (names.includes(normalized)) {
        field = candidate;
        break;
      }
    }

    if (field && !claimed.has(field)) {
      mapping[field] = header;
      claimed.add(field);
    } else {
      mapping.unknown.push(header);
    }
  }

  if (!mapping.companyName && headers[0]) {
    mapping.companyName = headers[0];
    mapping.unknown = mapping.unknown.filter((header) => header !== headers[0]);
  }

  return mapping;
}
