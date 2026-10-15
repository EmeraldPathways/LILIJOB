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

export async function parseWorkbook(
  file: ArrayBuffer | Uint8Array | Buffer,
  fileName: string,
): Promise<ParsedWorkbook> {
  const bytes = file instanceof ArrayBuffer ? new Uint8Array(file) : file;
  const workbook = XLSX.read(bytes, { type: "array", raw: false, cellDates: false });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) return { fileName, headers: [], rows: [], dataStartRow: 2 };
  const sheet = workbook.Sheets[firstSheet];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });
  const headerIndex = matrix.findIndex((values) => isLikelyHeaderRow(values.map(asText)));
  const effectiveHeaderIndex = headerIndex >= 0 ? headerIndex : 0;
  const headers = (matrix[effectiveHeaderIndex] ?? []).map(asText);
  const rows = matrix.slice(effectiveHeaderIndex + 1).map((values) => {
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (header) row[header] = asText(values[index]);
    });
    return row;
  });

  return { fileName, headers, rows, dataStartRow: effectiveHeaderIndex + 2 };
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
      category: categoryValue(get(row, mapping.category)) ?? defaultCategory,
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
