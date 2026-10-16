import { requireChatGPTUser } from "../chatgpt-auth";
import { SavedSearchesWorkspace } from "../../components/v4/saved-searches-workspace";

export const dynamic = "force-dynamic";

export default async function SavedSearchesPage() {
  await requireChatGPTUser("/saved-searches");
  return <SavedSearchesWorkspace />;
}
