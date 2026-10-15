import { requireChatGPTUser } from "../chatgpt-auth";
import { V4Workspace } from "../../components/v4/v4-workspace";

export const dynamic = "force-dynamic";

export default async function CandidatePage() {
  await requireChatGPTUser("/candidate");
  return <V4Workspace kind="candidate" />;
}
