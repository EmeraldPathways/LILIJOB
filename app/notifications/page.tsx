import { requireChatGPTUser } from "../chatgpt-auth";
import { NotificationsWorkspace } from "../../components/v4/notifications-workspace";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  await requireChatGPTUser("/notifications");
  return <NotificationsWorkspace />;
}
