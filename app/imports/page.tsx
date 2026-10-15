import { requireChatGPTUser } from "../chatgpt-auth";
import { ImportsPanel } from "../../components/workbench/imports-panel";

export const dynamic = "force-dynamic";

export default async function ImportsPage() {
  await requireChatGPTUser("/imports");
  return (
    <section className="workspace-frame__page">
      <div className="standalone-header">
        <p className="eyebrow">Private source data</p>
        <h1 className="workspace-title">Imports</h1>
        <p className="workspace-description">
          Upload a CSV or Excel company list. Column aliases are mapped
          automatically, unknown fields are retained, and imported records
          appear in Sheet view. Research selected companies or a whole sector
          when ready.
        </p>
        <ImportsPanel />
      </div>
    </section>
  );
}
