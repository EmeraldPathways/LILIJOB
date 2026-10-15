"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type RecordValue = Record<string, unknown>;
type Company = { id: string; name: string };
type Job = { id: string; companyId: string; title: string; url: string | null; location: string | null; salary: string | null; status: string; confidence?: string | null; updatedAt: string };
type DiscoveryRun = { id: string; status: string; error: string | null; resultCount: number; changesCount: number; createdAt: string };

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as RecordValue;
  if (!response.ok) {
    const error = body.error && typeof body.error === "object" ? body.error as RecordValue : {};
    throw new Error(typeof error.message === "string" ? error.message : `Request failed (${response.status}).`);
  }
  return body as T;
}

export function JobRadarPanel() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [runs, setRuns] = useState<DiscoveryRun[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [filters, setFilters] = useState({ title: "", location: "", status: "", salaryPresent: false, newDays: "" });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.title.trim()) params.set("title", filters.title.trim());
      if (filters.location.trim()) params.set("location", filters.location.trim());
      if (filters.status) params.set("status", filters.status);
      if (filters.salaryPresent) params.set("salaryPresent", "true");
      if (filters.newDays) params.set("newDays", filters.newDays);
      const query = params.toString();
      const [jobResult, companyResult, runResult] = await Promise.all([
        requestJson<{ jobs?: Job[] }>(`/api/v4/jobs${query ? `?${query}` : ""}`),
        requestJson<{ companies?: Company[] }>("/api/companies"),
        requestJson<{ runs?: DiscoveryRun[] }>("/api/v4/jobs/runs?limit=10"),
      ]);
      setJobs(jobResult.jobs ?? []);
      const nextCompanies = companyResult.companies ?? [];
      setCompanies(nextCompanies);
      setRuns(runResult.runs ?? []);
      if (!companyId && nextCompanies[0]) setCompanyId(nextCompanies[0].id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Job Radar could not be loaded.");
    } finally {
      setBusy(false);
    }
  }, [companyId, filters]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function refresh(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const result = await requestJson<RecordValue>("/api/v4/jobs/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ companyId, sourceUrl }) });
      setMessage(`Source checked: ${String((result.result as RecordValue | undefined)?.status ?? "complete")}. Existing roles are retained when a source is blocked or empty.`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Career source could not be refreshed.");
    } finally {
      setBusy(false);
    }
  }

  async function report(jobId: string) {
    const reason = window.prompt("Why should this job be reviewed?", "The posting appears closed or inaccurate.");
    if (!reason?.trim()) return;
    try {
      await requestJson(`/api/v4/jobs/${encodeURIComponent(jobId)}/report`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) });
      setMessage("Invalid-job report saved for review.");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The invalid-job report could not be saved.");
    }
  }

  async function runAction(runId: string, action: "cancel" | "retry") {
    try {
      await requestJson(`/api/v4/jobs/runs/${encodeURIComponent(runId)}${action === "retry" ? "/retry" : ""}`, { method: "POST" });
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : `The run could not be ${action}d.`);
    }
  }

  return <section className="workspace-frame__page">
    <div className="standalone-header"><p className="eyebrow">Official career sources</p><div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="workspace-title">Job radar</h1><p className="workspace-description">Refresh one public company source at a time, review verified and discovered roles, and keep source failures separate from closed jobs.</p></div><button className="secondary-button" type="button" onClick={() => void load()} disabled={busy}>{busy ? "Loading…" : "Refresh"}</button></div></div>
    {error && <div className="status-banner" role="alert">{error}</div>}
    {message && <div className="status-banner" role="status">{message}</div>}
    <div className="grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
      <form className="standalone-card" onSubmit={(event) => void refresh(event)}><p className="eyebrow">User-initiated refresh</p><label className="filter-field">Company<select value={companyId} onChange={(event) => setCompanyId(event.target.value)} required><option value="">Choose a company</option>{companies.slice(0, 500).map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}</select></label><label className="filter-field">Official careers URL<input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://company.com/careers" required /></label><p className="mt-3 text-xs leading-5 text-slate-500">Only public HTTP(S) sources are accepted. A blocked, stale or empty response is recorded as source status and never treated as a closed job.</p><button className="primary-button mt-4" type="submit" disabled={busy || !companyId}>Refresh official source</button></form>
      <section className="standalone-card"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">Saved opportunities</p><p className="mt-1 text-xs text-slate-500">{jobs.length} matching saved role{jobs.length === 1 ? "" : "s"}</p></div><div className="flex flex-wrap gap-2"><input aria-label="Filter jobs by title" value={filters.title} onChange={(event) => setFilters((current) => ({ ...current, title: event.target.value }))} placeholder="Title" /><input aria-label="Filter jobs by location" value={filters.location} onChange={(event) => setFilters((current) => ({ ...current, location: event.target.value }))} placeholder="Location" /></div></div><div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-600"><label>Status <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="">All</option><option value="open">Open</option><option value="closed">Closed</option></select></label><label className="flex items-center gap-1"><input type="checkbox" checked={filters.salaryPresent} onChange={(event) => setFilters((current) => ({ ...current, salaryPresent: event.target.checked }))} /> Salary published</label><label>New <select value={filters.newDays} onChange={(event) => setFilters((current) => ({ ...current, newDays: event.target.value }))}><option value="">Any date</option><option value="1">24 hours</option><option value="3">3 days</option><option value="7">7 days</option></select></label></div><div className="mt-3 overflow-x-auto">{jobs.length ? <table className="run-table"><thead><tr><th>Role</th><th>Location</th><th>Status</th><th>Checked</th><th>Actions</th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}><td><strong>{job.title}</strong>{job.url && <a className="block text-xs text-blue-600 hover:underline" href={job.url} target="_blank" rel="noreferrer">Open source</a>}</td><td>{job.location ?? "Unknown"}</td><td>{job.status} · {job.confidence ?? "unknown"}</td><td>{new Date(job.updatedAt).toLocaleDateString()}</td><td><button className="secondary-button" type="button" onClick={() => void report(job.id)}>Report invalid</button></td></tr>)}</tbody></table> : <p className="empty-state">No saved jobs match these filters.</p>}</div></section>
    </div>
    <section className="standalone-card mt-5"><p className="eyebrow">Refresh history</p>{runs.length ? <div className="mt-3 overflow-x-auto"><table className="run-table"><thead><tr><th>Status</th><th>Result</th><th>Changes</th><th>Started</th><th>Action</th></tr></thead><tbody>{runs.map((run) => <tr key={run.id}><td>{run.status}{run.error && <small>{run.error}</small>}</td><td>{run.resultCount}</td><td>{run.changesCount}</td><td>{new Date(run.createdAt).toLocaleString()}</td><td>{["queued", "running"].includes(run.status) && <button className="secondary-button" type="button" onClick={() => void runAction(run.id, "cancel")}>Cancel</button>}{["failed", "partial", "cancelled"].includes(run.status) && <button className="secondary-button" type="button" onClick={() => void runAction(run.id, "retry")}>Retry</button>}</td></tr>)}</tbody></table></div> : <p className="empty-state mt-3">No refresh runs yet.</p>}</section>
  </section>;
}
