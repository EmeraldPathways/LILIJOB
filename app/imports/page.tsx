import { requireChatGPTUser } from "../chatgpt-auth";
import { ImportsPanel } from "../../components/workbench/imports-panel";

export const dynamic = "force-dynamic";

export default async function ImportsPage() {
  await requireChatGPTUser("/imports");
  return <main className="standalone-page"><div className="standalone-header"><p className="eyebrow">Private source data</p><h1 className="workspace-title">Imports</h1><p className="workspace-description">Upload a CSV or Excel company list. Column aliases are mapped automatically, unknown fields are retained, and imported records wait for you to enrich them individually.</p><ImportsPanel /></div></main>;
}
