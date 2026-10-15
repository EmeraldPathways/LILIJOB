import * as XLSX from "xlsx";
import { COMPANY_CATEGORIES, type CompanyCategory } from "../domain/types";
import { normalizeCompanyIdentity } from "../domain/normalize";
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

const MAX_WORKBOOK_SHEETS = 20;
const MAX_WORKBOOK_COLUMNS = 200;
const MAX_WORKBOOK_ROWS = 25_000;

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
  const headers: string[] = [];
  const rows: Record<string, string>[] = [];
  const rowSheetNames: string[] = [];
  const rowNumbers: number[] = [];
  if (workbook.SheetNames.length > MAX_WORKBOOK_SHEETS) throw new WorkbookParseError(`A workbook may contain at most ${MAX_WORKBOOK_SHEETS} worksheets.`);
  const multiple = workbook.SheetNames.length > 1;
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet["!ref"]) continue;
    const range = XLSX.utils.decode_range(sheet["!ref"]!);
    if (range.e.c - range.s.c + 1 > MAX_WORKBOOK_COLUMNS) throw new WorkbookParseError(`A worksheet may contain at most ${MAX_WORKBOOK_COLUMNS} columns.`);
    if (range.e.r - range.s.r + 1 > MAX_WORKBOOK_ROWS || rows.length >= MAX_WORKBOOK_ROWS || rows.length + range.e.r - range.s.r + 1 > MAX_WORKBOOK_ROWS) throw new WorkbookParseError(`A workbook may contain at most ${MAX_WORKBOOK_ROWS} data rows.`);
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false, blankrows: true, range });
    const normalizedMatrix = matrix.map(values => Array.from({ length: range.e.c - range.s.c + 1 }, (_, index) => asText(values[index])));
    let headerIndex = -1;
    let headerScore = -1;
    normalizedMatrix.forEach((values, index) => {
      if (!isLikelyHeaderRow(values)) return;
      const mapping = mapWorkbookColumns(values, { allowFirstColumnFallback: false });
      const score = Object.values(mapping).filter(value => typeof value === "string").length;
      if (score > headerScore) { headerIndex = index; headerScore = score; }
    });
    if (headerIndex < 0) throw new WorkbookParseError(`Could not find a company header row in ${sheetName}.`);
    const sourceHeaders = uniqueHeaders(normalizedMatrix[headerIndex], range.s.c);
    const mapping = mapWorkbookColumns(sourceHeaders, { allowFirstColumnFallback: false });
    const names: Record<string, string> = {};
    if (multiple) {
      for (const [field, label] of Object.entries({companyName:"Company", sector:"Sector", location:"Address", website:"Website", careersUrl:"Careers"})) {
        const source = mapping[field];
        if (typeof source === "string") names[source] = label;
      }
      for (const header of sourceHeaders) {
        const key = header.toLowerCase().replace(/[^a-z]/g, "");
        if (["linkedin", "companylinkedinurl"].includes(key)) names[header] = "LinkedIn";
        if (["email", "contactemail", "companycontactemail"].includes(key)) names[header] = "Email";
      }
    }
    const active = sourceHeaders.map((header, index) => ({header, index})).filter(({index}) => !multiple || Boolean(names[sourceHeaders[index]]) || normalizedMatrix.slice(headerIndex + 1).some(values => values[index]));
    for (const {header} of active) if (!headers.includes(names[header] ?? header)) headers.push(names[header] ?? header);
    normalizedMatrix.slice(headerIndex + 1).forEach((values, index) => {
      if (values.every(value => !value)) return;
      rows.push(Object.fromEntries(active.map(({header, index}) => [names[header] ?? header, asText(values[index])])));
      rowSheetNames.push(sheetName);
      rowNumbers.push(range.s.r + headerIndex + index + 2);
    });
  }
  if (!rows.length) throw new WorkbookParseError("This workbook is empty. Add a company header and at least one company row.");
  return { fileName, headers, rows, dataStartRow: rowNumbers[0], rowSheetNames, rowNumbers };
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

  const defaultCategory = inferredCategory(workbook.fileName);
  const rows: ImportPlanRow[] = [];
  const errors: ImportPlan["errors"] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  workbook.rows.forEach((row, index) => {
    const mapping = mapWorkbookColumns(Object.keys(row));
    const rowNumber = workbook.rowNumbers?.[index] ?? (workbook.dataStartRow ?? 2) + index;
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
    const identity = normalizeCompanyIdentity({ companyName, website });
    if (seen.has(identity.normalizedName)) {
      duplicates += 1;
    }
    seen.add(identity.normalizedName);

    const metadata: Record<string, unknown> = {};
    for (const header of mapping.unknown) {
      const value = get(row, header);
      if (value) metadata[header] = value;
    }

    const sector = get(row, mapping.sector ?? mapping.category);
    if (sector) metadata.sector = sector;

    const sheet = workbook.rowSheetNames?.[index];
    const collection = sheet && ({fintech:"Fintech",techpermits:"Tech Permits",ecommerce:"Ecommerce",startups:"Startups"} as Record<string,string>)[sheet.toLowerCase().replace(/[^a-z]/g, "")];
    if (collection) { metadata.collections = [collection]; metadata.sheetRows = { [collection]: original }; }
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
      category: (collection ? inferredCategory(collection.replace("Tech Permits", "work permit")) : null) ?? categoryValue(
        mapping.category ? get(row, mapping.category) : sector,
      ) ?? defaultCategory,
      location,
      careersUrl: /^https?:\/\//i.test(get(row, mapping.careersUrl)) ? get(row, mapping.careersUrl) : null,
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
