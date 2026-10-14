import { useRef, useState } from "react";
import { FileSpreadsheet, UploadCloud, X } from "lucide-react";

export function ImportDialog({ onImported }: { onImported: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function submit(file: File) {
    setBusy(true); setMessage(null);
    try {
      const form = new FormData(); form.set("file", file);
      const response = await fetch("/api/imports", { method: "POST", body: form });
      const body = await response.json() as { summary?: { accepted: number; duplicates: number }; error?: { message: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Import failed");
      setMessage(`${body.summary?.accepted ?? 0} rows queued for enrichment${body.summary?.duplicates ? ` · ${body.summary.duplicates} duplicate${body.summary.duplicates === 1 ? "" : "s"} merged` : ""}.`);
      onImported();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Import failed"); }
    finally { setBusy(false); }
  }
  return <>
    <button type="button" className="secondary-button" onClick={() => setOpen(true)} aria-label="Import companies"><UploadCloud size={16} />Import file</button>
    {open && <div className="modal-backdrop" role="dialog" aria-modal="true"><div className="modal-card"><div className="flex items-start justify-between"><div><p className="eyebrow">Add source data</p><h2 className="mt-2 text-xl font-semibold tracking-[-0.04em] text-slate-900">Import a company list</h2></div><button className="icon-button" type="button" onClick={() => setOpen(false)} aria-label="Close"><X size={17} /></button></div><p className="mt-3 text-sm leading-6 text-slate-500">CSV and XLSX files are stored privately, mapped across common headings, then queued for fresh Dublin research.</p><button type="button" className="upload-dropzone mt-6" onClick={() => inputRef.current?.click()} disabled={busy}><FileSpreadsheet size={24} className="text-blue-500" /><span className="mt-2 text-sm font-semibold text-slate-800">{busy ? "Uploading…" : "Choose CSV or XLSX"}</span><span className="mt-1 text-xs text-slate-400">Unknown columns are kept as metadata</span></button><input ref={inputRef} type="file" className="hidden" accept=".csv,.xlsx" onChange={(event) => { const file = event.target.files?.[0]; if (file) void submit(file); }} />{message && <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{message}</p>}<div className="mt-6 flex justify-end"><button type="button" className="secondary-button" onClick={() => setOpen(false)}>Done</button></div></div></div>}
  </>;
}
