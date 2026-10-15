import type { CompanyCategory } from "../domain/types";

export type ColumnMapping = {
  companyName?: string;
  website?: string;
  aliases?: string;
  category?: string;
  sector?: string;
  location?: string;
  careersUrl?: string;
  description?: string;
  employeeBand?: string;
  foundedYear?: string;
  [key: string]: string | string[] | undefined;
  unknown: string[];
};

export type ParsedWorkbook = {
  fileName: string;
  headers: string[];
  rows: Record<string, string>[];
  dataStartRow?: number;
  rowSheetNames?: string[];
  rowNumbers?: number[];
};

export type ImportPlanRow = {
  rowNumber: number;
  companyName: string;
  website: string | null;
  aliases: string[];
  category: CompanyCategory | null;
  location: string | null;
  careersUrl: string | null;
  description: string | null;
  employeeBand: string | null;
  foundedYear: number | null;
  metadata: Record<string, unknown>;
  original: Record<string, string>;
};

export type ImportRowError = { row: number; message: string };

export type ImportPlan = {
  rows: ImportPlanRow[];
  accepted: number;
  duplicates: number;
  errors: ImportRowError[];
};
