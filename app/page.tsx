import { requireChatGPTUser } from "./chatgpt-auth";
import { AppShell } from "../components/workbench/app-shell";
import { listCompanies, type CompanyListItem } from "../lib/repositories/company-repository";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireChatGPTUser("/");
  let companies: CompanyListItem[] = [];
  try {
    companies = await listCompanies(user.userId);
  } catch {
    // A newly published Site may be waiting for its first D1 migration. The workspace can still render and accept setup actions.
  }
  return <AppShell user={{ displayName: user.displayName, email: user.email }} initialCompanies={companies} />;
}
