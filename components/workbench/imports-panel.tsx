"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Clock3, RefreshCw, RotateCcw, UploadCloud } from "lucide-react";
import { ImportDialog } from "./import-dialog";

export type ImportErrorRecord = { row?: number; message: string };

export type ImportRecord = {
  id: string;
  fileName: string;
  fileType: string;
  status: string;
  rowCount: number;
  acceptedCount: number;
  duplicateCount: number;
  errorCount: number;
  errors: ImportErrorRecord[];
  runId: string | null;
  createdAt: string;
  updatedAt: string;
};

type Props = { initialImports?: ImportRecord[] };

const STATUS_LABELS: Record<string, string> = {
  stored: "Stored",
  reprocessed: "Reprocessed",
  queued: "Queued",
  running: "Researching",
  completed: "Completed",
  partial: "Partial",
  failed: "Failed",
};

export function importStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusClass(status: string): string {
  if (status === "completed" || status === "stored" || status === "reprocessed") return "badge badge-green";
  if (status === "failed") return "badge badge-amber";
  if (status === "partial") return "badge badge-purple";
  return "badge badge-blue";
}

function statusIcon(status: string) {
  if (["completed", "stored", "reprocessed"].includes(status)) return <CheckCircle2 size={14} />;
  if (status === "failed") return <AlertCircle size={14} />;
  return <Clock3 size={14} />;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function ImportsPanel({ initialImports }: Props) {
  const [records, setRecords] = useState<ImportRecord[]>(initialImports ?? []);
  const [loading, setLoading] = useState(initialImports === undefined);
  const [error, setError] = useState<string | null>(null);
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/imports", { cache: "no-store" });
      const body = await response.json() as { imports?: ImportRecord[]; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Unable to load imports.");
      setRecords(body.imports ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load imports.");
    } finally {
      setLoading(false);
    }
  }, []);

  async function reprocess(importId: string) {
    setReprocessingId(importId);
    setError(null);
    try {
      const response = await fetch(`/api/imports/${encodeURIComponent(importId)}/reprocess`, { method: "POST" });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Unable to reprocess the stored file.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to reprocess the stored file.");
    } finally {
      setReprocessingId(null);
    }
  }

  useEffect(() => {
    if (initialImports !== undefined) return;
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [initialImports, refresh]);

  const hasActiveImport = useMemo(() => records.some((record) => ["queued", "running"].includes(record.status)), [records]);
  useEffect(() => {
    if (!hasActiveImport) return;
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [hasActiveImport, refresh]);

  return <section className="space-y-4" aria-label="Import history">
    <div className="standalone-card import-toolbar">
      <div>
        <p className="eyebrow">Source data</p>
        <h2 className="mt-1 text-lg font-semibold tracking-[-0.03em] text-slate-900">Stored company lists</h2>
        <p className="mt-1 text-sm leading-6 text-slate-500">Every accepted row is stored in your private workspace with its source fields intact. Enrich companies one at a time when you choose.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="secondary-button" onClick={() => void refresh()} disabled={loading} aria-label="Refresh imports"><RefreshCw size={15} className={loading ? "animate-spin" : ""} />Refresh imports</button>
        <ImportDialog onImported={refresh} />
      </div>
    </div>
    {error && <div className="status-banner" role="alert"><AlertCircle size={15} /><span>{error}</span></div>}
    {loading && !records.length ? <div className="standalone-card" role="status">Loading stored imports…</div> : records.length ? <div className="space-y-3">{records.map((record) => <ImportRow key={record.id} record={record} onReprocess={() => void reprocess(record.id)} reprocessing={reprocessingId === record.id} />)}</div> : <div className="standalone-card empty-state"><div className="empty-dot"><UploadCloud size={15} className="mx-auto translate-y-2 text-blue-500" /></div><h2 className="font-semibold text-slate-800">No imports yet</h2><p className="mt-1 text-sm text-slate-500">Import a CSV or XLSX to add your first company list.</p></div>}
  </section>;
}

function ImportRow({ record, onReprocess, reprocessing }: { record: ImportRecord; onReprocess: () => void; reprocessing: boolean }) {
  const visibleErrors = record.errors.slice(0, 3);
  return <article className="standalone-card import-row">
    <div className="flex min-w-0 items-start justify-between gap-4">
      <div className="min-w-0"><p className="truncate font-semibold text-slate-900">{record.fileName}</p><p className="mt-1 text-xs text-slate-400">Uploaded {formatDate(record.createdAt)}</p></div>
      <span className={statusClass(record.status)}>{statusIcon(record.status)}{importStatusLabel(record.status)}</span>
    </div>
    <div className="import-metrics" aria-label={`${record.fileName} import counts`}><span aria-label={`${record.rowCount} rows`}><strong>{record.rowCount}</strong> rows</span><span aria-label={`${record.acceptedCount} accepted`}><strong>{record.acceptedCount}</strong> accepted</span><span aria-label={`${record.duplicateCount} duplicates`}><strong>{record.duplicateCount}</strong> duplicates</span><span aria-label={`${record.errorCount} errors`}><strong>{record.errorCount}</strong> errors</span></div>
    {visibleErrors.length > 0 && <div className="import-errors"><p className="text-xs font-semibold text-amber-800">Import notes</p>{visibleErrors.map((item, index) => <p key={`${item.row ?? "row"}-${index}`} className="mt-1 text-xs text-amber-700">{item.row ? `Row ${item.row}: ` : ""}{item.message}</p>)}</div>}
    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500"><span>Last update {formatDate(record.updatedAt)}</span>{record.runId && <a className="text-blue-600 hover:underline" href={`/history?run=${encodeURIComponent(record.runId)}`}>Run {record.runId}</a>}{["queued", "failed", "partial"].includes(record.status) && record.runId && <a className="text-blue-600 hover:underline" href={`/history?run=${encodeURIComponent(record.runId)}`}>Review and retry</a>}<button type="button" className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:underline disabled:cursor-wait disabled:opacity-60" onClick={onReprocess} disabled={reprocessing}><RotateCcw size={12} className={reprocessing ? "animate-spin" : ""} />{reprocessing ? "Reprocessing…" : "Reprocess file"}</button></div>
  </article>;
}
