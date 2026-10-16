"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Cadence = { frequency: "daily" | "weekly"; time: string; weekday: number };
type Preferences = { timezone: string; digestEnabled: boolean; quietStart: string | null; quietEnd: string | null; cadence: Cadence; consent: boolean };
type Digest = { status: string; generatedAt: string; timezone: string; summary: string; quietHoursActive: boolean; delivery: string; items: Array<{ searchId: string; name: string; query: { text: string; scope: string }; lastRunAt: string | null; resultCount: number | null }> };
type Value = Record<string, unknown>;

const defaults: Preferences = { timezone: "Europe/Dublin", digestEnabled: false, quietStart: null, quietEnd: null, cadence: { frequency: "daily", time: "09:00", weekday: 1 }, consent: false };
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as Value;
  if (!response.ok) {
    const error = body.error && typeof body.error === "object" ? body.error as Value : {};
    throw new Error(typeof error.message === "string" ? error.message : `Request failed (${response.status}).`);
  }
  return body as T;
}

function timeInput(value: string | null): string { return value ?? ""; }

function dateLabel(value: string | null): string {
  if (!value) return "Not run yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleString();
}

export function NotificationsWorkspace() {
  const [preferences, setPreferences] = useState<Preferences>(defaults);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [preferenceResult, digestResult] = await Promise.all([
        requestJson<{ preferences: Preferences }>("/api/v4/notifications/preferences"),
        requestJson<{ digest: Digest }>("/api/v4/notifications/digest"),
      ]);
      setPreferences(preferenceResult.preferences);
      setDigest(digestResult.digest);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Notification preferences could not be loaded.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  function update<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    setPreferences((current) => ({ ...current, [key]: value }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await requestJson<{ preferences: Preferences }>("/api/v4/notifications/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(preferences),
      });
      setPreferences(result.preferences);
      const preview = await requestJson<{ digest: Digest }>("/api/v4/notifications/digest");
      setDigest(preview.digest);
      setMessage(result.preferences.digestEnabled ? "In-app digest preferences saved." : "In-app digest is off. No digest is generated.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Notification preferences could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function preview() {
    setError(null);
    try {
      const result = await requestJson<{ digest: Digest }>("/api/v4/notifications/digest");
      setDigest(result.digest);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Digest preview could not be loaded.");
    }
  }

  return <section className="workspace-frame__page">
    <div className="standalone-header">
      <p className="eyebrow">Workspace settings</p>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="workspace-title">In-app digest</h1><p className="workspace-description">Save a preferred in-app digest cadence and review an on-demand preview from saved search results. No background schedule sends email or push, and searches never run automatically.</p></div>
        <a className="secondary-button" href="/saved-searches">Saved searches</a>
      </div>
    </div>
    {error && <div className="status-banner" role="alert">{error}</div>}
    {message && <div className="status-banner" role="status">{message}</div>}

    <div className="grid gap-5 xl:grid-cols-[.9fr_1.1fr]">
      <form className="standalone-card" onSubmit={(event) => void save(event)}>
        <p className="eyebrow">Preferences</p>
        <label className="filter-field">Timezone<input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800" value={preferences.timezone} onChange={(event) => update("timezone", event.target.value)} placeholder="Europe/Dublin" required /></label>
        <p className="mt-1 text-xs text-slate-500">Use an IANA timezone such as Europe/Dublin or America/New_York.</p>
        <div className="mt-5 rounded-xl border border-slate-200 p-3">
          <label className="flex items-start gap-3 text-sm text-slate-800"><input className="mt-1 accent-blue-600" type="checkbox" checked={preferences.digestEnabled} onChange={(event) => { update("digestEnabled", event.target.checked); if (!event.target.checked) update("consent", false); }} /><span><strong>Enable the in-app digest preview</strong><span className="mt-1 block text-xs leading-5 text-slate-500">The preview uses saved search names and their most recent saved local results.</span></span></label>
          <label className="mt-3 flex items-start gap-3 text-sm text-slate-800"><input className="mt-1 accent-blue-600" type="checkbox" checked={preferences.consent} onChange={(event) => update("consent", event.target.checked)} /><span>I consent to this internal digest being generated from my saved search data.</span></label>
        </div>

        <p className="eyebrow mt-6">Preferred cadence</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="filter-field">Cadence<select value={preferences.cadence.frequency} onChange={(event) => update("cadence", { ...preferences.cadence, frequency: event.target.value as Cadence["frequency"] })}><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label>
          <label className="filter-field">Preferred local time<input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800" type="time" value={preferences.cadence.time} onChange={(event) => update("cadence", { ...preferences.cadence, time: event.target.value })} required /></label>
          {preferences.cadence.frequency === "weekly" && <label className="filter-field sm:col-span-2">Day of week<select value={preferences.cadence.weekday} onChange={(event) => update("cadence", { ...preferences.cadence, weekday: Number(event.target.value) })}>{weekdays.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>}
        </div>
        <p className="eyebrow mt-6">Quiet hours</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="filter-field">Start<input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800" type="time" value={timeInput(preferences.quietStart)} onChange={(event) => update("quietStart", event.target.value || null)} /></label>
          <label className="filter-field">End<input className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800" type="time" value={timeInput(preferences.quietEnd)} onChange={(event) => update("quietEnd", event.target.value || null)} /></label>
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-500">Quiet hours use local wall-clock time in the selected timezone and follow daylight saving changes. Both times are required, or leave both empty.</p>
        <button className="primary-button mt-4" type="submit" disabled={busy || saving}>{saving ? "Saving…" : "Save preferences"}</button>
      </form>

      <section className="standalone-card" aria-labelledby="digest-preview-title">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow">On-demand preview</p><h2 id="digest-preview-title" className="mt-1 text-xl font-semibold text-slate-900">Saved search summary</h2></div><button className="secondary-button" type="button" onClick={() => void preview()} disabled={busy}>Refresh preview</button></div>
        {busy && !digest ? <p className="mt-4 text-sm text-slate-500">Loading digest preferences…</p> : digest && <>
          <div className="mt-4 rounded-xl bg-slate-50 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><span className="badge badge-muted">{digest.status.replaceAll("-", " ")}</span><span className="text-xs text-slate-500">Timezone: {digest.timezone}</span></div><p className="mt-3 text-sm text-slate-700">{digest.summary}</p><p className="mt-2 text-xs leading-5 text-slate-500">{digest.delivery}</p>{digest.quietHoursActive && <p className="mt-2 text-xs font-medium text-amber-700">Quiet hours are active now in {digest.timezone}. This page still shows the internal preview when you open it.</p>}</div>
          {digest.items.length ? <div className="mt-4 space-y-2">{digest.items.map((item) => <article className="rounded-xl border border-slate-200 p-3" key={item.searchId}><div className="flex flex-wrap items-start justify-between gap-2"><div><strong className="text-sm text-slate-800">{item.name}</strong><p className="mt-1 text-xs text-slate-500">“{item.query.text}” · {item.query.scope}</p></div><span className="badge badge-blue">{item.resultCount === null ? "Not run" : `${item.resultCount} matches`}</span></div><p className="mt-2 text-xs text-slate-500">Last run: {dateLabel(item.lastRunAt)}</p></article>)}</div> : <div className="empty-state mt-4"><p className="font-semibold text-slate-800">No saved digest entries</p><p className="mt-1 text-sm text-slate-500">Opt in and run a saved search to see an internal summary here.</p><a className="secondary-button mt-3" href="/saved-searches">Manage saved searches</a></div>}
        </>}
      </section>
    </div>
  </section>;
}
