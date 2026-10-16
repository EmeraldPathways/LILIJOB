"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { PitchesPanel } from "./pitches-panel";
import { JobRadarPanel } from "./job-radar-panel";
import { JobRadarSchedulePanel } from "./job-radar-schedule-panel";
import { ApplicationsPanel } from "./applications-panel";

type WorkspaceKind = "dashboard" | "candidate" | "opportunities" | "job-radar" | "applications" | "contacts" | "signals" | "permit" | "interviews" | "agent" | "analytics" | "pitches";
type RecordValue = Record<string, unknown>;

type Company = { id: string; name: string; website?: string | null; metadataJson?: string };
type Profile = { id: string; name: string; targetFamiliesJson: string; constraintsJson: string; weightConfigJson: string; approvedVersion: number };
type Job = { id: string; companyId: string; title: string; url: string | null; location: string | null; salary: string | null; status: string; updatedAt: string };
type Application = { id: string; companyId: string; title: string; stage: string; dedupKey: string; manualUrl: string | null; jobId: string | null; followupDueAt: string | null; updatedAt: string };

const stages = ["Target", "Contacted", "Applied", "Follow-up", "Recruiter Call", "Interview", "Final Interview", "Offer", "Rejected", "Withdrawn"];

function parseJson(value: string | null | undefined, fallback: RecordValue = {}): RecordValue {
  try {
    const parsed = JSON.parse(value ?? "");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as RecordValue : fallback;
  } catch {
    return fallback;
  }
}

function listFromJson(value: string | undefined): string[] {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as RecordValue;
  if (!response.ok) {
    const error = body.error && typeof body.error === "object" ? body.error as RecordValue : {};
    throw new Error(typeof error.message === "string" ? error.message : `Request failed (${response.status}).`);
  }
  return body as T;
}

function splitValues(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function resolveSelectedProfile(profiles: Profile[], selectedId: string | null): Profile | null {
  return profiles.find((profile) => profile.id === selectedId) ?? profiles[0] ?? null;
}

function dublinParts(timestamp: number): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Dublin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function toDublinTimestamp(localDateTime: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localDateTime);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const localAsUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  if (!Number.isFinite(localAsUtc) || new Date(localAsUtc).toISOString().slice(0, 16) !== localDateTime) return null;

  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const sampledAt = localAsUtc + hours * 60 * 60 * 1000;
    const parts = dublinParts(sampledAt);
    const representedAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    offsets.add(Math.round((representedAsUtc - sampledAt) / 60_000));
  }

  const candidates = [...offsets].filter((offset) => {
    const candidate = localAsUtc - offset * 60_000;
    const parts = dublinParts(candidate);
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` === localDateTime;
  });
  if (candidates.length !== 1) return null;

  const offset = candidates[0];
  const sign = offset >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offset);
  const offsetHours = String(Math.floor(absoluteOffset / 60)).padStart(2, "0");
  const offsetMinutes = String(absoluteOffset % 60).padStart(2, "0");
  return `${localDateTime}:00${sign}${offsetHours}:${offsetMinutes}`;
}

function titleFor(kind: WorkspaceKind): { eyebrow: string; title: string; description: string } {
  const values: Record<WorkspaceKind, { eyebrow: string; title: string; description: string }> = {
    dashboard: { eyebrow: "Today", title: "Your highest-impact next steps", description: "Counts come from saved jobs, applications, contacts and interviews. Every card opens a concrete action or shows why there is no action yet." },
    candidate: { eyebrow: "Private candidate workspace", title: "Candidate profile & evidence", description: "Keep target strategies, work constraints, CV versions and approved achievement evidence in one owner-scoped place." },
    opportunities: { eyebrow: "Personal opportunity ranking", title: "Top opportunities", description: "A deterministic heuristic fit score shows matched evidence, gaps and unknowns. It is not a probability of hiring." },
    "job-radar": { eyebrow: "Official career sources", title: "Job radar", description: "Refresh an official careers page, preserve snapshots and distinguish verified openings from discovered links." },
    applications: { eyebrow: "Application CRM", title: "Application pipeline", description: "Track the canonical stages, immutable stage history and follow-up due dates without losing rejected or withdrawn records." },
    contacts: { eyebrow: "Public contact intelligence", title: "Recruitment contacts", description: "Review why a public contact is relevant, where it came from and whether it is safe to contact." },
    signals: { eyebrow: "Hiring trigger intelligence", title: "Hiring signals", description: "Store dated, source-backed signals as possible hiring context without turning news into a vacancy claim." },
    permit: { eyebrow: "Dublin & permit reality", title: "Permit reality", description: "Evaluate dated public evidence and official rule versions without turning an uncertain result into legal advice." },
    interviews: { eyebrow: "Interview engine", title: "Interviews & preparation", description: "Create interview records in Europe/Dublin time and generate editable preparation packs from current sources and approved evidence." },
    agent: { eyebrow: "Controlled orchestration", title: "AI Job Hunt Agent", description: "Run owner-scoped read and draft workflows with budgets, checkpoints and an approval gate for every external action." },
    analytics: { eyebrow: "Funnel metrics", title: "Analytics", description: "See stage counts and data-quality signals calculated from the application and research records." },
    pitches: { eyebrow: "Sector-specific preparation", title: "Sector pitches", description: "Prepare editable evidence-backed introductions for E-commerce, Startups, Fintech and Work Permit Companies." },
  };
  return values[kind];
}

function PageFrame({ kind, children, busy, error, onRefresh }: { kind: WorkspaceKind; children: React.ReactNode; busy: boolean; error: string | null; onRefresh: () => void }) {
  const heading = titleFor(kind);
  return <section className="workspace-frame__page">
    <div className="standalone-header">
      <p className="eyebrow">{heading.eyebrow}</p>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="workspace-title">{heading.title}</h1><p className="workspace-description">{heading.description}</p></div>
        <div className="flex flex-wrap gap-2">{kind === "applications" && <Link className="secondary-button" href="/api/v4/applications/export">Export CSV</Link>}<button className="secondary-button" type="button" onClick={onRefresh} disabled={busy}>{busy ? "Loading…" : "Refresh"}</button></div>
      </div>
    </div>
    {error && <div className="status-banner" role="alert"><span>{error}</span></div>}
    {children}
  </section>;
}

function DashboardView({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<RecordValue | null>(null);
  const [actions, setActions] = useState<RecordValue[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { setBusy(true); setError(null); try { const [summary, actionData] = await Promise.all([jsonRequest<RecordValue>("/api/v4/dashboard"), jsonRequest<{ actions?: RecordValue[] }>("/api/v4/actions")]); setData(summary); setActions(actionData.actions ?? []); } catch (reason) { setError(reason instanceof Error ? reason.message : "Dashboard could not be loaded."); } finally { setBusy(false); } }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load, refreshKey]);
  const cards = (data?.cards && typeof data.cards === "object" ? data.cards : {}) as RecordValue;
  const funnel = (data?.funnel && typeof data.funnel === "object" ? data.funnel : {}) as RecordValue;
  const metricCards: Array<[string, unknown, string]> = [
    ["High-fit live jobs", cards.highFitLiveJobs, "/opportunities"],
    ["New jobs · 7 days", cards.newlyVerifiedJobs, "/job-radar"],
    ["Public recruitment contacts", cards.publicRecruitmentContacts, "/contacts"],
    ["Follow-ups due", cards.followupsDue, "/applications"],
    ["Scheduled interviews", cards.scheduledInterviews, "/interviews"],
    ["Application responses", cards.applicationResponses, "/applications"],
  ];
  function hrefForAction(item: RecordValue): string {
    if (typeof item.interviewId === "string") return "/interviews";
    if (typeof item.applicationId === "string") return "/applications";
    if (typeof item.jobId === "string") return "/job-radar";
    if (typeof item.companyId === "string") return "/contacts";
    return "/applications";
  }
  return <PageFrame kind="dashboard" busy={busy} error={error} onRefresh={() => void load()}>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {metricCards.map(([label, value, href]) => <Link className="metric-card transition hover:border-blue-300 hover:bg-blue-50" href={href} key={label}><p className="eyebrow">{label}</p><p className="mt-2 text-3xl font-bold text-slate-900">{typeof value === "number" ? value : 0}</p><span className="mt-2 block text-xs text-blue-700">Open {href.replace("/", "")}</span></Link>)}
    </div>
    <div className="mt-5 grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
      <section className="standalone-card">
        <div className="flex items-center justify-between gap-3"><div><p className="eyebrow">Action queue</p><h2 className="mt-1 text-xl font-semibold text-slate-900">Today</h2></div><Link className="secondary-button" href="/applications">Open applications</Link></div>
        {actions.length ? <div className="mt-4 space-y-2">{actions.map((item) => <div className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 p-3" key={String(item.id)}><div><p className="text-sm font-semibold text-slate-800">{String(item.reason ?? "Action")}</p><p className="mt-1 text-xs text-slate-500">{String(item.type ?? "")}{item.dueAt ? ` · due ${String(item.dueAt)}` : ""}</p><Link className="mt-2 inline-block text-xs text-blue-700 hover:underline" href={hrefForAction(item)}>Open related record</Link></div><button className="secondary-button" type="button" onClick={async () => { await jsonRequest(`/api/v4/actions/${encodeURIComponent(String(item.id))}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "completed" }) }); await load(); }}>Complete</button></div>)}</div> : <div className="empty-state mt-4"><p className="font-semibold text-slate-800">Set up your workspace</p><p className="mt-1 text-sm text-slate-500">Start with a candidate profile, add an official career source, or track an application.</p><div className="mt-3 flex flex-wrap gap-2"><Link className="primary-button" href="/candidate">Create candidate profile</Link><Link className="secondary-button" href="/job-radar">Open Job Radar</Link><Link className="secondary-button" href="/applications">Add application</Link><Link className="secondary-button" href="/interviews">Schedule interview</Link></div></div>}
      </section>
      <section className="standalone-card"><p className="eyebrow">Funnel</p><h2 className="mt-1 text-xl font-semibold text-slate-900">Application stages</h2><div className="mt-4 space-y-2">{Object.entries(funnel).length ? Object.entries(funnel).map(([stage, value]) => <div className="flex items-center justify-between border-b border-slate-100 py-2 text-sm" key={stage}><span className="text-slate-600">{stage}</span><strong className="text-slate-900">{String(value)}</strong></div>) : <p className="text-sm text-slate-500">No applications recorded yet.</p>}</div><a className="secondary-button mt-4" href="/analytics">View data quality & analytics</a></section>
    </div>
  </PageFrame>;
}

function CandidateView({ refreshKey }: { refreshKey: number }) {
  const [profiles, setProfiles] = useState<Profile[]>([]); const [selected, setSelected] = useState<Profile | null>(null); const selectedProfileId = useRef<string | null>(null); const [name, setName] = useState(""); const [families, setFamilies] = useState("Product Manager, Growth Product Manager"); const [skills, setSkills] = useState(""); const [domains, setDomains] = useState(""); const [locations, setLocations] = useState("Dublin, Remote Ireland"); const [seniority, setSeniority] = useState(""); const [minimumSalary, setMinimumSalary] = useState(""); const [evidence, setEvidence] = useState<RecordValue[]>([]); const [documents, setDocuments] = useState<RecordValue[]>([]); const [busy, setBusy] = useState(true); const [error, setError] = useState<string | null>(null); const [message, setMessage] = useState<string | null>(null);
  function setProfileFields(profile: Profile) { setName(profile.name); setFamilies(listFromJson(profile.targetFamiliesJson).join(", ")); const constraints = parseJson(profile.constraintsJson); setSkills(Array.isArray(constraints.skills) ? constraints.skills.join(", ") : ""); setDomains(Array.isArray(constraints.domains) ? constraints.domains.join(", ") : ""); setLocations(Array.isArray(constraints.locations) ? constraints.locations.join(", ") : ""); setSeniority(typeof constraints.seniority === "string" ? constraints.seniority : ""); setMinimumSalary(typeof constraints.minimumSalary === "number" ? String(constraints.minimumSalary) : ""); }
  const loadProfileRecords = useCallback(async (profileId: string) => { try { const [evidenceResult, documentResult] = await Promise.all([jsonRequest<{ evidence?: RecordValue[] }>(`/api/v4/profiles/${encodeURIComponent(profileId)}/evidence`), jsonRequest<{ documents?: RecordValue[] }>(`/api/v4/profiles/${encodeURIComponent(profileId)}/documents`)]); setEvidence(evidenceResult.evidence ?? []); setDocuments(documentResult.documents ?? []); } catch (reason) { setError(reason instanceof Error ? reason.message : "Profile evidence could not be loaded."); } }, []);
  const loadProfiles = useCallback(async () => { setBusy(true); setError(null); try { const result = await jsonRequest<{ profiles?: Profile[] }>("/api/v4/profiles"); const next = result.profiles ?? []; setProfiles(next); const current = resolveSelectedProfile(next, selectedProfileId.current); if (current) { selectedProfileId.current = current.id; setSelected(current); setProfileFields(current); await loadProfileRecords(current.id); } else { selectedProfileId.current = null; setSelected(null); setEvidence([]); setDocuments([]); } } catch (reason) { setError(reason instanceof Error ? reason.message : "Candidate profiles could not be loaded."); } finally { setBusy(false); } }, [loadProfileRecords]);
  useEffect(() => { const timer = window.setTimeout(() => void loadProfiles(), 0); return () => window.clearTimeout(timer); }, [loadProfiles, refreshKey]);
  async function saveProfile(event: FormEvent) { event.preventDefault(); setBusy(true); setMessage(null); try { const body = { name, targetFamilies: splitValues(families), constraints: { skills: splitValues(skills), domains: splitValues(domains), locations: splitValues(locations), seniority, minimumSalary: minimumSalary ? Number(minimumSalary) : undefined, eligibility: "unknown" }, weightConfig: {} }; const result = selected ? await jsonRequest<{ profile: Profile }>(`/api/v4/profiles/${encodeURIComponent(selected.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) : await jsonRequest<{ profile: Profile }>("/api/v4/profiles", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); selectedProfileId.current = result.profile.id; setSelected(result.profile); setMessage("Candidate profile saved. Ranking will use the updated strategy."); await loadProfiles(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Profile could not be saved."); } finally { setBusy(false); } }
  async function addEvidence(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!selected) return; const form = event.currentTarget; const formData = new FormData(form); try { await jsonRequest(`/api/v4/profiles/${encodeURIComponent(selected.id)}/evidence`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: formData.get("title"), statement: formData.get("statement"), metric: formData.get("metric"), approved: formData.get("approved") === "on" }) }); form.reset(); await loadProfileRecords(selected.id); setMessage("Evidence saved for review."); } catch (reason) { setError(reason instanceof Error ? reason.message : "Evidence could not be saved."); } }
  async function uploadDocument(event: React.ChangeEvent<HTMLInputElement>) { if (!selected || !event.target.files?.[0]) return; const form = new FormData(); form.set("file", event.target.files[0]); form.set("type", "master-cv"); try { await jsonRequest(`/api/v4/profiles/${encodeURIComponent(selected.id)}/documents`, { method: "POST", body: form }); await loadProfileRecords(selected.id); setMessage("Document stored privately. Text is searchable when extraction succeeds; scans and unsupported files remain marked for review."); } catch (reason) { setError(reason instanceof Error ? reason.message : "Document could not be uploaded."); } finally { event.target.value = ""; } }
  return <PageFrame kind="candidate" busy={busy} error={error} onRefresh={() => void loadProfiles()}>{message && <div className="status-banner" role="status">{message}</div>}<div className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]"><section className="standalone-card"><div className="flex items-center justify-between gap-3"><div><p className="eyebrow">Strategies</p><h2 className="mt-1 text-xl font-semibold text-slate-900">Candidate profiles</h2></div><button className="secondary-button" type="button" onClick={() => { selectedProfileId.current = null; setSelected(null); setName("New strategy"); setFamilies("Product Manager, Growth Product Manager"); setSkills(""); setDomains(""); setLocations("Dublin, Remote Ireland"); setSeniority(""); setMinimumSalary(""); setEvidence([]); setDocuments([]); }}>New</button></div><div className="mt-4 space-y-2">{profiles.length ? profiles.map((profile) => <button className={`w-full rounded-xl border p-3 text-left ${selected?.id === profile.id ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white"}`} type="button" key={profile.id} onClick={() => { selectedProfileId.current = profile.id; setSelected(profile); setProfileFields(profile); void loadProfileRecords(profile.id); }}><strong className="block text-sm text-slate-800">{profile.name}</strong><span className="mt-1 block text-xs text-slate-500">Approved version {profile.approvedVersion}</span></button>) : <p className="text-sm text-slate-500">Create a strategy to rank jobs.</p>}</div></section><section className="standalone-card"><form onSubmit={(event) => void saveProfile(event)}><p className="eyebrow">Editable strategy</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="filter-field">Name<input value={name} onChange={(event) => setName(event.target.value)} required /></label><label className="filter-field">Seniority<input value={seniority} onChange={(event) => setSeniority(event.target.value)} placeholder="Senior" /></label><label className="filter-field sm:col-span-2">Target job families<input value={families} onChange={(event) => setFamilies(event.target.value)} /></label><label className="filter-field sm:col-span-2">Skills<input value={skills} onChange={(event) => setSkills(event.target.value)} placeholder="product strategy, analytics" /></label><label className="filter-field">Domains<input value={domains} onChange={(event) => setDomains(event.target.value)} placeholder="fintech, AI" /></label><label className="filter-field">Locations<input value={locations} onChange={(event) => setLocations(event.target.value)} /></label><label className="filter-field">Minimum salary<input value={minimumSalary} onChange={(event) => setMinimumSalary(event.target.value)} inputMode="numeric" placeholder="Optional" /></label></div><button className="primary-button mt-4" type="submit" disabled={busy}>{selected ? "Save strategy" : "Create strategy"}</button></form>{selected && <><div className="mt-7 border-t border-slate-100 pt-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="eyebrow">Private CV versions</p><p className="mt-1 text-sm text-slate-600">Original files are kept in private storage. Uploading does not trigger research.</p></div><label className="secondary-button">Upload CV<input className="hidden" type="file" accept=".pdf,.docx,.txt" onChange={(event) => void uploadDocument(event)} /></label></div>{documents.length ? <ul className="mt-3 space-y-2">{documents.map((document) => <li className="rounded-lg bg-slate-50 p-2 text-xs text-slate-600" key={String(document.id)}>{String(document.originalFilename)} · {String(parseJson(String(document.derivedJson)).parseStatus ?? "pending-review")}</li>)}</ul> : <p className="mt-3 text-xs text-slate-400">No document versions stored.</p>}</div><div className="mt-7 border-t border-slate-100 pt-5"><p className="eyebrow">Approved evidence bank</p><form className="mt-3 grid gap-2" onSubmit={(event) => void addEvidence(event)}><input className="rounded-lg border border-slate-300 p-2 text-sm" name="title" placeholder="Evidence title" required /><textarea className="rounded-lg border border-slate-300 p-2 text-sm" name="statement" placeholder="Truthful achievement statement" required /><input className="rounded-lg border border-slate-300 p-2 text-sm" name="metric" placeholder="Metric, if verified" /><label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" name="approved" /> I approve this evidence for generated drafts</label><button className="secondary-button w-fit" type="submit">Add evidence</button></form>{evidence.length ? <div className="mt-3 space-y-2">{evidence.map((item) => <div className="evidence-card" key={String(item.id)}><strong className="text-sm text-slate-800">{String(item.title)}</strong><p className="mt-1 text-xs leading-5 text-slate-600">{String(item.statement)}</p>{typeof item.metric === "string" && <span className="mt-1 block text-xs text-slate-500">Metric: {String(item.metric)}</span>}</div>)}</div> : <p className="mt-3 text-xs text-slate-400">No evidence has been entered.</p>}</div></>}</section></div></PageFrame>;
}

function OpportunitiesView({ refreshKey }: { refreshKey: number }) {
  const [profiles, setProfiles] = useState<Profile[]>([]); const [profileId, setProfileId] = useState(""); const [opportunities, setOpportunities] = useState<RecordValue[]>([]); const [busy, setBusy] = useState(true); const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { setBusy(true); setError(null); try { const result = await jsonRequest<{ profiles?: Profile[] }>("/api/v4/profiles"); const next = result.profiles ?? []; setProfiles(next); const id = profileId || next[0]?.id || ""; setProfileId(id); if (id) { const ranked = await jsonRequest<{ opportunities?: RecordValue[] }>(`/api/v4/opportunities?profileId=${encodeURIComponent(id)}`); setOpportunities(ranked.opportunities ?? []); } else setOpportunities([]); } catch (reason) { setError(reason instanceof Error ? reason.message : "Opportunities could not be loaded."); } finally { setBusy(false); } }, [profileId]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load, refreshKey]);
  async function action(jobId: string, input: RecordValue) { try { await jsonRequest("/api/v4/opportunities", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profileId, jobId, ...input }) }); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Opportunity could not be updated."); } }
  return <PageFrame kind="opportunities" busy={busy} error={error} onRefresh={() => void load()}><div className="standalone-card"><div className="flex flex-wrap items-end justify-between gap-3"><label className="filter-field m-0 min-w-[230px]">Profile<select value={profileId} onChange={(event) => { setProfileId(event.target.value); }}><option value="">Choose a profile</option>{profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.name}</option>)}</select></label><a className="secondary-button" href="/candidate">Edit candidate evidence</a></div>{!profiles.length && <div className="empty-state mt-5"><p className="font-semibold text-slate-800">Create a candidate profile first</p><a className="primary-button mt-3" href="/candidate">Open profile</a></div>}{profiles.length > 0 && <div className="mt-5 grid gap-3">{opportunities.length ? opportunities.map((item) => { const match = (item.match && typeof item.match === "object" ? item.match : {}) as RecordValue; const job = (item.job && typeof item.job === "object" ? item.job : {}) as RecordValue; const score = match.overrideScore ?? match.score ?? 0; return <article className="rounded-xl border border-slate-200 p-4" key={String(job.id)}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-base font-semibold text-slate-900">{String(job.title)}</p><p className="mt-1 text-xs text-slate-500">{String(item.companyName ?? "Company pending")} · {String(job.location ?? "Location unknown")}</p></div><span className="badge badge-blue">{String(score)}/100 · {String(match.confidence ?? "low")}</span></div><p className="mt-3 text-xs text-slate-600">{match.explanationJson ? "Score includes evidence, role scope, domain, constraints, impact, freshness and interest." : "Explainable score ready."}</p><div className="mt-3 flex flex-wrap gap-2"><button className="secondary-button" type="button" onClick={() => void action(String(job.id), { starred: !match.starred })}>{match.starred ? "Unstar" : "Star"}</button><button className="secondary-button" type="button" onClick={() => void action(String(job.id), { dismissed: !match.dismissed })}>{match.dismissed ? "Restore" : "Dismiss"}</button>{typeof job.url === "string" && <a className="secondary-button" href={String(job.url)} target="_blank" rel="noreferrer">Open source</a>}</div></article>; }) : <div className="empty-state"><p className="font-semibold text-slate-800">No saved jobs to rank yet</p><p className="mt-1 text-sm text-slate-500">Use Job Radar to add verified openings from an official careers page.</p><a className="primary-button mt-3" href="/job-radar">Open Job Radar</a></div>}</div>}</div></PageFrame>;
}

// Kept as a compatibility fallback for older hydrated chunks; the current route uses JobRadarPanel.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function JobRadarView({ refreshKey }: { refreshKey: number }) {
  const [jobs, setJobs] = useState<Job[]>([]); const [companies, setCompanies] = useState<Company[]>([]); const [companyId, setCompanyId] = useState(""); const [sourceUrl, setSourceUrl] = useState(""); const [busy, setBusy] = useState(true); const [error, setError] = useState<string | null>(null); const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(async () => { setBusy(true); setError(null); try { const [jobResult, companyResult] = await Promise.all([jsonRequest<{ jobs?: Job[] }>("/api/v4/jobs"), jsonRequest<{ companies?: Company[] }>("/api/companies")]); setJobs(jobResult.jobs ?? []); const nextCompanies = companyResult.companies ?? []; setCompanies(nextCompanies); if (!companyId && nextCompanies[0]) setCompanyId(nextCompanies[0].id); } catch (reason) { setError(reason instanceof Error ? reason.message : "Job Radar could not be loaded."); } finally { setBusy(false); } }, [companyId]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load, refreshKey]);
  async function refresh(event: FormEvent) { event.preventDefault(); setBusy(true); setMessage(null); try { const result = await jsonRequest<RecordValue>("/api/v4/jobs/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ companyId, sourceUrl }) }); setMessage(`Source checked: ${String((result.result as RecordValue | undefined)?.status ?? "complete")}. Existing jobs remain unless a source confirms a change.`); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Career source could not be refreshed."); } finally { setBusy(false); } }
  return <PageFrame kind="job-radar" busy={busy} error={error} onRefresh={() => void load()}>{message && <div className="status-banner" role="status">{message}</div>}<div className="grid gap-5 lg:grid-cols-[.8fr_1.2fr]"><form className="standalone-card" onSubmit={(event) => void refresh(event)}><p className="eyebrow">User-initiated refresh</p><label className="filter-field">Company<select value={companyId} onChange={(event) => setCompanyId(event.target.value)} required><option value="">Choose a company</option>{companies.slice(0, 500).map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}</select></label><label className="filter-field">Official careers URL<input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://company.com/careers" required /></label><p className="mt-3 text-xs leading-5 text-slate-500">Only public HTTP(S) sources are accepted. A blocked or empty response is recorded as source status and never treated as a closed job.</p><button className="primary-button mt-4" type="submit" disabled={busy || !companyId}>Refresh official source</button></form><section className="standalone-card"><p className="eyebrow">Saved opportunities</p><div className="mt-3 overflow-x-auto">{jobs.length ? <table className="run-table"><thead><tr><th>Role</th><th>Location</th><th>Status</th><th>Last checked</th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}><td><strong>{job.title}</strong>{typeof job.url === "string" && <a className="text-xs text-blue-600 hover:underline" href={job.url} target="_blank" rel="noreferrer">Source</a>}</td><td>{job.location ?? "Unknown"}</td><td>{job.status}</td><td>{new Date(job.updatedAt).toLocaleDateString()}</td></tr>)}</tbody></table> : <p className="empty-state">No jobs saved yet. Refresh an official source to begin.</p>}</div></section></div></PageFrame>;
}

// Kept as a compatibility fallback for older hydrated chunks; the current route uses ApplicationsPanel.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function ApplicationsView({ refreshKey }: { refreshKey: number }) {
  const [applications, setApplications] = useState<Application[]>([]); const [companies, setCompanies] = useState<Company[]>([]); const [profiles, setProfiles] = useState<Profile[]>([]); const [profileId, setProfileId] = useState(""); const [pack, setPack] = useState<RecordValue | null>(null); const [companyId, setCompanyId] = useState(""); const [title, setTitle] = useState(""); const [url, setUrl] = useState(""); const [busy, setBusy] = useState(true); const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { setBusy(true); setError(null); try { const [apps, companyResult, profileResult] = await Promise.all([jsonRequest<{ applications?: Application[] }>("/api/v4/applications"), jsonRequest<{ companies?: Company[] }>("/api/companies"), jsonRequest<{ profiles?: Profile[] }>("/api/v4/profiles")]); setApplications(apps.applications ?? []); setCompanies(companyResult.companies ?? []); setProfiles(profileResult.profiles ?? []); if (!companyId && companyResult.companies?.[0]) setCompanyId(companyResult.companies[0].id); if (!profileId && profileResult.profiles?.[0]) setProfileId(profileResult.profiles[0].id); } catch (reason) { setError(reason instanceof Error ? reason.message : "Applications could not be loaded."); } finally { setBusy(false); } }, [companyId, profileId]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load, refreshKey]);
  async function create(event: FormEvent) { event.preventDefault(); try { await jsonRequest("/api/v4/applications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ companyId, title, manualUrl: url, dedupKey: `${companyId}:${title.toLowerCase()}:${url}` }) }); setTitle(""); setUrl(""); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Application could not be created."); } }
  async function move(id: string, stage: string) { try { await jsonRequest(`/api/v4/applications/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ stage }) }); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Stage could not be saved."); } }
  async function prepare(application: Application) { if (!application.manualUrl) { setError("This application has no verified posting URL. Add a source link before preparing a pack."); return; } try { const company = companies.find((item) => item.id === application.companyId); const result = await jsonRequest<{ pack?: RecordValue }>("/api/v4/packs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profileId: profileId || undefined, applicationId: application.id, jobTitle: application.title, companyName: company?.name ?? "Company", jobSourceUrl: application.manualUrl, requirements: [], candidateSummary: "Review the approved candidate evidence before using this draft." }) }); setPack(result.pack ?? null); } catch (reason) { setError(reason instanceof Error ? reason.message : "Application pack could not be generated."); } }
  return <PageFrame kind="applications" busy={busy} error={error} onRefresh={() => void load()}><div className="grid gap-5 lg:grid-cols-[.75fr_1.25fr]"><form className="standalone-card" onSubmit={(event) => void create(event)}><p className="eyebrow">Add application</p><label className="filter-field">Company<select value={companyId} onChange={(event) => setCompanyId(event.target.value)} required><option value="">Choose a company</option>{companies.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}</select></label><label className="filter-field">Role title<input value={title} onChange={(event) => setTitle(event.target.value)} required /></label><label className="filter-field">Posting URL<input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Required for an application pack" /></label><button className="primary-button mt-4" type="submit" disabled={!companyId || !title}>Create target</button></form><section className="standalone-card"><p className="eyebrow">Pipeline</p><label className="filter-field mt-3">Evidence profile<select value={profileId} onChange={(event) => setProfileId(event.target.value)}><option value="">No profile</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>{pack && <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3"><p className="text-sm font-semibold text-slate-800">Pack ready for review</p><p className="mt-1 text-xs leading-5 text-slate-600">{String(pack.recruiterEmail ?? "Draft generated from approved evidence.")}</p></div>}{applications.length ? <div className="mt-4 grid gap-3 md:grid-cols-2">{applications.map((application) => <article className="rounded-xl border border-slate-200 p-3" key={application.id}><p className="font-semibold text-slate-800">{application.title}</p><p className="mt-1 text-xs text-slate-500">{companies.find((company) => company.id === application.companyId)?.name ?? "Company"}</p><label className="filter-field">Stage<select value={application.stage} onChange={(event) => void move(application.id, event.target.value)}>{stages.map((stage) => <option key={stage}>{stage}</option>)}</select></label><button className="secondary-button mt-3" type="button" disabled={!application.manualUrl} onClick={() => void prepare(application)}>{application.manualUrl ? "Prepare application pack" : "Add posting URL to prepare"}</button><p className="mt-2 text-[11px] text-slate-400">Updated {new Date(application.updatedAt).toLocaleString()}</p></article>)}</div> : <div className="empty-state mt-4"><p className="font-semibold text-slate-800">No applications yet</p><p className="mt-1 text-sm text-slate-500">Create a target from a job or a speculative company application.</p></div>}</section></div></PageFrame>;
}

export function ContactReviewControls({ doNotContact, correctionFlag, onDoNotContactChange, onCorrectionFlagChange }: { doNotContact: boolean; correctionFlag: boolean; onDoNotContactChange: () => void; onCorrectionFlagChange: () => void }) {
  return <div className="mt-3 flex flex-wrap gap-2"><button className="secondary-button" type="button" aria-pressed={doNotContact} onClick={onDoNotContactChange}>{doNotContact ? "Allow contact after review" : "Mark do not contact"}</button><button className="secondary-button" type="button" aria-pressed={correctionFlag} onClick={onCorrectionFlagChange}>{correctionFlag ? "Clear correction flag" : "Flag details for correction"}</button></div>;
}

function ContactsView({ refreshKey }: { refreshKey: number }) {
  const [contacts, setContacts] = useState<RecordValue[]>([]); const [companies, setCompanies] = useState<Company[]>([]); const [companyId, setCompanyId] = useState(""); const [name, setName] = useState(""); const [role, setRole] = useState(""); const [email, setEmail] = useState(""); const [linkedinUrl, setLinkedinUrl] = useState(""); const [sourceUrl, setSourceUrl] = useState(""); const [busy, setBusy] = useState(true); const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { setBusy(true); try { const [contactResult, companyResult] = await Promise.all([jsonRequest<{ contacts?: RecordValue[] }>("/api/v4/contacts"), jsonRequest<{ companies?: Company[] }>("/api/companies")]); setContacts(contactResult.contacts ?? []); setCompanies(companyResult.companies ?? []); if (!companyId && companyResult.companies?.[0]) setCompanyId(companyResult.companies[0].id); } catch (reason) { setError(reason instanceof Error ? reason.message : "Contacts could not be loaded."); } finally { setBusy(false); } }, [companyId]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load, refreshKey]);
  async function add(event: FormEvent) { event.preventDefault(); try { await jsonRequest("/api/v4/contacts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ companyId, name, role, email: email || undefined, linkedinUrl: linkedinUrl || undefined, sourceUrl: sourceUrl || undefined }) }); setName(""); setRole(""); setEmail(""); setLinkedinUrl(""); setSourceUrl(""); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Contact could not be saved."); } }
  async function updateContact(id: string, changes: RecordValue) { try { await jsonRequest(`/api/v4/contacts/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(changes) }); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Contact status could not be updated."); } }
  return <PageFrame kind="contacts" busy={busy} error={error} onRefresh={() => void load()}><div className="grid gap-5 lg:grid-cols-[.75fr_1.25fr]"><form className="standalone-card" onSubmit={(event) => void add(event)}><p className="eyebrow">Add public contact</p><p className="mt-2 text-xs leading-5 text-slate-500">Only enter a published address or public profile URL. The app never generates a personal email pattern.</p><label className="filter-field">Company<select value={companyId} onChange={(event) => setCompanyId(event.target.value)} required><option value="">Choose a company</option>{companies.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}</select></label><label className="filter-field">Name<input value={name} onChange={(event) => setName(event.target.value)} /></label><label className="filter-field">Public role<input value={role} onChange={(event) => setRole(event.target.value)} /></label><label className="filter-field">Published email<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" /></label><label className="filter-field">Public LinkedIn URL<input value={linkedinUrl} onChange={(event) => setLinkedinUrl(event.target.value)} /></label><label className="filter-field">Source URL<input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} required /></label><button className="primary-button mt-4" type="submit" disabled={!companyId || !sourceUrl}>Save contact</button></form><section className="standalone-card"><p className="eyebrow">Review queue</p>{contacts.length ? <div className="mt-4 space-y-2">{contacts.map((contact) => <article className="rounded-xl border border-slate-200 p-3" key={String(contact.id)}><div className="flex flex-wrap justify-between gap-2"><div><p className="font-semibold text-slate-800">{String(contact.name ?? "Unnamed public contact")}</p><p className="text-xs text-slate-500">{String(contact.role ?? "Role unknown")} · {String(contact.contactType ?? "unknown")}</p></div><span className="badge badge-muted">quality {String(contact.qualityScore ?? "-")}</span></div><p className="mt-2 break-all text-xs text-slate-600">{String(contact.email ?? "Email unavailable")}</p>{typeof contact.sourceUrl === "string" && <a className="mt-1 block break-all text-xs text-blue-600 hover:underline" href={String(contact.sourceUrl)} target="_blank" rel="noreferrer">Source: {String(contact.sourceUrl)}</a>}<p className="mt-2 text-xs text-slate-500">Review status: {String(contact.verificationStatus ?? "unverified")}{contact.correctionFlag ? " · correction flagged" : ""}</p><ContactReviewControls doNotContact={Boolean(contact.doNotContact)} correctionFlag={Boolean(contact.correctionFlag)} onDoNotContactChange={() => void updateContact(String(contact.id), { doNotContact: !Boolean(contact.doNotContact) })} onCorrectionFlagChange={() => void updateContact(String(contact.id), { correctionFlag: !Boolean(contact.correctionFlag) })} /></article>)}</div> : <p className="empty-state mt-4">No recruitment contacts have been reviewed.</p>}</section></div></PageFrame>;
}

export function SignalReviewActions({ suppressed, onCorrect, onToggleSuppressed }: { suppressed: boolean; onCorrect: () => void; onToggleSuppressed: () => void }) {
  return <div className="mt-3 flex flex-wrap gap-2"><button className="secondary-button" type="button" onClick={onCorrect}>Correct record</button><button className="secondary-button" type="button" aria-pressed={suppressed} onClick={onToggleSuppressed}>{suppressed ? "Restore signal" : "Suppress signal"}</button></div>;
}

export function InterviewPackExportLinks({ interviewId }: { interviewId: string }) {
  const base = `/api/v4/interviews/${encodeURIComponent(interviewId)}/export`;
  return <div className="flex flex-wrap gap-2"><a className="secondary-button" href={`${base}?format=html`}>Print / HTML</a><a className="secondary-button" href={`${base}?format=docx`}>Word (.docx)</a><a className="secondary-button" href={`${base}?format=pdf`}>PDF</a></div>;
}

function SignalsView({ refreshKey }: { refreshKey: number }) {
  const [signals, setSignals] = useState<RecordValue[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [summary, setSummary] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [correctionSummary, setCorrectionSummary] = useState("");
  const [correctionSourceUrl, setCorrectionSourceUrl] = useState("");
  const [correctionEventDate, setCorrectionEventDate] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [signalResult, companyResult] = await Promise.all([
        jsonRequest<{ signals?: RecordValue[] }>("/api/v4/signals"),
        jsonRequest<{ companies?: Company[] }>("/api/companies"),
      ]);
      setSignals(signalResult.signals ?? []);
      setCompanies(companyResult.companies ?? []);
      if (!companyId && companyResult.companies?.[0]) setCompanyId(companyResult.companies[0].id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Signals could not be loaded.");
    } finally {
      setBusy(false);
    }
  }, [companyId]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load, refreshKey]);

  async function add(event: FormEvent) {
    event.preventDefault();
    try {
      await jsonRequest("/api/v4/signals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId, type: "hiring-surge", summary, sourceUrl, eventDate: eventDate || undefined, discoveredAt: new Date().toISOString(), sourceReliability: "secondary", dublinConnection: true, functionRelevance: 50, companyInterest: 50 }),
      });
      setSummary("");
      setSourceUrl("");
      setEventDate("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Signal could not be saved.");
    }
  }

  function beginCorrection(signal: RecordValue) {
    setEditingId(String(signal.id));
    setCorrectionSummary(String(signal.summary ?? ""));
    setCorrectionSourceUrl(typeof signal.sourceUrl === "string" ? signal.sourceUrl : "");
    setCorrectionEventDate(typeof signal.eventDate === "string" ? signal.eventDate : "");
  }

  async function updateSignal(signalId: string, changes: RecordValue): Promise<boolean> {
    try {
      await jsonRequest(`/api/v4/signals/${encodeURIComponent(signalId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(changes),
      });
      await load();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Signal could not be updated.");
      return false;
    }
  }

  async function saveCorrection(event: FormEvent, signalId: string) {
    event.preventDefault();
    const updated = await updateSignal(signalId, {
      correction: {
        summary: correctionSummary,
        eventDate: correctionEventDate || null,
        ...(correctionSourceUrl.trim() ? { sourceUrl: correctionSourceUrl.trim() } : {}),
      },
    });
    if (updated) setEditingId(null);
  }

  return <PageFrame kind="signals" busy={busy} error={error} onRefresh={() => void load()}>
    <div className="grid gap-5 lg:grid-cols-[.75fr_1.25fr]">
      <form className="standalone-card" onSubmit={(event) => void add(event)}>
        <p className="eyebrow">Record a possible signal</p>
        <label className="filter-field">Company<select value={companyId} onChange={(event) => setCompanyId(event.target.value)} required><option value="">Choose a company</option>{companies.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}</select></label>
        <label className="filter-field">Summary<textarea value={summary} onChange={(event) => setSummary(event.target.value)} required placeholder="State only what the source says" /></label>
        <label className="filter-field">Event date<input type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} /></label>
        <label className="filter-field">Evidence URL<input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} required /></label>
        <button className="primary-button mt-4" type="submit" disabled={!companyId || busy}>Save possible signal</button>
      </form>
      <section className="standalone-card">
        <p className="eyebrow">Hiring context</p>
        {signals.length ? <div className="mt-4 space-y-2">{signals.map((signal) => {
          const suppressed = Boolean(signal.isSuppressed) || signal.qaStatus === "suppressed";
          return <article className="rounded-xl border border-slate-200 p-3" key={String(signal.id)}>
            <div className="flex flex-wrap justify-between gap-2"><div><strong className="text-sm text-slate-800">{String(signal.type)}</strong><p className="mt-1 text-xs text-slate-500">{String(companies.find((company) => company.id === String(signal.companyId))?.name ?? "Company")} · {String(signal.qaStatus ?? "unverified")}</p></div><span className="badge badge-amber">{String(signal.relevanceScore ?? 0)}/100</span></div>
            <p className="mt-2 text-sm leading-6 text-slate-600">{String(signal.summary)}</p>
            <p className="mt-2 text-xs text-slate-400">Event {String(signal.eventDate ?? "unknown")} · found {String(signal.discoveredAt)}</p>
            {typeof signal.sourceUrl === "string" && <a className="mt-1 block break-all text-xs text-blue-600 hover:underline" href={signal.sourceUrl} target="_blank" rel="noreferrer">Source: {signal.sourceUrl}</a>}
            <SignalReviewActions suppressed={suppressed} onCorrect={() => beginCorrection(signal)} onToggleSuppressed={() => void updateSignal(String(signal.id), { suppressed: !suppressed })} />
            {editingId === String(signal.id) && <form className="mt-3 grid gap-2 border-t border-slate-100 pt-3" onSubmit={(event) => void saveCorrection(event, String(signal.id))}>
              <label className="filter-field">Corrected summary<textarea value={correctionSummary} onChange={(event) => setCorrectionSummary(event.target.value)} required /></label>
              <label className="filter-field">Corrected event date<input type="date" value={correctionEventDate} onChange={(event) => setCorrectionEventDate(event.target.value)} /></label>
              <label className="filter-field">Corrected evidence URL<input type="url" value={correctionSourceUrl} onChange={(event) => setCorrectionSourceUrl(event.target.value)} placeholder="HTTPS source" /></label>
              <div className="flex flex-wrap gap-2"><button className="primary-button" type="submit">Save correction</button><button className="secondary-button" type="button" onClick={() => setEditingId(null)}>Cancel</button></div>
            </form>}
          </article>;
        })}</div> : <p className="empty-state mt-4">No dated hiring signals stored.</p>}
      </section>
    </div>
  </PageFrame>;
}

export function PermitSourceStatusPanel({ checks, busy, interpretation, error, onRefresh }: { checks: RecordValue[]; busy: boolean; interpretation: string; error: string | null; onRefresh: () => void }) {
  return <section className="standalone-card mb-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow">Official source availability</p><h2 className="mt-1 text-xl font-semibold text-slate-900">Permit source checks</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{interpretation}</p></div><button className="secondary-button" type="button" onClick={onRefresh} disabled={busy}>{busy ? "Checking…" : "Check official sources"}</button></div>
    {error && <p className="status-banner mt-4" role="alert">{error}</p>}
    {checks.length ? <div className="mt-4 grid gap-2 md:grid-cols-2">{checks.map((check) => <article className="rounded-xl border border-slate-200 p-3" key={String(check.sourceUrl)}><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm text-slate-800">{String(check.title ?? "Official permit source")}</strong><span className={`badge ${check.status === "retrieved" ? "badge-blue" : "badge-amber"}`}>{check.status === "retrieved" ? "Retrieved" : "Unavailable"}</span></div><a className="mt-2 block break-all text-xs text-blue-700 hover:underline" href={String(check.sourceUrl)} target="_blank" rel="noreferrer">{String(check.sourceUrl)}</a><p className="mt-2 text-xs text-slate-500">Checked {String(check.checkedAt)} · source content requires rule review</p>{typeof check.contentHash === "string" && check.contentHash && <p className="mt-1 break-all text-[11px] text-slate-400">Content hash {check.contentHash}</p>}{typeof check.error === "string" && <p className="mt-2 text-xs text-amber-800">{check.error}</p>}</article>)}</div> : <p className="empty-state mt-4">No official source checks saved yet.</p>}
  </section>;
}

function PermitView({ refreshKey }: { refreshKey: number }) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [rules, setRules] = useState<RecordValue[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [relevantDate, setRelevantDate] = useState(new Date().toISOString().slice(0, 10));
  const [salary, setSalary] = useState("");
  const [dublinEvidence, setDublinEvidence] = useState("none");
  const [pastSponsorshipEvidence, setPastSponsorshipEvidence] = useState(false);
  const [currentSupportEvidence, setCurrentSupportEvidence] = useState(false);
  const [result, setResult] = useState<RecordValue | null>(null);
  const [sourceChecks, setSourceChecks] = useState<RecordValue[]>([]);
  const [sourceInterpretation, setSourceInterpretation] = useState("Availability checks do not approve permit rules or determine personal eligibility.");
  const [sourceBusy, setSourceBusy] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [companyResult, ruleResult, sourceResult] = await Promise.all([
        jsonRequest<{ companies?: Company[] }>("/api/companies"),
        jsonRequest<{ rules?: RecordValue[] }>("/api/v4/permit/rules"),
        jsonRequest<{ checks?: RecordValue[]; interpretation?: string }>("/api/v4/permit/sources"),
      ]);
      const nextCompanies = companyResult.companies ?? [];
      setCompanies(nextCompanies);
      setRules(ruleResult.rules ?? []);
      setSourceChecks(sourceResult.checks ?? []);
      setSourceInterpretation(sourceResult.interpretation ?? "Availability checks do not approve permit rules or determine personal eligibility.");
      if (!companyId && nextCompanies[0]) setCompanyId(nextCompanies[0].id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Permit data could not be loaded.");
    } finally {
      setBusy(false);
    }
  }, [companyId]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load, refreshKey]);
  async function checkPermitSources() {
    setSourceBusy(true);
    setSourceError(null);
    try {
      const response = await jsonRequest<{ checks?: RecordValue[]; interpretation?: string }>("/api/v4/permit/sources", { method: "POST" });
      setSourceChecks(response.checks ?? []);
      setSourceInterpretation(response.interpretation ?? "Availability checks do not approve permit rules or determine personal eligibility.");
    } catch (reason) {
      setSourceError(reason instanceof Error ? reason.message : "Official permit sources could not be checked.");
    } finally {
      setSourceBusy(false);
    }
  }
  async function evaluate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await jsonRequest<{ result?: RecordValue }>("/api/v4/permit/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId, roleTitle, relevantDate, salary: salary ? Number(salary) : null, dublinEvidence, pastSponsorshipEvidence, currentSupportEvidence }),
      });
      setResult(response.result ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Permit evaluation could not be completed.");
    } finally {
      setBusy(false);
    }
  }
  const labels = Array.isArray(result?.labels) ? result.labels : [];
  return <PageFrame kind="permit" busy={busy} error={error} onRefresh={() => void load()}>
    <PermitSourceStatusPanel checks={sourceChecks} busy={sourceBusy} interpretation={sourceInterpretation} error={sourceError} onRefresh={() => void checkPermitSources()} />
    <div className="grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
      <form className="standalone-card" onSubmit={(event) => void evaluate(event)}>
        <p className="eyebrow">Dated evaluation</p>
        <p className="mt-2 text-xs leading-5 text-slate-500">Use only evidence you have reviewed. Unknown salary, occupation or employer support stays unknown and every result requires confirmation.</p>
        <label className="filter-field">Company<select value={companyId} onChange={(event) => setCompanyId(event.target.value)} required><option value="">Choose a company</option>{companies.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}</select></label>
        <label className="filter-field">Role title<input value={roleTitle} onChange={(event) => setRoleTitle(event.target.value)} required placeholder="Senior Product Manager" /></label>
        <label className="filter-field">Relevant start date<input type="date" value={relevantDate} onChange={(event) => setRelevantDate(event.target.value)} required /></label>
        <label className="filter-field">Published annual salary<input value={salary} onChange={(event) => setSalary(event.target.value)} inputMode="numeric" placeholder="Leave blank if unpublished" /></label>
        <label className="filter-field">Dublin evidence<select value={dublinEvidence} onChange={(event) => setDublinEvidence(event.target.value)}><option value="none">No Dublin evidence</option><option value="office-address">Dublin office address</option><option value="specific-job">Specific Dublin job</option><option value="remote-from-Ireland">Remote from Ireland</option><option value="unspecific-Irish-presence">Unspecified Irish presence</option></select></label>
        <label className="mt-3 flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={pastSponsorshipEvidence} onChange={(event) => setPastSponsorshipEvidence(event.target.checked)} /> Public evidence of past sponsorship</label>
        <label className="mt-2 flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={currentSupportEvidence} onChange={(event) => setCurrentSupportEvidence(event.target.checked)} /> Explicit employer statement of current support</label>
        <button className="primary-button mt-4" type="submit" disabled={busy || !companyId || !roleTitle.trim()}>Evaluate dated evidence</button>
      </form>
      <section className="standalone-card" aria-live="polite">
        <div className="flex items-start justify-between gap-3"><div><p className="eyebrow">Official rule registry</p><h2 className="mt-1 text-xl font-semibold text-slate-900">Evidence result</h2></div><span className="badge badge-muted">{rules.length} rule version{rules.length === 1 ? "" : "s"} loaded</span></div>
        {result ? <div className="mt-5 space-y-4"><div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="text-sm font-semibold text-amber-900">{String(result.status ?? "cannot-determine")}</p><p className="mt-1 text-sm leading-6 text-amber-900">{String(result.explanation ?? "Review the supplied evidence.")}</p></div><div><p className="eyebrow">Labels</p><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">{labels.map((label) => <li key={String(label)}>{String(label)}</li>)}</ul></div>{typeof result.sourceUrl === "string" && <a className="secondary-button" href={result.sourceUrl} target="_blank" rel="noreferrer">Open official rule source</a>}<p className="text-xs leading-5 text-slate-500">This stored evaluation is an evidence label, not a legal conclusion. Confirm current rules and personal eligibility before using it in an application or message.</p></div> : <div className="empty-state mt-5"><p className="font-semibold text-slate-800">No evaluation yet</p><p className="mt-1 text-sm text-slate-500">Evaluate a company and role to see the effective rule date, source and unknowns.</p></div>}
      </section>
    </div>
  </PageFrame>;
}

function InterviewsView({ refreshKey }: { refreshKey: number }) {
  const [interviews, setInterviews] = useState<RecordValue[]>([]); const [applications, setApplications] = useState<Application[]>([]); const [companies, setCompanies] = useState<Company[]>([]); const [profiles, setProfiles] = useState<Profile[]>([]); const [evidence, setEvidence] = useState<RecordValue[]>([]); const [applicationId, setApplicationId] = useState(""); const [profileId, setProfileId] = useState(""); const [round, setRound] = useState("Recruiter screen"); const [scheduledLocal, setScheduledLocal] = useState(""); const [busy, setBusy] = useState(true); const [error, setError] = useState<string | null>(null); const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(async () => { setBusy(true); try { const [interviewResult, appResult, companyResult, profileResult] = await Promise.all([jsonRequest<{ interviews?: RecordValue[] }>("/api/v4/interviews"), jsonRequest<{ applications?: Application[] }>("/api/v4/applications"), jsonRequest<{ companies?: Company[] }>("/api/companies"), jsonRequest<{ profiles?: Profile[] }>("/api/v4/profiles")]); setInterviews(interviewResult.interviews ?? []); setApplications(appResult.applications ?? []); setCompanies(companyResult.companies ?? []); setProfiles(profileResult.profiles ?? []); const nextProfileId = profileId || profileResult.profiles?.[0]?.id || ""; if (!profileId) setProfileId(nextProfileId); if (nextProfileId) { const evidenceResult = await jsonRequest<{ evidence?: RecordValue[] }>(`/api/v4/profiles/${encodeURIComponent(nextProfileId)}/evidence`); setEvidence(evidenceResult.evidence ?? []); } if (!applicationId && appResult.applications?.[0]) setApplicationId(appResult.applications[0].id); } catch (reason) { setError(reason instanceof Error ? reason.message : "Interviews could not be loaded."); } finally { setBusy(false); } }, [applicationId, profileId]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load, refreshKey]);
  async function create(event: FormEvent) { event.preventDefault(); const timestamp = scheduledLocal ? toDublinTimestamp(scheduledLocal) : undefined; if (scheduledLocal && !timestamp) { setError("Choose a valid Europe/Dublin time. Times in the clock-change gap or overlap must use a different minute."); return; } try { await jsonRequest("/api/v4/interviews", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ applicationId, round, ...(timestamp ? { scheduledAt: timestamp } : {}), timezone: "Europe/Dublin" }) }); setMessage(timestamp ? "Interview saved in Europe/Dublin time." : "Interview saved without a scheduled time."); setScheduledLocal(""); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Interview could not be saved."); } }
  async function makePack(interviewId: string) { try { const interview = interviews.find((item) => item.id === interviewId); const app = applications.find((item) => item.id === String(interview?.applicationId)); const company = app ? companies.find((item) => item.id === app.companyId) : undefined; await jsonRequest(`/api/v4/interviews/${encodeURIComponent(interviewId)}/pack`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ companyName: company?.name ?? "Company requires confirmation", roleTitle: app?.title ?? "Role requires confirmation", jobSourceUrl: app?.manualUrl ?? null, requirements: [], approvedStories: evidence.filter((item) => item.approved === true).map((item) => ({ id: String(item.id), statement: String(item.statement), metric: typeof item.metric === "string" ? item.metric : null })), companyFacts: [] }) }); setMessage("Interview pack generated with source limitations shown. Predictions and empty source sections remain labelled for review."); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Interview pack could not be generated."); } }
  return <PageFrame kind="interviews" busy={busy} error={error} onRefresh={() => void load()}>{message && <div className="status-banner" role="status">{message}</div>}<div className="grid gap-5 lg:grid-cols-[.75fr_1.25fr]"><form className="standalone-card" onSubmit={(event) => void create(event)}><p className="eyebrow">Schedule manually</p><label className="filter-field">Application<select value={applicationId} onChange={(event) => setApplicationId(event.target.value)} required><option value="">Choose an application</option>{applications.map((app) => <option value={app.id} key={app.id}>{app.title}</option>)}</select></label><label className="filter-field">Round<input value={round} onChange={(event) => setRound(event.target.value)} required /></label><label className="filter-field">Scheduled time (Europe/Dublin)<input type="datetime-local" value={scheduledLocal} onChange={(event) => setScheduledLocal(event.target.value)} /></label><p className="text-xs text-slate-500">Leave blank if no time is set. Clock-change gap or overlap times must be rescheduled at another minute.</p><label className="filter-field">Evidence profile<select value={profileId} onChange={(event) => { setProfileId(event.target.value); }}><option value="">No approved STAR evidence</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label><p className="mt-3 text-xs text-slate-500">Calendar sync is intentionally manual until explicitly authorised. Packs use only approved evidence from the selected profile.</p><button className="primary-button mt-4" type="submit" disabled={!applicationId}>Save interview</button></form><section className="standalone-card"><p className="eyebrow">Interview records</p>{interviews.length ? <div className="mt-4 space-y-2">{interviews.map((interview) => <article className="rounded-xl border border-slate-200 p-3" key={String(interview.id)}><div className="flex justify-between gap-3"><div><strong className="text-sm text-slate-800">{String(interview.round)}</strong><p className="mt-1 text-xs text-slate-500">{typeof interview.scheduledAt === "string" ? new Date(interview.scheduledAt).toLocaleString("en-IE", { timeZone: "Europe/Dublin", dateStyle: "medium", timeStyle: "short" }) : "Time not set"} · {String(interview.timezone ?? "Europe/Dublin")} · {String(interview.prepStatus ?? "not-started")}</p></div><div className="flex flex-wrap gap-2"><button className="secondary-button" type="button" onClick={() => void makePack(String(interview.id))}>Prepare pack</button>{interview.prepStatus === "ready" && <InterviewPackExportLinks interviewId={String(interview.id)} />}</div></div></article>)}</div> : <p className="empty-state mt-4">No interviews have been scheduled.</p>}</section></div></PageFrame>;
}

function AgentView({ refreshKey }: { refreshKey: number }) {
  const [runs, setRuns] = useState<RecordValue[]>([]); const [request, setRequest] = useState(""); const [busy, setBusy] = useState(true); const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { setBusy(true); try { const result = await jsonRequest<{ runs?: RecordValue[] }>("/api/v4/agent/runs"); setRuns(result.runs ?? []); } catch (reason) { setError(reason instanceof Error ? reason.message : "Agent runs could not be loaded."); } finally { setBusy(false); } }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load, refreshKey]);
  async function start(event: FormEvent) { event.preventDefault(); try { await jsonRequest("/api/v4/agent/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request, budget: { maxSearches: 10, maxTokens: 20_000 } }) }); setRequest(""); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Agent run could not be started."); } }
  async function execute(runId: string) { try { await jsonRequest(`/api/v4/agent/runs/${encodeURIComponent(runId)}/execute`, { method: "POST" }); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Agent run could not execute."); } }
  return <PageFrame kind="agent" busy={busy} error={error} onRefresh={() => void load()}><div className="grid gap-5 lg:grid-cols-[.8fr_1.2fr]"><form className="standalone-card" onSubmit={(event) => void start(event)}><p className="eyebrow">New controlled run</p><textarea className="mt-3 min-h-32 w-full rounded-xl border border-slate-300 p-3 text-sm" value={request} onChange={(event) => setRequest(event.target.value)} placeholder="Find the ten best Dublin companies to contact this week" required /><p className="mt-3 text-xs leading-5 text-slate-500">Read and draft tools can run within budget. Sending, applying and scheduling remain blocked until separately approved.</p><button className="primary-button mt-4" type="submit" disabled={busy || !request.trim()}>Start run</button></form><section className="standalone-card"><p className="eyebrow">Agent runs</p>{runs.length ? <div className="mt-4 space-y-2">{runs.map((run) => <article className="rounded-xl border border-slate-200 p-3" key={String(run.id)}><a className="block hover:border-blue-300" href={`/agent/${encodeURIComponent(String(run.id))}`}><div className="flex justify-between gap-3"><strong className="text-sm text-slate-800">{String(run.request)}</strong><span className="badge badge-muted">{String(run.status)}</span></div><p className="mt-1 text-xs text-slate-500">Started {String(run.createdAt)}</p></a>{["queued", "running"].includes(String(run.status)) && <button className="secondary-button mt-3" type="button" disabled={busy} onClick={() => void execute(String(run.id))}>Run safe plan</button>}</article>)}</div> : <p className="empty-state mt-4">No agent runs yet.</p>}</section></div></PageFrame>;
}

function AnalyticsView({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<RecordValue | null>(null); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(true); const load = useCallback(async () => { setBusy(true); try { setData(await jsonRequest<RecordValue>("/api/v4/dashboard")); } catch (reason) { setError(reason instanceof Error ? reason.message : "Analytics could not be loaded."); } finally { setBusy(false); } }, []); useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load, refreshKey]); const funnel = (data?.funnel && typeof data.funnel === "object" ? data.funnel : {}) as RecordValue; const quality = (data?.dataQuality && typeof data.dataQuality === "object" ? data.dataQuality : {}) as RecordValue; return <PageFrame kind="analytics" busy={busy} error={error} onRefresh={() => void load()}><div className="grid gap-5 md:grid-cols-2"><section className="standalone-card"><p className="eyebrow">Pipeline denominator</p><h2 className="mt-1 text-xl font-semibold text-slate-900">Applications by stage</h2><div className="mt-4 space-y-2">{Object.entries(funnel).length ? Object.entries(funnel).map(([key, value]) => <div className="flex justify-between border-b border-slate-100 py-2 text-sm" key={key}><span>{key}</span><strong>{String(value)}</strong></div>) : <p className="text-sm text-slate-500">No application events yet.</p>}</div></section><section className="standalone-card"><p className="eyebrow">Data quality</p><h2 className="mt-1 text-xl font-semibold text-slate-900">Source health</h2><p className="mt-4 text-4xl font-bold text-slate-900">{String(quality.failedOrPartialJobRuns ?? 0)}</p><p className="mt-1 text-sm text-slate-500">failed or partial job source runs. Open Job Radar to inspect a source.</p><a className="secondary-button mt-4" href="/job-radar">Review sources</a></section></div></PageFrame>; }

export function V4Workspace({ kind }: { kind: WorkspaceKind }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const view = kind === "dashboard" ? <DashboardView refreshKey={refreshKey} /> : kind === "candidate" ? <CandidateView refreshKey={refreshKey} /> : kind === "opportunities" ? <OpportunitiesView refreshKey={refreshKey} /> : kind === "job-radar" ? <><JobRadarPanel /><JobRadarSchedulePanel /></> : kind === "applications" ? <ApplicationsPanel /> : kind === "contacts" ? <ContactsView refreshKey={refreshKey} /> : kind === "signals" ? <SignalsView refreshKey={refreshKey} /> : kind === "permit" ? <PermitView refreshKey={refreshKey} /> : kind === "interviews" ? <InterviewsView refreshKey={refreshKey} /> : kind === "agent" ? <AgentView refreshKey={refreshKey} /> : kind === "pitches" ? <PitchesPanel /> : <AnalyticsView refreshKey={refreshKey} />;
  return <>{view}<button className="sr-only" type="button" onClick={() => setRefreshKey((value) => value + 1)}>Refresh workspace</button></>;
}
