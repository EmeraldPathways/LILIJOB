import { requireChatGPTUser } from "../chatgpt-auth";
import { V4Workspace } from "../../components/v4/v4-workspace";
import { AgentRunControlsPanel } from "../../components/v4/agent-run-controls-panel";

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  await requireChatGPTUser("/agent");
  return <><V4Workspace kind="agent" /><AgentRunControlsPanel /></>;
}
