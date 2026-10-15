import { isCountyDublinLocation, normalizeCompanyIdentity, normalizeDublinLocality, normalizeDomain } from "../domain/normalize";
import type { CompanyCategory } from "../domain/types";
import { COMPANY_CATEGORIES } from "../domain/types";
import { mapWorkbookColumns } from "../import/map-columns";

export type CompanyCellSnapshot = {
  name: string;
  normalizedName: string;
  domain: string | null;
  website: string | null;
  aliasesJson: string;
  description: string | null;
  locality: string | null;
  locationText: string | null;
  employeeBand: string | null;
  foundedYear: number | null;
  metadataJson: string | null;
};

export type CompanyCellUpdatePlan = {
  updates: Partial<Omit<CompanyCellSnapshot, "metadataJson">> & { metadataJson?: string };
  category: CompanyCategory | null;
  updateCategories: boolean;
};

export class CellUpdateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CellUpdateValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseOriginal(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function categoryValue(value: string): CompanyCategory | null {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");
  return (COMPANY_CATEGORIES as readonly string[]).includes(normalized)
    ? normalized as CompanyCategory
    : null;
}

function hasCell(cells: Record<string, string>, header: string | undefined): header is string {
  return Boolean(header && Object.prototype.hasOwnProperty.call(cells, header));
}

function textCell(cells: Record<string, string>, header: string): string {
  return cells[header]!.trim();
}

export function buildCompanyCellUpdatePlan(
  company: CompanyCellSnapshot,
  cells: Record<string, string>,
): CompanyCellUpdatePlan {
  if (!isRecord(cells) || Object.values(cells).some((value) => typeof value !== "string")) {
    throw new CellUpdateValidationError("Cells must be an object whose values are strings.");
  }

  const metadata = parseMetadata(company.metadataJson);
  const original = parseOriginal(metadata.original);
  const mergedOriginal = { ...original, ...cells };
  const mapping = mapWorkbookColumns(Object.keys(mergedOriginal), { allowFirstColumnFallback: false });
  const updates: CompanyCellUpdatePlan["updates"] = {};
  let updateCategories = false;
  let category: CompanyCategory | null = null;

  if (hasCell(cells, mapping.companyName)) {
    const name = textCell(cells, mapping.companyName);
    if (!name) throw new CellUpdateValidationError("Company name cannot be empty.");
    const identity = normalizeCompanyIdentity({ companyName: name });
    if (!identity.normalizedName) throw new CellUpdateValidationError("Enter a valid company name.");
    updates.name = identity.name;
    updates.normalizedName = identity.normalizedName;
  }

  if (hasCell(cells, mapping.website)) {
    const website = textCell(cells, mapping.website);
    const domain = normalizeDomain(website);
    if (website && !domain) throw new CellUpdateValidationError("Enter a valid website or domain, or clear the cell.");
    updates.website = website || null;
    updates.domain = domain;
  }

  if (hasCell(cells, mapping.aliases)) {
    const aliases = textCell(cells, mapping.aliases)
      .split(/[;|]/)
      .map((alias) => alias.trim())
      .filter(Boolean);
    updates.aliasesJson = JSON.stringify(aliases);
  }

  if (hasCell(cells, mapping.location)) {
    const location = textCell(cells, mapping.location);
    if (location && !isCountyDublinLocation(location)) {
      throw new CellUpdateValidationError("Location must be within County Dublin.");
    }
    updates.locationText = location || null;
    updates.locality = normalizeDublinLocality(location);
  }

  if (hasCell(cells, mapping.description)) {
    updates.description = textCell(cells, mapping.description) || null;
  }

  if (hasCell(cells, mapping.employeeBand)) {
    updates.employeeBand = textCell(cells, mapping.employeeBand) || null;
  }

  if (hasCell(cells, mapping.foundedYear)) {
    const value = textCell(cells, mapping.foundedYear);
    if (!value) {
      updates.foundedYear = null;
    } else {
      const year = Number(value);
      if (!Number.isInteger(year) || year < 1000 || year > 9999) {
        throw new CellUpdateValidationError("Founded year must be a four-digit year.");
      }
      updates.foundedYear = year;
    }
  }

  if (hasCell(cells, mapping.careersUrl)) {
    const careersUrl = textCell(cells, mapping.careersUrl);
    if (careersUrl) metadata.careersUrl = careersUrl;
    else delete metadata.careersUrl;
  }

  const sectorHeader = mapping.sector ?? mapping.category;
  if (hasCell(cells, sectorHeader)) {
    const sector = textCell(cells, sectorHeader);
    if (sector) metadata.sector = sector;
    else delete metadata.sector;
  }

  const categoryCellHeader = mapping.category ?? mapping.sector;
  if (hasCell(cells, categoryCellHeader)) {
    category = categoryValue(textCell(cells, categoryCellHeader));
    updateCategories = true;
  }

  const mappedHeaders = new Set([
    mapping.companyName,
    mapping.website,
    mapping.aliases,
    mapping.category,
    mapping.sector,
    mapping.location,
    mapping.careersUrl,
    mapping.description,
    mapping.employeeBand,
    mapping.foundedYear,
  ].filter((header): header is string => Boolean(header)));
  for (const [header, value] of Object.entries(cells)) {
    if (!mappedHeaders.has(header)) metadata[header] = value;
  }

  metadata.original = mergedOriginal;
  updates.metadataJson = JSON.stringify(metadata);
  return { updates, category, updateCategories };
}
