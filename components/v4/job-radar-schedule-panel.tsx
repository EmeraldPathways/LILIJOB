"use client";

import { useCallback, useEffect, useState } from "react";

type Company = { id: string; name: string };
type Schedule = {
  companyIds: string[];
  cadence: "daily" | "weekly";
  enabled: boolean;
  cursorIndex: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastResultJson: string | null;
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const error = body.error && typeof body.error === "object" ? body.error as Record<string, unknown> : {};
    throw new Error(typeof error.message === "string" ? error.message : `Request failed (${response.status}).`);
  }
  return body as T;
}

function formatDate(value: string | null): string {
  if (!value) return "Not run yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-IE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Dublin" }).format(date);
}

export function JobRadarSchedulePanel() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [companyIds, setCompanyIds] = useState<string[]>([]);
  const [cadence, setCadence] = useState<"daily" | "weekly">("weekly");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [companyResult, scheduleResult] = await Promise.all([
        requestJson<{ companies?: Company[] }>("/api/companies"),
        requestJson<{ schedule?: Schedule | null }>("/api/v4/schedules/job-radar"),
      ]);
      const nextCompanies = companyResult.companies ?? [];
      const nextSchedule = scheduleResult.schedule ?? null;
      setCompanies(nextCompanies);
      setSchedule(nextSchedule);
      setCompanyIds(nextSchedule?.companyIds ?? []);
      setCadence(nextSchedule?.cadence ?? "weekly");
      setEnabled(nextSchedule?.enabled ?? false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Job Radar schedule could not be loaded.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  function toggleCompany(id: string) {
    setCompanyIds((current) => current.includes(id) ? current.filter((companyId) => companyId !== id) : [...current, id]);
  }

  async function save() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await requestJson<{ schedule: Schedule }>("/api/v4/schedules/job-radar", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyIds, cadence, enabled }),
      });
      setSchedule(result.schedule);
      setCompanyIds(result.schedule.companyIds);
      setCadence(result.schedule.cadence);
      setEnabled(result.schedule.enabled);
      setMessage(result.schedule.enabled ? "Opt-in refresh schedule saved." : "Refresh schedule paused.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Job Radar schedule could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function runNow() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await requestJson<{ result: { companiesProcessed?: number; continuations?: number; skippedSchedules?: number } }>("/api/v4/schedules/job-radar/run-due", { method: "POST" });
      const count = result.result.companiesProcessed ?? 0;
      setMessage(count
        ? `${count} selected ${count === 1 ? "company was" : "companies were"} checked. ${result.result.continuations ? "Run again to continue the saved scope." : "The selected scope is complete."}`
        : result.result.skippedSchedules ? "A refresh is already running for this schedule."
          : "No enabled schedule was ready to run.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The saved Job Radar schedule could not be run.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="standalone-card mt-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="eyebrow">Optional background refresh</p><h2 className="mt-1 text-xl font-semibold text-slate-900">Refresh schedule</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Choose which saved company sources Job Radar may refresh and how often. It stays paused until you opt in here. Automatic runs require a secured deployment scheduler; you can also run a bounded refresh from this screen.</p></div>
      <span className={`badge ${enabled ? "badge-blue" : "badge-muted"}`}>{enabled ? "Enabled" : "Paused"}</span>
    </div>
    {error && <div className="status-banner mt-4" role="alert">{error}</div>}
    {message && <div className="status-banner mt-4" role="status">{message}</div>}
    <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_.8fr]">
      <div>
        <label className="filter-field max-w-xs">Cadence<select value={cadence} onChange={(event) => setCadence(event.target.value as "daily" | "weekly")}><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label>
        <fieldset className="mt-4">
          <legend className="text-sm font-semibold text-slate-800">Companies to refresh</legend>
          {companies.length ? <div className="mt-2 grid gap-2 sm:grid-cols-2">{companies.map((company) => <label className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 text-sm text-slate-700" key={company.id}><input type="checkbox" checked={companyIds.includes(company.id)} onChange={() => toggleCompany(company.id)} />{company.name}</label>)}</div> : <p className="empty-state mt-2">Add companies before setting a refresh schedule.</p>}
        </fieldset>
        <label className="mt-4 flex items-start gap-2 text-sm text-slate-700"><input className="mt-1" type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span><strong>Enable background refresh</strong><span className="mt-1 block text-xs leading-5 text-slate-500">Only selected sources will be checked at the chosen cadence. You can pause the schedule at any time.</span></span></label>
        <div className="mt-4 flex flex-wrap gap-2"><button className="primary-button" type="button" onClick={() => void save()} disabled={busy || (enabled && companyIds.length === 0)}>{busy ? "Saving…" : "Save schedule"}</button><button className="secondary-button" type="button" onClick={() => void runNow()} disabled={busy || !enabled}>{busy ? "Working…" : "Run selected sources now"}</button></div>
      </div>
      <dl className="rounded-xl bg-slate-50 p-4 text-sm">
        <div className="flex justify-between gap-3 border-b border-slate-200 py-2"><dt className="text-slate-500">Next refresh</dt><dd className="text-right font-medium text-slate-800">{formatDate(schedule?.nextRunAt ?? null)}</dd></div>
        <div className="flex justify-between gap-3 border-b border-slate-200 py-2"><dt className="text-slate-500">Last refresh</dt><dd className="text-right font-medium text-slate-800">{formatDate(schedule?.lastRunAt ?? null)}</dd></div>
        <div className="flex justify-between gap-3 py-2"><dt className="text-slate-500">Last status</dt><dd className="text-right font-medium text-slate-800">{schedule?.lastStatus ?? "No runs yet"}</dd></div>
        {schedule?.cursorIndex ? <p className="mt-2 text-xs text-slate-500">Continuing at selected source {schedule.cursorIndex + 1} after the most recent bounded refresh.</p> : null}
      </dl>
    </div>
  </section>;
}
