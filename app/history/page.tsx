import { requireChatGPTUser } from "../chatgpt-auth";
import { listRuns } from "../../lib/repositories/run-repository";
import { RunTable } from "../../components/history/run-table";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const user = await requireChatGPTUser("/history");
  let runs: Awaited<ReturnType<typeof listRuns>> = [];
  let loadError: string | null = null;
  try { runs = await listRuns(user.userId); } catch (error) { loadError = error instanceof Error ? error.message : "Refresh history could not be loaded."; }
  return <main className="standalone-page"><div className="standalone-header"><p className="eyebrow">Operations</p><h1 className="workspace-title">Refresh history</h1><p className="workspace-description">See weekly, manual, import, and discovery runs, including partial failures that can be retried.</p></div>{loadError && <div className="status-banner" role="alert"><span>{loadError}</span><a className="font-semibold underline" href="/history">Retry</a></div>}<RunTable runs={runs} /></main>;
}
