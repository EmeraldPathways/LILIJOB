import * as XLSX from "xlsx";
import { COMPANY_CATEGORIES, type CompanyCategory } from "../domain/types";
import { isExplicitlyOutsideCountyDublin, normalizeCompanyIdentity } from "../domain/normalize";
import { mapWorkbookColumns } from "./map-columns";
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
  if (!firstSheet) return { fileName, headers: [], rows: [] };
  const sheet = workbook.Sheets[firstSheet];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });
  const headers = (matrix[0] ?? []).map(asText);
  const rows = matrix.slice(1).map((values) => {
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (header) row[header] = asText(values[index]);
    });
    return row;
  });

  return { fileName, headers, rows };
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

export function buildImportPlan(workbook: ParsedWorkbook): ImportPlan {
  const mapping = mapWorkbookColumns(workbook.headers);
  const rows: ImportPlanRow[] = [];
  const errors: ImportPlan["errors"] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  workbook.rows.forEach((row, index) => {
    const rowNumber = index + 2;
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
    if (isExplicitlyOutsideCountyDublin(location)) {
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
      category: categoryValue(get(row, mapping.category)),
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
