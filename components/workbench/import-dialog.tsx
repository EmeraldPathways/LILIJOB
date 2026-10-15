import { useRef, useState } from "react";
import { FileSpreadsheet, UploadCloud, X } from "lucide-react";
import type { ImportSummary } from "../../lib/import/import-service";

export function ImportDialog({ onImported }: { onImported?: (summary: ImportSummary) => void | Promise<void> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function submit(file: File) {
    setBusy(true); setMessage(null);
    try {
      const form = new FormData(); form.set("file", file);
      const response = await fetch("/api/imports", { method: "POST", body: form });
      const body = await response.json() as { summary?: ImportSummary; error?: { message: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Import failed");
      const summary = body.summary;
      if (!summary || typeof summary.importId !== "string" || typeof summary.accepted !== "number" || !Array.isArray(summary.categories)) {
        throw new Error("Import was saved without a valid summary. Open Imports to review it.");
      }
      setMessage(`${summary.accepted} rows saved. Choose Research selected, Research all in sector, or Enrich in a profile when ready${summary.duplicates ? ` · ${summary.duplicates} duplicate${summary.duplicates === 1 ? "" : "s"} merged` : ""}.`);
      await onImported?.(summary);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Import failed"); }
    finally { setBusy(false); }
  }
  return <>
    <button type="button" className="secondary-button" onClick={() => setOpen(true)} aria-label="Import companies"><UploadCloud size={16} />Import file</button>
    {open && <div className="modal-backdrop" role="dialog" aria-modal="true"><div className="modal-card"><div className="flex items-start justify-between"><div><p className="eyebrow">Add source data</p><h2 className="mt-2 text-xl font-semibold tracking-[-0.04em] text-slate-900">Import a company list</h2></div><button className="icon-button" type="button" onClick={() => setOpen(false)} aria-label="Close"><X size={17} /></button></div><p className="mt-3 text-sm leading-6 text-slate-500">CSV and XLSX files are stored privately, mapped across common headings, and shown with the source fields intact. Research selected companies or a whole sector when ready. Uploads never start research.</p><button type="button" className="upload-dropzone mt-6" onClick={() => inputRef.current?.click()} disabled={busy}><FileSpreadsheet size={24} className="text-blue-500" /><span className="mt-2 text-sm font-semibold text-slate-800">{busy ? "Uploading…" : "Choose CSV or XLSX"}</span><span className="mt-1 text-xs text-slate-400">All source columns are kept in Sheet view</span></button><input ref={inputRef} type="file" className="hidden" accept=".csv,.xlsx" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void submit(file); }} />{message && <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{message}</p>}<div className="mt-6 flex justify-end"><button type="button" className="secondary-button" onClick={() => setOpen(false)}>Done</button></div></div></div>}
  </>;
}
