import type { CompanyListItem } from "../repositories/company-repository";

export type SheetCompany = CompanyListItem & {
  sector?: string | null;
  importedData?: Record<string, string>;
};

export type SheetColumn = {
  id: string;
  key: string;
  label: string;
  source: "imported" | "profile";
  profileField?: "Company" | "Website" | "Sector";
};

export type CompanySheetFilters = {
  query: string;
  column: SheetColumn | null;
  value: string | null;
};

const PROFILE_COLUMNS: SheetColumn[] = [
  { id: "profile:Company", key: "Company", label: "Company", source: "profile", profileField: "Company" },
  { id: "profile:Website", key: "Website", label: "Website", source: "profile", profileField: "Website" },
  { id: "profile:Sector", key: "Sector", label: "Sector", source: "profile", profileField: "Sector" },
];

function importedDataFor(company: SheetCompany): Record<string, string> {
  return company.importedData && typeof company.importedData === "object" ? company.importedData : {};
}

function isProfileOnly(company: SheetCompany): boolean {
  return Object.keys(importedDataFor(company)).length === 0;
}

function profileValue(company: SheetCompany, key: string): string {
  if (key === "Company") return company.name ?? "";
  if (key === "Website") return company.website ?? "";
  if (key === "Sector") return company.sector ?? "";
  return "";
}

export function getSheetColumns(companies: SheetCompany[]): SheetColumn[] {
  const keys = new Set<string>();
  const columns: SheetColumn[] = [];

  for (const company of companies) {
    for (const key of Object.keys(importedDataFor(company))) {
      if (!keys.has(key)) {
        keys.add(key);
        columns.push({ id: `imported:${key}`, key, label: key, source: "imported" });
      }
    }
  }

  if (companies.some(isProfileOnly)) {
    columns.push(...PROFILE_COLUMNS);
  }

  return columns;
}

export function getSheetCellValue(company: SheetCompany, column: SheetColumn): string {
  if (column.source === "profile") {
    return isProfileOnly(company) ? profileValue(company, column.profileField ?? "Company") : "";
  }
  const importedData = importedDataFor(company);
  if (Object.prototype.hasOwnProperty.call(importedData, column.key)) {
    const value = importedData[column.key];
    return typeof value === "string" ? value : String(value ?? "");
  }
  return "";
}

export function getColumnFilterValues(companies: SheetCompany[], column: SheetColumn): string[] {
  const values = new Set<string>();
  for (const company of companies) values.add(getSheetCellValue(company, column));
  return [...values];
}

function allSearchValues(company: SheetCompany): string[] {
  return [
    ...Object.values(importedDataFor(company)),
    company.name,
    company.website ?? "",
    company.sector ?? "",
  ];
}

export function filterCompanies(companies: SheetCompany[], filters: CompanySheetFilters): SheetCompany[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return companies.filter((company) => {
    if (query && !allSearchValues(company).some((value) => String(value).toLocaleLowerCase().includes(query))) return false;
    if (filters.column !== null && filters.value !== null && getSheetCellValue(company, filters.column) !== filters.value) return false;
    return true;
  });
}

export function sortCompanies(
  companies: SheetCompany[],
  column: SheetColumn,
  direction: "ascending" | "descending",
): SheetCompany[] {
  const multiplier = direction === "ascending" ? 1 : -1;
  return companies
    .map((company, index) => ({ company, index }))
    .sort((left, right) => {
      const comparison = getSheetCellValue(left.company, column).localeCompare(
        getSheetCellValue(right.company, column),
        undefined,
        { numeric: true, sensitivity: "base" },
      );
      return comparison === 0 ? left.index - right.index : comparison * multiplier;
    })
    .map(({ company }) => company);
}

export function toggleCompanySelection(selectedIds: string[], id: string): string[] {
  return selectedIds.includes(id) ? selectedIds.filter((selectedId) => selectedId !== id) : [...selectedIds, id];
}

export function toggleVisibleSelection(selectedIds: string[], visibleIds: string[]): string[] {
  if (!visibleIds.length) return [...selectedIds];
  const visible = new Set(visibleIds);
  const allVisibleSelected = visibleIds.every((id) => selectedIds.includes(id));
  if (allVisibleSelected) return selectedIds.filter((id) => !visible.has(id));
  const next = [...selectedIds];
  for (const id of visibleIds) if (!next.includes(id)) next.push(id);
  return next;
}
