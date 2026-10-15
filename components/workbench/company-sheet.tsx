"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { CompanyListItem } from "../../lib/repositories/company-repository";
import {
  filterCompanies,
  getColumnFilterValues,
  getSheetCellValue,
  getSheetColumns,
  sortCompanies,
  toggleCompanySelection,
  toggleVisibleSelection,
  type SheetColumn,
  type SheetCompany,
} from "../../lib/sheet/company-sheet";
import "./company-sheet.css";

type CompanySheetProps = {
  companies: CompanyListItem[];
  selectedIds: string[];
  onSelectionChange(ids: string[]): void;
  onSaveCell(id: string, column: string, value: string): Promise<void>;
  onOpenDetail(id: string): void;
};

const ALL_COLUMNS = "all-columns";
const ALL_VALUES = "all-values";
const FILTER_VALUE_PREFIX = "value:";
const FILTER_COLUMN_PREFIX = "column:";

type SortState = { columnId: string; direction: "ascending" | "descending" } | null;

export function CompanySheet({ companies, selectedIds, onSelectionChange, onSaveCell, onOpenDetail }: CompanySheetProps) {
  const sheetCompanies = companies as SheetCompany[];
  const columns = useMemo(() => getSheetColumns(sheetCompanies), [sheetCompanies]);
  const selectedIdsRef = useRef(selectedIds);
  const previousSelectedIdsProp = useRef(selectedIds);
  if (previousSelectedIdsProp.current !== selectedIds) {
    previousSelectedIdsProp.current = selectedIds;
    selectedIdsRef.current = selectedIds;
  }

  const [query, setQuery] = useState("");
  const [filterColumnId, setFilterColumnId] = useState<string | null>(null);
  const [filterValue, setFilterValue] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>(null);
  const [cellDrafts, setCellDrafts] = useState<Record<string, string>>({});
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({});
  const [savingCells, setSavingCells] = useState<Set<string>>(() => new Set());
  const savingCellsRef = useRef(new Set<string>());
  const cancelledBlurRef = useRef(new Set<string>());

  const filterColumn = columns.find((column) => column.id === filterColumnId) ?? null;
  const filterValues = filterColumn ? getColumnFilterValues(sheetCompanies, filterColumn) : [];
  const filteredCompanies = filterCompanies(sheetCompanies, {
    query,
    column: filterColumn,
    value: filterValue,
  });
  const sortColumn = sort ? columns.find((column) => column.id === sort.columnId) : null;
  const visibleCompanies = sort && sortColumn
    ? sortCompanies(filteredCompanies, sortColumn, sort.direction)
    : filteredCompanies;
  const visibleIds = visibleCompanies.map((company) => company.id);
  const effectiveSelectedIds = selectedIdsRef.current;
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => effectiveSelectedIds.includes(id));

  function changeSelection(nextIds: string[]) {
    selectedIdsRef.current = nextIds;
    onSelectionChange(nextIds);
  }

  function getCellKey(id: string, column: SheetColumn): string {
    return JSON.stringify([id, column.id]);
  }

  function getCellErrorId(key: string): string {
    return `company-sheet-error-${encodeURIComponent(key).replaceAll("%", "_")}`;
  }

  function getCellValue(company: SheetCompany, column: SheetColumn): string {
    return getSheetCellValue(company, column);
  }

  function toggleSort(column: SheetColumn) {
    setSort((current) => ({
      columnId: column.id,
      direction: current?.columnId === column.id && current.direction === "ascending" ? "descending" : "ascending",
    }));
  }

  async function saveCell(company: SheetCompany, column: SheetColumn, value: string) {
    const key = getCellKey(company.id, column);
    if (savingCellsRef.current.has(key)) return;
    const originalValue = getCellValue(company, column);
    if (value === originalValue) {
      setCellDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      return;
    }

    savingCellsRef.current.add(key);
    setSavingCells((current) => new Set(current).add(key));
    setCellErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    try {
      await onSaveCell(company.id, column.key, value);
      setCellDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    } catch (error) {
      setCellDrafts((current) => ({ ...current, [key]: value }));
      setCellErrors((current) => ({
        ...current,
        [key]: error instanceof Error && error.message ? error.message : "Could not save this cell. Try again.",
      }));
    } finally {
      savingCellsRef.current.delete(key);
      setSavingCells((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  function handleCellKeyDown(event: KeyboardEvent<HTMLInputElement>, company: SheetCompany, column: SheetColumn) {
    const key = getCellKey(company.id, column);
    if (event.key === "Enter") {
      event.preventDefault();
      void saveCell(company, column, event.currentTarget.value);
      event.currentTarget.blur();
    }
    if (event.key === "Escape") {
      cancelledBlurRef.current.add(key);
      setCellDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setCellErrors((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      event.currentTarget.blur();
    }
  }

  function renderHeader(column: SheetColumn) {
    const isSorted = sort?.columnId === column.id;
    return (
      <th key={column.id} scope="col" aria-sort={isSorted ? sort.direction : "none"}>
        <div className="company-sheet-heading">
          <button type="button" className="company-sheet-sort" onClick={() => toggleSort(column)} aria-label={`Sort by ${column.label}`}>
            <span>{column.label}</span>
            <span className="company-sheet-sort-indicator" aria-hidden="true">{isSorted ? sort.direction === "ascending" ? "↑" : "↓" : "↕"}</span>
          </button>
          {column.source === "profile" && <span className="company-sheet-origin-badge">Profile value</span>}
        </div>
      </th>
    );
  }

  return (
    <section className="company-sheet" aria-label="Company spreadsheet">
      <div className="company-sheet-toolbar">
        <label className="company-sheet-search">
          <span className="company-sheet-control-label">Search all spreadsheet values</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search every field"
            aria-label="Search all spreadsheet values"
          />
        </label>
        <label className="company-sheet-filter">
          <span className="company-sheet-control-label">Filter column</span>
          <select
            aria-label="Filter by column"
            value={filterColumnId === null ? ALL_COLUMNS : `${FILTER_COLUMN_PREFIX}${filterColumnId}`}
            onChange={(event) => {
              const nextId = event.target.value === ALL_COLUMNS ? null : event.target.value.slice(FILTER_COLUMN_PREFIX.length);
              setFilterColumnId(nextId);
              setFilterValue(null);
            }}
          >
            <option value={ALL_COLUMNS}>Any column</option>
            {columns.map((column) => <option key={column.id} value={`${FILTER_COLUMN_PREFIX}${column.id}`}>{column.label}{column.source === "profile" ? " (profile)" : ""}</option>)}
          </select>
        </label>
        <label className="company-sheet-filter">
          <span className="company-sheet-control-label">Filter value</span>
          <select
            aria-label="Filter by value"
            value={filterValue === null ? ALL_VALUES : `${FILTER_VALUE_PREFIX}${filterValue}`}
            onChange={(event) => setFilterValue(event.target.value === ALL_VALUES ? null : event.target.value.slice(FILTER_VALUE_PREFIX.length))}
            disabled={!filterColumn}
          >
            <option value={ALL_VALUES}>All values</option>
            {filterValues.map((value, index) => (
              <option key={`${value}-${index}`} value={`${FILTER_VALUE_PREFIX}${value}`}>{value === "" ? "(blank)" : value}</option>
            ))}
          </select>
        </label>
        <p className="company-sheet-count" aria-live="polite">{visibleCompanies.length} of {companies.length} companies</p>
      </div>

      <div className="company-sheet-scroll" role="region" aria-label="Scrollable company spreadsheet" tabIndex={0}>
        <table className="company-sheet-table">
          <thead>
            <tr>
              <th className="company-sheet-select-column" scope="col">
                <input
                  type="checkbox"
                  aria-label="Select all visible rows"
                  checked={allVisibleSelected}
                  onChange={() => changeSelection(toggleVisibleSelection(selectedIdsRef.current, visibleIds))}
                />
              </th>
              {columns.map(renderHeader)}
              <th className="company-sheet-actions-column" scope="col">Details</th>
            </tr>
          </thead>
          <tbody>
            {visibleCompanies.length ? visibleCompanies.map((record) => {
              const company = record as SheetCompany;
              return (
                <tr key={company.id}>
                  <td className="company-sheet-select-column">
                    <input
                      type="checkbox"
                      aria-label={`Select ${company.name}`}
                      checked={effectiveSelectedIds.includes(company.id)}
                      onChange={() => changeSelection(toggleCompanySelection(selectedIdsRef.current, company.id))}
                    />
                  </td>
                  {columns.map((column) => {
                    const key = getCellKey(company.id, column);
                    const errorId = getCellErrorId(key);
                    const value = cellDrafts[key] ?? getCellValue(company, column);
                    return (
                      <td key={column.id} data-origin={column.source} title={column.source === "profile" ? "Synthesized from the company profile; not an imported spreadsheet value." : undefined}>
                        <input
                          className="company-sheet-cell-input"
                          aria-label={`Edit ${company.name} — ${column.label}`}
                          value={value}
                          disabled={savingCells.has(key)}
                          onChange={(event) => {
                            setCellDrafts((current) => ({ ...current, [key]: event.target.value }));
                            setCellErrors((current) => {
                              const next = { ...current };
                              delete next[key];
                              return next;
                            });
                          }}
                          onBlur={(event) => {
                            if (cancelledBlurRef.current.delete(key)) return;
                            void saveCell(company, column, event.currentTarget.value);
                          }}
                          onKeyDown={(event) => handleCellKeyDown(event, company, column)}
                          aria-invalid={Boolean(cellErrors[key])}
                          aria-describedby={cellErrors[key] ? errorId : undefined}
                        />
                        {cellErrors[key] && <span className="company-sheet-cell-error" id={errorId} role="alert">{cellErrors[key]}</span>}
                        {savingCells.has(key) && <span className="company-sheet-saving" role="status">Saving…</span>}
                      </td>
                    );
                  })}
                  <td className="company-sheet-actions-column">
                    <button type="button" className="company-sheet-detail-button" onClick={() => onOpenDetail(company.id)} aria-label={`View details for ${company.name}`}>
                      View details
                    </button>
                  </td>
                </tr>
              );
            }) : (
              <tr><td className="company-sheet-empty" colSpan={columns.length + 2}>{companies.length ? "No companies match these filters." : "No companies to show yet."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
