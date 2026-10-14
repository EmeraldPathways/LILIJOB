import { requireChatGPTUser } from "../chatgpt-auth";
import { UsageLimits } from "../../components/settings/usage-limits";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireChatGPTUser("/settings");
  return <main className="standalone-page"><div className="standalone-header"><p className="eyebrow">Operations</p><h1 className="workspace-title">Settings</h1><p className="workspace-description">Control weekly discovery, source-search limits, and the pause state for private research refreshes.</p></div><UsageLimits /></main>;
}
