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

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function AgentRunControlsPanel() {
  const [runs, setRuns] = useState<Value[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await requestJson<{ runs?: Value[] }>("/api/v4/agent/runs");
      setRuns(result.runs ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Agent runs could not be loaded.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function action(runId: string, verb: "execute" | "cancel" | "resume" | "retry") {
    setBusy(true);
    setError(null);
    try {
      await requestJson(`/api/v4/agent/runs/${encodeURIComponent(runId)}/${verb}`, { method: "POST", headers: { "content-type": "application/json" }, body: verb === "resume" ? JSON.stringify({}) : undefined });
      setMessage(`Agent run ${verb} request recorded.`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Agent run could not ${verb}.`);
    } finally {
      setBusy(false);
    }
  }

  return <section className="workspace-frame__page">
    <div className="standalone-header"><p className="eyebrow">Operational controls</p><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="workspace-title">Checkpoints, budgets and recovery</h2><p className="workspace-description">Execute safe plans, stop them, resume from saved checkpoints or retry failed steps. External actions remain blocked pending their dedicated approval flow.</p></div><button className="secondary-button" type="button" onClick={() => void load()} disabled={busy}>{busy ? "Loading…" : "Refresh runs"}</button></div></div>
    {error && <div className="status-banner" role="alert">{error}</div>}
    {message && <div className="status-banner" role="status">{message}</div>}
    <section className="standalone-card"><p className="eyebrow">Run history</p>{runs.length ? <div className="mt-4 space-y-3">{runs.map((run) => { const status = text(run.status, "queued"); const cost = run.costJson && typeof run.costJson === "string" ? (() => { try { return JSON.parse(run.costJson) as Value; } catch { return {}; } })() : (run.cost && typeof run.cost === "object" ? run.cost as Value : {}); return <article className="rounded-xl border border-slate-200 p-3" key={text(run.id)}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><a className="font-semibold text-slate-800 hover:text-blue-700" href={`/agent/${encodeURIComponent(text(run.id))}`}>{text(run.request, "Untitled run")}</a><p className="mt-1 text-xs text-slate-500">{status} · {text(run.summary, "No summary yet")}</p></div><span className="badge badge-muted">{status}</span></div><p className="mt-2 text-xs text-slate-500">Searches {number(cost.searches)} · tokens {number(cost.totalTokens)} · cost {number(cost.costCents)}¢</p><div className="mt-3 flex flex-wrap gap-2">{["queued", "running"].includes(status) && <><button className="secondary-button" type="button" onClick={() => void action(text(run.id), "execute")} disabled={busy}>Execute safe plan</button><button className="secondary-button" type="button" onClick={() => void action(text(run.id), "cancel")} disabled={busy}>Cancel</button></>}{["paused", "cancelled"].includes(status) && <button className="secondary-button" type="button" onClick={() => void action(text(run.id), "resume")} disabled={busy}>Resume</button>}{status === "failed" && <button className="secondary-button" type="button" onClick={() => void action(text(run.id), "retry")} disabled={busy}>Retry failed step</button>}</div></article>; })}</div> : <p className="empty-state mt-4">No agent runs yet. Start one above to create a checkpointed run.</p>}</section>
  </section>;
}
