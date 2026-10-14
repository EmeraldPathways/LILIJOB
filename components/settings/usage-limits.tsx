"use client";

import { useEffect, useState } from "react";
import type { RunConfig } from "../../lib/jobs/run-config";

const fields: Array<[keyof Pick<RunConfig, "newCompaniesPerCategory" | "searchesPerCompany" | "existingCompaniesPerRefresh">, string, string]> = [
  ["newCompaniesPerCategory", "New companies per category", "Weekly discovery cap"],
  ["searchesPerCompany", "Source searches per company", "Enrichment depth"],
  ["existingCompaniesPerRefresh", "Existing companies per run", "Refresh cap"],
];

export function UsageLimits() {
  const [config, setConfig] = useState<RunConfig | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void fetch("/api/settings", { cache: "no-store" }).then((response) => response.json()).then((body) => { const parsed = body as { config?: RunConfig }; setConfig(parsed.config ?? null); }).catch(() => setMessage("Settings could not be loaded.")); }, []);
  if (!config) return <div className="empty-state">Loading usage controls…</div>;
  async function save() {
    setBusy(true); setMessage(null);
    try { const response = await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(config) }); const body = await response.json() as { config?: RunConfig; error?: { message?: string } }; if (!response.ok) throw new Error(body.error?.message ?? "Settings could not be saved."); setConfig(body.config ?? config); setMessage("Weekly controls saved."); } catch (error) { setMessage(error instanceof Error ? error.message : "Settings could not be saved."); } finally { setBusy(false); }
  }
  return <section className="settings-card"><div><p className="eyebrow">Usage controls</p><h2 className="mt-1 text-xl font-semibold text-slate-900">Keep research spend predictable</h2><p className="mt-2 text-sm leading-6 text-slate-500">These limits apply to the weekly refresh and can be changed later.</p></div><div className="settings-fields">{fields.map(([key, label, hint]) => <label className="filter-field" key={key}><span>{label}<small>{hint}</small></span><input type="number" min={1} value={config[key]} onChange={(event) => setConfig({ ...config, [key]: Number(event.target.value) })} /></label>)}</div><label className="toggle-row"><input type="checkbox" checked={config.paused} onChange={(event) => setConfig({ ...config, paused: event.target.checked })} /><span><strong>Pause scheduled refresh</strong><small>Stored records remain available.</small></span></label><div className="mt-5 flex items-center justify-between gap-3"><p className="text-xs text-slate-500" role="status">{message}</p><button type="button" className="primary-button" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save controls"}</button></div></section>;
}
