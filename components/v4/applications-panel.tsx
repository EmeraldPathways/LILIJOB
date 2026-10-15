"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- API downloads must preserve the browser's download response. */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

type RecordValue = Record<string, unknown>;
type Company = { id: string; name: string };
type Profile = { id: string; name: string };
type Application = { id: string; companyId: string; title: string; stage: string; manualUrl: string | null; jobId: string | null; followupDueAt: string | null; updatedAt: string };
type PackState = { id: string; version: number; payload: RecordValue; sourceUrl: string; applicationId: string };

const stages = ["Target", "Contacted", "Applied", "Follow-up", "Recruiter Call", "Interview", "Final Interview", "Offer", "Rejected", "Withdrawn"];

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as RecordValue;
  if (!response.ok) {
    const error = body.error && typeof body.error === "object" ? body.error as RecordValue : {};
    throw new Error(typeof error.message === "string" ? error.message : `Request failed (${response.status}).`);
  }
  return body as T;
}

function parsePayload(value: unknown): RecordValue {
  if (typeof value === "string") {
    try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as RecordValue : {}; } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}

export function ApplicationsPanel() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [now, setNow] = useState(0);
  const [companyId, setCompanyId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [dueOnly, setDueOnly] = useState(false);
  const [view, setView] = useState<"kanban" | "table">("kanban");
  const [pack, setPack] = useState<PackState | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [appResult, companyResult, profileResult] = await Promise.all([
        requestJson<{ applications?: Application[] }>("/api/v4/applications"),
        requestJson<{ companies?: Company[] }>("/api/companies"),
        requestJson<{ profiles?: Profile[] }>("/api/v4/profiles"),
      ]);
      setApplications(appResult.applications ?? []);
      const nextCompanies = companyResult.companies ?? [];
      const nextProfiles = profileResult.profiles ?? [];
      setCompanies(nextCompanies);
      setProfiles(nextProfiles);
      setNow(Date.now());
      if (!companyId && nextCompanies[0]) setCompanyId(nextCompanies[0].id);
      if (!profileId && nextProfiles[0]) setProfileId(nextProfiles[0].id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Applications could not be loaded.");
    } finally {
      setBusy(false);
    }
  }, [companyId, profileId]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const visible = useMemo(() => applications.filter((application) => {
    const company = companies.find((item) => item.id === application.companyId)?.name ?? "";
    const matchesQuery = !query.trim() || `${application.title} ${company}`.toLowerCase().includes(query.trim().toLowerCase());
    const matchesStage = !stageFilter || application.stage === stageFilter;
    const matchesDue = !dueOnly || Boolean(now > 0 && application.followupDueAt && Date.parse(application.followupDueAt) <= now);
    return matchesQuery && matchesStage && matchesDue;
  }), [applications, companies, dueOnly, now, query, stageFilter]);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestJson("/api/v4/applications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ companyId, title, manualUrl: url || undefined, dedupKey: `${companyId}:${title.toLowerCase()}:${url}` }) });
      setTitle(""); setUrl(""); setMessage("Application target saved."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Application could not be created."); } finally { setBusy(false); }
  }

  async function move(id: string, stage: string) {
    try { await requestJson(`/api/v4/applications/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ stage }) }); setMessage("Stage saved with an immutable activity event."); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Stage could not be saved."); }
  }

  async function addReminder(application: Application) {
    try {
      await requestJson("/api/v4/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "application-followup", reason: `Review follow-up for ${application.title}.`, dedupKey: `application-followup:${application.id}`, applicationId: application.id, dueAt: application.followupDueAt ?? new Date().toISOString(), priority: 20 }) });
      setMessage("Follow-up action added to Today.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Follow-up action could not be saved."); }
  }

  async function prepare(application: Application) {
    if (!application.manualUrl) { setError("This application has no verified posting URL. Add a source link before preparing a pack."); return; }
    setBusy(true); setError(null);
    try {
      const company = companies.find((item) => item.id === application.companyId);
      const result = await requestJson<{ pack?: RecordValue; savedPack?: RecordValue }>("/api/v4/packs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profileId: profileId || undefined, applicationId: application.id, jobTitle: application.title, companyName: company?.name ?? "Company requires confirmation", jobSourceUrl: application.manualUrl, requirements: [], candidateSummary: "Review the approved candidate evidence before using this draft." }) });
      const saved = result.savedPack ?? {};
      setPack({ id: String(saved.id ?? ""), version: Number(saved.version ?? 1), payload: parsePayload(result.pack), sourceUrl: application.manualUrl, applicationId: application.id });
      setMessage("Pack prepared from approved evidence. Edit and save a new private version before use.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Application pack could not be generated."); } finally { setBusy(false); }
  }

  async function savePack() {
    if (!pack?.id) return;
    try {
      const result = await requestJson<{ pack?: RecordValue }>(`/api/v4/packs/${encodeURIComponent(pack.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ payload: pack.payload }) });
      const saved = result.pack ?? {};
      setPack((current) => current ? { ...current, id: String(saved.id ?? current.id), version: Number(saved.version ?? current.version + 1) } : current);
      setMessage("Edited application pack saved as a new version.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Pack edits could not be saved."); }
  }

  function card(application: Application) {
    const companyName = companies.find((item) => item.id === application.companyId)?.name ?? "Company";
    return <article className="rounded-xl border border-slate-200 bg-white p-3" key={application.id}><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-slate-800">{application.title}</p><p className="mt-1 text-xs text-slate-500">{companyName}</p></div><span className="badge badge-muted">{application.stage}</span></div><label className="filter-field mt-3">Stage<select value={application.stage} onChange={(event) => void move(application.id, event.target.value)}>{stages.map((stage) => <option key={stage}>{stage}</option>)}</select></label><p className="mt-2 text-[11px] text-slate-400">{application.followupDueAt ? `Follow-up due ${new Date(application.followupDueAt).toLocaleString()}` : "No follow-up due date"}</p><div className="mt-3 flex flex-wrap gap-2"><button className="secondary-button" type="button" onClick={() => void addReminder(application)}>Add follow-up</button><button className="secondary-button" type="button" disabled={!application.manualUrl || busy} onClick={() => void prepare(application)}>{application.manualUrl ? "Prepare pack" : "Add posting URL"}</button>{application.manualUrl && <a className="secondary-button" href={application.manualUrl} target="_blank" rel="noreferrer">Open posting</a>}</div></article>;
  }

  return <section className="workspace-frame__page"><div className="standalone-header"><p className="eyebrow">Application CRM</p><div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="workspace-title">Application pipeline</h1><p className="workspace-description">Use Kanban or table view, keep stage history, add follow-ups and prepare versioned evidence-constrained packs.</p></div><a className="secondary-button" href="/api/v4/applications/export">Export CSV</a></div></div>{error && <div className="status-banner" role="alert">{error}</div>}{message && <div className="status-banner" role="status">{message}</div>}
    <div className="grid gap-5 lg:grid-cols-[.75fr_1.25fr]"><form className="standalone-card" onSubmit={(event) => void create(event)}><p className="eyebrow">Add target</p><label className="filter-field">Company<select value={companyId} onChange={(event) => setCompanyId(event.target.value)} required><option value="">Choose a company</option>{companies.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}</select></label><label className="filter-field">Evidence profile<select value={profileId} onChange={(event) => setProfileId(event.target.value)}><option value="">No profile</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label><label className="filter-field">Role title<input value={title} onChange={(event) => setTitle(event.target.value)} required /></label><label className="filter-field">Posting URL<input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Required for a pack" /></label><button className="primary-button mt-4" type="submit" disabled={busy || !companyId || !title.trim()}>Create target</button></form><section className="standalone-card"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">Saved applications</p><p className="mt-1 text-xs text-slate-500">{visible.length} shown of {applications.length}</p></div><div className="flex flex-wrap gap-2"><button className={`secondary-button ${view === "kanban" ? "border-blue-300 bg-blue-50" : ""}`} type="button" onClick={() => setView("kanban")}>Kanban</button><button className={`secondary-button ${view === "table" ? "border-blue-300 bg-blue-50" : ""}`} type="button" onClick={() => setView("table")}>Table</button></div></div><div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]"><input aria-label="Search applications" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company or role" /><select aria-label="Filter application stage" value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}><option value="">All stages</option>{stages.map((stage) => <option key={stage}>{stage}</option>)}</select><label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={dueOnly} onChange={(event) => setDueOnly(event.target.checked)} /> Due now</label></div>{view === "table" ? <div className="mt-4 overflow-x-auto"><table className="run-table"><thead><tr><th>Company</th><th>Role</th><th>Stage</th><th>Follow-up</th><th>Actions</th></tr></thead><tbody>{visible.map((application) => <tr key={application.id}><td>{companies.find((item) => item.id === application.companyId)?.name ?? "Company"}</td><td>{application.title}</td><td><select value={application.stage} onChange={(event) => void move(application.id, event.target.value)}>{stages.map((stage) => <option key={stage}>{stage}</option>)}</select></td><td>{application.followupDueAt ? new Date(application.followupDueAt).toLocaleDateString() : "—"}</td><td><button className="secondary-button" type="button" onClick={() => void addReminder(application)}>Add follow-up</button></td></tr>)}</tbody></table></div> : <div className="mt-4 grid gap-3 xl:grid-cols-2">{visible.length ? visible.map(card) : <div className="empty-state xl:col-span-2">No applications match this view.</div>}</div>}</section></div>
    {pack && <section className="standalone-card mt-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="eyebrow">Application pack version {pack.version}</p><h2 className="mt-1 text-xl font-semibold text-slate-900">Review before use</h2></div><div className="flex flex-wrap gap-2"><button className="primary-button" type="button" onClick={() => void savePack()}>Save edited version</button><a className="secondary-button" href={`/api/v4/packs/${encodeURIComponent(pack.id)}/export`}>Export printable pack</a></div></div><div className="mt-4 grid gap-5 lg:grid-cols-2"><div><p className="eyebrow">Original context</p><dl className="mt-2 space-y-2 text-sm"><div><dt className="font-semibold text-slate-700">Source</dt><dd className="break-all text-slate-500">{pack.sourceUrl}</dd></div><div><dt className="font-semibold text-slate-700">Evidence references</dt><dd className="text-slate-500">{Array.isArray(pack.payload.evidenceReferences) ? pack.payload.evidenceReferences.length : 0} approved items</dd></div><div><dt className="font-semibold text-slate-700">Requirement gaps</dt><dd className="text-slate-500">{Array.isArray(pack.payload.requirementGaps) && pack.payload.requirementGaps.length ? pack.payload.requirementGaps.join(", ") : "No requirements were supplied by the source adapter."}</dd></div></dl></div><div><p className="eyebrow">Editable proposal</p><label className="filter-field mt-2">Tailored summary<textarea rows={4} value={String(pack.payload.tailoredSummary ?? "")} onChange={(event) => setPack({ ...pack, payload: { ...pack.payload, tailoredSummary: event.target.value } })} /></label><label className="filter-field mt-2">Cover note<textarea rows={6} value={String(pack.payload.coverNote ?? "")} onChange={(event) => setPack({ ...pack, payload: { ...pack.payload, coverNote: event.target.value } })} /></label><label className="filter-field mt-2">Recruiter email<textarea rows={5} value={String(pack.payload.recruiterEmail ?? "")} onChange={(event) => setPack({ ...pack, payload: { ...pack.payload, recruiterEmail: event.target.value } })} /></label></div></div></section>}
  </section>;
}
