import { requireChatGPTUser } from "../chatgpt-auth";
import { V4Workspace } from "../../components/v4/v4-workspace";

export const dynamic = "force-dynamic";

export default async function OpportunitiesPage() {
  await requireChatGPTUser("/opportunities");
  return <V4Workspace kind="opportunities" />;
}
