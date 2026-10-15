import Link from "next/link";
import { requireChatGPTUser } from "../chatgpt-auth";
import { AiPanel } from "../../components/ai/ai-panel";

export const dynamic = "force-dynamic";

export default async function AiPage() {
  await requireChatGPTUser("/ai");
  return <main className="standalone-page"><div className="standalone-header"><Link href="/" className="mb-4 inline-block text-sm font-semibold text-blue-600">← Company workspace</Link><p className="eyebrow">Dublin Tech Compass</p><h1 className="workspace-title">AI research helper</h1><p className="workspace-description">Ask questions over your saved companies first. Current or incomplete questions can trigger a sourced web search and save the findings automatically.</p></div><AiPanel fullScreen /></main>;
}
