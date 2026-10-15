import * as XLSX from "xlsx";
import { COMPANY_CATEGORIES, type CompanyCategory } from "../domain/types";
import { isCountyDublinLocation, normalizeCompanyIdentity } from "../domain/normalize";
import { isLikelyHeaderRow, mapWorkbookColumns } from "./map-columns";
import type {
  ImportPlan,
  ImportPlanRow,
  ParsedWorkbook,
} from "./types";

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export class WorkbookParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkbookParseError";
  }
}

function uniqueHeaders(values: unknown[], firstColumn: number): string[] {
  const used = new Set<string>();
  return values.map((value, index) => {
    const base = asText(value) || `Column ${firstColumn + index + 1}`;
    let header = base;
    let suffix = 2;
    while (used.has(header)) {
      header = `${base} (${suffix})`;
      suffix += 1;
    }
    used.add(header);
    return header;
  });
}

export async function parseWorkbook(
  file: ArrayBuffer | Uint8Array | Buffer,
  fileName: string,
): Promise<ParsedWorkbook> {
  const bytes = file instanceof ArrayBuffer ? new Uint8Array(file) : file;
  const workbook = XLSX.read(bytes, { type: "array", raw: false, cellDates: false });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) {
    throw new WorkbookParseError("This workbook has no worksheets. Add a worksheet with a header row and company data.");
  }
  const sheet = workbook.Sheets[firstSheet];
  const reference = sheet["!ref"];
  if (!reference) {
    throw new WorkbookParseError("This worksheet is empty. Add a header row and at least one company row.");
  }
  const range = XLSX.utils.decode_range(reference);
  const width = range.e.c - range.s.c + 1;
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: true,
    range,
  });
  const normalizedMatrix = matrix.map((values) =>
    Array.from({ length: width }, (_, index) => asText(values[index])),
  );
  let headerIndex = -1;
  let headerScore = -1;
  normalizedMatrix.forEach((values, index) => {
    if (!isLikelyHeaderRow(values)) return;
    const mapping = mapWorkbookColumns(values, { allowFirstColumnFallback: false });
    const score = Object.values(mapping).filter((value) => typeof value === "string").length;
    if (score > headerScore) {
      headerIndex = index;
      headerScore = score;
    }
  });
  if (headerIndex < 0) {
    throw new WorkbookParseError("Could not find a company header row. Add a row with a company name column and try again.");
  }
  const headers = uniqueHeaders(normalizedMatrix[headerIndex] ?? [], range.s.c);
  const rows = normalizedMatrix.slice(headerIndex + 1).map((values) => {
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = asText(values[index]);
    });
    return row;
  });

  return { fileName, headers, rows, dataStartRow: headerIndex + range.s.r + 2 };
}

function get(row: Record<string, string>, header: string | undefined): string {
  return header ? asText(row[header]) : "";
}

function categoryValue(value: string): CompanyCategory | null {
  const normalized = value.toLowerCase().replace(/\s+/g, "-");
  return (COMPANY_CATEGORIES as readonly string[]).includes(normalized)
    ? (normalized as CompanyCategory)
    : null;
}

function inferredCategory(fileName: string): CompanyCategory | null {
  const normalized = fileName.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  if (/\bfintech\b/.test(normalized)) return "fintech";
  if (/\bstartups?\b/.test(normalized)) return "startups";
  if (/\be[ -]?commerce\b/.test(normalized)) return "e-commerce";
  if (/\b(work[ -]?permit|sponsors?)\b/.test(normalized)) return "work-permit";
  return null;
}

export function buildImportPlan(workbook: ParsedWorkbook): ImportPlan {
  const mapping = mapWorkbookColumns(workbook.headers);
  const defaultCategory = inferredCategory(workbook.fileName);
  const rows: ImportPlanRow[] = [];
  const errors: ImportPlan["errors"] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  workbook.rows.forEach((row, index) => {
    const rowNumber = (workbook.dataStartRow ?? 2) + index;
    const original = Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, asText(value)]),
    );
    if (Object.values(original).every((value) => !value)) return;

    const companyName = get(row, mapping.companyName);
    if (!companyName) {
      errors.push({ row: rowNumber, message: "Company name is required" });
      return;
    }

    const website = get(row, mapping.website) || null;
    const location = get(row, mapping.location) || null;
    if (location && !isCountyDublinLocation(location)) {
      errors.push({ row: rowNumber, message: "Location is outside County Dublin" });
      return;
    }
    const identity = normalizeCompanyIdentity({ companyName, website });
    if (seen.has(identity.dedupeKey)) {
      duplicates += 1;
    }
    seen.add(identity.dedupeKey);

    const metadata: Record<string, string> = {};
    for (const header of mapping.unknown) {
      const value = get(row, header);
      if (value) metadata[header] = value;
    }

    const sector = get(row, mapping.sector ?? mapping.category);
    if (sector) metadata.sector = sector;

    const aliases = get(row, mapping.aliases)
      .split(/[;|]/)
      .map((value) => value.trim())
      .filter(Boolean);
    const founded = Number.parseInt(get(row, mapping.foundedYear), 10);

    rows.push({
      rowNumber,
      companyName,
      website,
      aliases,
      category: categoryValue(
        mapping.category ? get(row, mapping.category) : sector,
      ) ?? defaultCategory,
      location,
      careersUrl: get(row, mapping.careersUrl) || null,
      description: get(row, mapping.description) || null,
      employeeBand: get(row, mapping.employeeBand) || null,
      foundedYear: Number.isFinite(founded) ? founded : null,
      metadata,
      original,
    });
  });

  return {
    rows,
    accepted: rows.length - duplicates,
    duplicates,
    errors,
  };
}
