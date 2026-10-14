import type { InferSelectModel } from "drizzle-orm";
import type { refreshRuns } from "../../db/schema";

export function RunTable({ runs }: { runs: Array<InferSelectModel<typeof refreshRuns>> }) {
  return <div className="settings-card"><div className="overflow-x-auto"><table className="run-table"><thead><tr><th>Run</th><th>Scope</th><th>Status</th><th>Progress</th><th>Started</th></tr></thead><tbody>{runs.length ? runs.map((run) => <tr key={run.id}><td><strong>{run.kind}</strong><small>{run.id.slice(0, 14)}</small></td><td>{run.category ?? run.companyId ?? "All companies"}</td><td><span className={`badge ${run.status === "completed" ? "badge-green" : run.status === "failed" ? "badge-muted" : "badge-amber"}`}>{run.status}</span></td><td>{run.processed}/{run.total} · {run.failed} failed</td><td>{run.startedAt ? new Date(run.startedAt).toLocaleString("en-IE") : "Queued"}</td></tr>) : <tr><td colSpan={5} className="empty-table">No refresh runs yet.</td></tr>}</tbody></table></div></div>;
}
