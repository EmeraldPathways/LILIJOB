import { requireChatGPTUser } from "../chatgpt-auth";
import { listRuns } from "../../lib/repositories/run-repository";
import { RunTable } from "../../components/history/run-table";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const user = await requireChatGPTUser("/history");
  let runs: Awaited<ReturnType<typeof listRuns>> = [];
  try { runs = await listRuns(user.userId); } catch { runs = []; }
  return <main className="standalone-page"><div className="standalone-header"><p className="eyebrow">Operations</p><h1 className="workspace-title">Refresh history</h1><p className="workspace-description">See weekly, manual, import, and discovery runs, including partial failures that can be retried.</p></div><RunTable runs={runs} /></main>;
}
