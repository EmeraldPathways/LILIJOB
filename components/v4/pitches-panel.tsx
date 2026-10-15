"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type RecordValue = Record<string, unknown>;
type Profile = { id: string; name: string };
type SavedPitch = { id: string; version: number; sector: string; companyName: string; role: string; payloadJson: string };

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as RecordValue;
  if (!response.ok) {
    const error = body.error && typeof body.error === "object" ? body.error as RecordValue : {};
    throw new Error(typeof error.message === "string" ? error.message : `Request failed (${response.status}).`);
  }
  return body as T;
}

export function PitchesPanel() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [sector, setSector] = useState("startups");
  const [companyName, setCompanyName] = useState("");
  const [role, setRole] = useState("");
  const [companyFacts, setCompanyFacts] = useState("");
  const [pitch, setPitch] = useState<RecordValue | null>(null);
  const [savedPitches, setSavedPitches] = useState<SavedPitch[]>([]);
  const [selectedPitch, setSelectedPitch] = useState<SavedPitch | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadProfiles = useCallback(async () => {
    try {
      const [result, pitchResult] = await Promise.all([
        requestJson<{ profiles?: Profile[] }>("/api/v4/profiles"),
        requestJson<{ pitches?: SavedPitch[] }>("/api/v4/pitches"),
      ]);
      setProfiles(result.profiles ?? []);
      if (!profileId && result.profiles?.[0]) setProfileId(result.profiles[0].id);
      setSavedPitches(pitchResult.pitches ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Candidate profiles could not be loaded.");
    }
  }, [profileId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadProfiles(), 0);
    return () => window.clearTimeout(timer);
  }, [loadProfiles]);

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await requestJson<{ pitch?: RecordValue; saved?: SavedPitch }>("/api/v4/pitches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sector, companyName, role, profileId: profileId || undefined, companyFacts: companyFacts.split("\n").map((item) => item.trim()).filter(Boolean) }),
      });
      setPitch(result.pitch ?? null);
      setSelectedPitch(result.saved ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The sector pitch could not be generated.");
    } finally {
      setBusy(false);
    }
  }

  async function saveRevision() {
    if (!selectedPitch || !pitch) return;
    setBusy(true);
    setError(null);
    try {
      const result = await requestJson<{ pitch?: SavedPitch }>(`/api/v4/pitches/${encodeURIComponent(selectedPitch.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload: pitch }),
      });
      if (result.pitch) setSelectedPitch(result.pitch);
      setSavedPitches((current) => result.pitch ? [result.pitch, ...current] : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The edited pitch could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  function selectSaved(value: string) {
    const saved = savedPitches.find((item) => item.id === value);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved.payloadJson) as RecordValue;
      setSelectedPitch(saved);
      setPitch(parsed);
      setSector(saved.sector);
      setCompanyName(saved.companyName);
      setRole(saved.role);
    } catch {
      setError("The saved pitch could not be read.");
    }
  }

  return <section className="workspace-frame__page">
    <div className="standalone-header"><p className="eyebrow">Evidence-backed pitch engine</p><div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="workspace-title">Sector pitches</h1><p className="workspace-description">Choose a sector playbook and generate an editable introduction from approved evidence. Company facts remain source text you provide for review.</p></div><a className="secondary-button" href="/candidate">Review evidence</a></div></div>
    {error && <div className="status-banner" role="alert">{error}</div>}
    <div className="grid gap-5 lg:grid-cols-[.75fr_1.25fr]">
      <form className="standalone-card" onSubmit={(event) => void generate(event)}>
        <p className="eyebrow">New draft</p>
        <label className="filter-field">Sector<select value={sector} onChange={(event) => setSector(event.target.value)}><option value="e-commerce">E-commerce</option><option value="startups">Startups</option><option value="fintech">Fintech</option><option value="work-permit">Work Permit Companies</option></select></label>
        <label className="filter-field">Candidate profile<select value={profileId} onChange={(event) => setProfileId(event.target.value)}><option value="">No profile evidence</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
        <label className="filter-field">Company<input value={companyName} onChange={(event) => setCompanyName(event.target.value)} required /></label>
        <label className="filter-field">Role or persona<input value={role} onChange={(event) => setRole(event.target.value)} required placeholder="Senior Product Manager" /></label>
        <label className="filter-field">Current company facts<textarea value={companyFacts} onChange={(event) => setCompanyFacts(event.target.value)} rows={5} placeholder="One sourced fact per line" /></label>
        <button className="primary-button mt-3" type="submit" disabled={busy || !companyName.trim() || !role.trim()}>{busy ? "Preparing…" : "Prepare sector pitch"}</button>
      </form>
      <section className="standalone-card" aria-live="polite"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">Editable result</p><h2 className="mt-1 text-lg font-semibold text-slate-900">Review before use</h2></div><select aria-label="Load saved pitch" value={selectedPitch?.id ?? ""} onChange={(event) => selectSaved(event.target.value)}><option value="">Saved pitch history</option>{savedPitches.map((saved) => <option value={saved.id} key={saved.id}>{saved.companyName} · v{saved.version}</option>)}</select></div>{pitch ? <div className="mt-4 space-y-4"><label className="filter-field">30-second introduction<textarea rows={4} value={String(pitch.intro ?? "")} onChange={(event) => setPitch({ ...pitch, intro: event.target.value })} /></label><label className="filter-field">100-word pitch<textarea rows={7} value={String(pitch.pitch ?? "")} onChange={(event) => setPitch({ ...pitch, pitch: event.target.value })} /></label><label className="filter-field">Differentiators, one per line<textarea rows={4} value={Array.isArray(pitch.differentiators) ? pitch.differentiators.map(String).join("\n") : ""} onChange={(event) => setPitch({ ...pitch, differentiators: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) })} /></label><label className="filter-field">Questions to ask, one per line<textarea rows={4} value={Array.isArray(pitch.questions) ? pitch.questions.map(String).join("\n") : ""} onChange={(event) => setPitch({ ...pitch, questions: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) })} /></label><div className="flex flex-wrap gap-2"><button className="primary-button" type="button" disabled={busy || !selectedPitch} onClick={() => void saveRevision()}>Save new version</button><span className="self-center text-xs text-slate-500">Evidence references: {Array.isArray(pitch.evidenceReferences) ? pitch.evidenceReferences.length : 0}. Review and edit before using.</span></div></div> : <div className="empty-state mt-4"><p className="font-semibold text-slate-800">No pitch generated</p><p className="mt-1 text-sm text-slate-500">Add a company, role and optional sourced facts to begin.</p></div>}</section>
    </div>
  </section>;
}
