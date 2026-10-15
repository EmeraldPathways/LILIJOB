"use client";

import { useCallback, useEffect, useState } from "react";

type Value = Record<string, unknown>;

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as Value;
  if (!response.ok) {
    const error = body.error && typeof body.error === "object" ? body.error as Value : {};
    throw new Error(typeof error.message === "string" ? error.message : `Request failed (${response.status}).`);
  }
  return body as T;
}

function asObject(value: unknown): Value {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Value : {};
}

function asArray(value: unknown): Value[] {
  return Array.isArray(value) ? value.filter((item): item is Value => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
}

function parseSections(value: unknown): Value {
  if (typeof value !== "string") return asObject(value);
  try { return asObject(JSON.parse(value)); } catch { return {}; }
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function InterviewManagementPanel() {
  const [interviews, setInterviews] = useState<Value[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selected, setSelected] = useState<Value | null>(null);
  const [sections, setSections] = useState<Value | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState("awaiting");
  const [notes, setNotes] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await requestJson<{ interviews?: Value[] }>("/api/v4/interviews");
      const next = result.interviews ?? [];
      setInterviews(next);
      const nextId = selectedId && next.some((item) => item.id === selectedId) ? selectedId : text(next[0]?.id);
      setSelectedId(nextId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Interview records could not be loaded.");
    } finally {
      setBusy(false);
    }
  }, [selectedId]);

  const loadSelected = useCallback(async (interviewId: string) => {
    if (!interviewId) {
      setSelected(null);
      setSections(null);
      return;
    }
    try {
      const result = await requestJson<{ interview?: Value; packs?: Value[] }>(`/api/v4/interviews/${encodeURIComponent(interviewId)}`);
      setSelected(result.interview ?? null);
      const latest = result.packs?.[0];
      const nextSections = latest ? parseSections(latest.sectionsJson) : null;
      setSections(nextSections);
      const qas = asArray(nextSections?.practiceQas);
      setAnswers(Object.fromEntries(qas.map((qa) => [text(qa.topic), text(qa.answerDraft)])));
      const current = asObject(result.interview?.followUpDraft);
      setOutcome(text(result.interview?.outcome, "awaiting"));
      setNotes(text(result.interview?.notes));
      setFollowUp(text(current.text, text(result.interview?.nextSteps)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The selected interview could not be loaded.");
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => { const timer = window.setTimeout(() => void loadSelected(selectedId), 0); return () => window.clearTimeout(timer); }, [loadSelected, selectedId]);

  async function savePractice() {
    if (!selectedId || !sections) return;
    const qas = asArray(sections.practiceQas);
    if (!qas.length) return;
    setBusy(true);
    try {
      const updates = qas.map((qa) => ({
        topic: text(qa.topic),
        answerDraft: answers[text(qa.topic)] ?? "",
        selfEvaluation: asObject(qa.selfEvaluation),
      }));
      await requestJson(`/api/v4/interviews/${encodeURIComponent(selectedId)}/pack`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ practiceQas: updates }) });
      setMessage("Practice answers saved as a new preparation version.");
      await loadSelected(selectedId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Practice answers could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function saveOutcome() {
    if (!selectedId) return;
    setBusy(true);
    try {
      await requestJson(`/api/v4/interviews/${encodeURIComponent(selectedId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ outcome, notes, followUpDraft: followUp.trim() ? { text: followUp.trim() } : null }) });
      setMessage("Interview outcome and follow-up draft saved. Sending remains a separate approval action.");
      await loadSelected(selectedId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Interview outcome could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function approveFollowUp() {
    if (!selectedId || !followUp.trim()) return;
    setBusy(true);
    try {
      await requestJson(`/api/v4/interviews/${encodeURIComponent(selectedId)}/follow-up/approve`, { method: "POST" });
      setMessage("Follow-up marked approved for review in the outreach workflow.");
      await loadSelected(selectedId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Follow-up approval could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  const predictions = asArray(sections?.predictions);
  const stories = asArray(sections?.starStories);
  const qas = asArray(sections?.practiceQas);
  const selectedFollowUp = asObject(selected?.followUpDraft);

  return <section className="workspace-frame__page"><section className="space-y-5" aria-label="Interview preparation controls">
    {error && <div className="status-banner" role="alert">{error}</div>}
    {message && <div className="status-banner" role="status">{message}</div>}
    <section className="standalone-card">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="eyebrow">Preparation workspace</p><h2 className="mt-1 text-xl font-semibold text-slate-900">Review, practise and record outcome</h2></div>
        <label className="filter-field min-w-64">Interview<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} disabled={busy}><option value="">Choose an interview</option>{interviews.map((item) => <option key={text(item.id)} value={text(item.id)}>{text(item.round, "Interview")} · {text(item.scheduledAt, "unscheduled")}</option>)}</select></label>
      </div>
      {!interviews.length && <p className="empty-state mt-4">Schedule an interview above before opening its preparation workspace.</p>}
      {selected && <p className="mt-4 text-xs text-slate-500">{text(selected.timezone, "Europe/Dublin")} · outcome {text(selected.outcome, "awaiting")} · follow-up {text(selectedFollowUp.status, "draft")}</p>}
    </section>

    {sections && <>
      <section className="standalone-card">
        <p className="eyebrow">Source-backed brief</p>
        <p className="mt-3 text-sm leading-6 text-slate-700">{text(sections.brief, "Company and role details need confirmation before use.")}</p>
        <div className="mt-4 grid gap-5 md:grid-cols-2"><div><h3 className="section-title">Predicted topics</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">{predictions.map((item) => <li key={text(item.topic)}>{text(item.topic)} <span className="text-xs text-slate-400">(prediction)</span></li>)}</ul></div><div><h3 className="section-title">Approved STAR evidence</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">{stories.length ? stories.map((item) => <li key={text(item.evidenceId)}>{text(item.statement)}{text(item.metric) ? ` (${text(item.metric)})` : ""}</li>) : <li>No approved stories are attached.</li>}</ul></div></div>
      </section>
      <section className="standalone-card">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="eyebrow">Practice Q&amp;A</p><h2 className="mt-1 text-xl font-semibold text-slate-900">Editable answers</h2></div><button className="primary-button" type="button" onClick={() => void savePractice()} disabled={busy || !qas.length}>Save practice version</button></div>
        <div className="mt-4 space-y-4">{qas.length ? qas.map((qa) => { const topic = text(qa.topic); return <label className="filter-field" key={topic}>{topic}<span className="mt-1 block text-xs font-normal text-slate-400">{text(qa.question)}</span><textarea rows={4} value={answers[topic] ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [topic]: event.target.value }))} placeholder="Write a truthful answer outline from an approved story." /></label>; }) : <p className="empty-state">This preparation version has no practice questions.</p>}</div>
      </section>
    </>}

    {selected && <section className="standalone-card">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="eyebrow">Outcome and follow-up</p><h2 className="mt-1 text-xl font-semibold text-slate-900">Keep the next step explicit</h2></div><button className="primary-button" type="button" onClick={() => void saveOutcome()} disabled={busy}>Save outcome</button></div>
      <div className="mt-4 grid gap-3 md:grid-cols-2"><label className="filter-field">Outcome<select value={outcome} onChange={(event) => setOutcome(event.target.value)}><option value="awaiting">Awaiting</option><option value="progressed">Progressed</option><option value="offer">Offer</option><option value="rejected">Rejected</option><option value="withdrawn">Withdrawn</option></select></label><label className="filter-field">Notes<textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="What did you learn?" /></label></div>
      <label className="filter-field mt-3">Follow-up draft<textarea rows={4} value={followUp} onChange={(event) => setFollowUp(event.target.value)} placeholder="Draft a thank-you or next-step note. It is not sent automatically." /></label>
      <div className="mt-3 flex flex-wrap items-center gap-3"><button className="secondary-button" type="button" onClick={() => void approveFollowUp()} disabled={busy || !followUp.trim() || text(selectedFollowUp.status) === "approved"}>{text(selectedFollowUp.status) === "approved" ? "Follow-up approved" : "Approve follow-up draft"}</button><span className="text-xs text-slate-500">Approval records the draft only; Gmail sending still requires its own explicit review.</span></div>
    </section>}
  </section></section>;
}
