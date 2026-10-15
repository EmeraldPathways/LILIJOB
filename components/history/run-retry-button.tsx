"use client";

import { useState } from "react";

export function RunRetryButton({ runId, kind }: { runId: string; kind?: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function retry() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/retry`, { method: "POST" });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "Retry could not start.");
      setMessage("Retry started");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Retry could not start.");
    } finally {
      setBusy(false);
    }
  }
  if (kind === "research") return <a className="text-blue-600 hover:underline" href={`/?researchRun=${encodeURIComponent(runId)}`}>Resume in workspace</a>;
  return <span className="inline-flex items-center gap-2"><button type="button" className="text-blue-600 hover:underline" onClick={() => void retry()} disabled={busy}>{busy ? "Retrying…" : "Retry"}</button>{message && <span className="text-[11px] text-slate-400" role="status">{message}</span>}</span>;
}
