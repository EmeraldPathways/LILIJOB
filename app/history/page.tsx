import { requireChatGPTUser } from "../chatgpt-auth";
import { listRuns } from "../../lib/repositories/run-repository";
import { RunTable } from "../../components/history/run-table";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const user = await requireChatGPTUser("/history");
  let runs: Awaited<ReturnType<typeof listRuns>> = [];
  let loadError: string | null = null;
  try { runs = await listRuns(user.userId); } catch (error) { loadError = error instanceof Error ? error.message : "Refresh history could not be loaded."; }
  return (
    <section className="workspace-frame__page">
      <div className="standalone-header">
        <p className="eyebrow">Operations</p>
        <h1 className="workspace-title">Research history</h1>
        <p className="workspace-description">
          See research progress and failures. Resume unfinished company research
          from the workspace.
        </p>
      </div>
      {loadError && (
        <div className="status-banner" role="alert">
          <span>{loadError}</span>
          <a className="font-semibold underline" href="/history">
            Retry
          </a>
        </div>
      )}
      <RunTable runs={runs} />
    </section>
  );
}
