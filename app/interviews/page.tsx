import { requireChatGPTUser } from "../chatgpt-auth";
import { V4Workspace } from "../../components/v4/v4-workspace";
import { InterviewManagementPanel } from "../../components/v4/interview-management-panel";

export const dynamic = "force-dynamic";

export default async function InterviewsPage() {
  await requireChatGPTUser("/interviews");
  return <><V4Workspace kind="interviews" /><InterviewManagementPanel /></>;
}
