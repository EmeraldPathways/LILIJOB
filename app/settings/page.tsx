import { requireChatGPTUser } from "../chatgpt-auth";
import { UsageLimits } from "../../components/settings/usage-limits";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireChatGPTUser("/settings");
  return (
    <section className="workspace-frame__page">
      <div className="standalone-header">
        <p className="eyebrow">Operations</p>
        <h1 className="workspace-title">Settings</h1>
        <p className="workspace-description">
          Research selected companies or all companies in the current sector
          from the dashboard. Enrichment uses GPT-5.6 Luna with low reasoning;
          the assistant uses medium. Automatic research is disabled.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a className="secondary-button" href="/api/exports?format=csv">
            Export CSV
          </a>
          <a className="secondary-button" href="/api/exports?format=xlsx">
            Export XLSX
          </a>
        </div>
      </div>
      <UsageLimits />
    </section>
  );
}
