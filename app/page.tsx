import { requireChatGPTUser } from "./chatgpt-auth";
import { AppShell } from "../components/workbench/app-shell";
import { listCompanies, type CompanyListItem } from "../lib/repositories/company-repository";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireChatGPTUser("/");
  let companies: CompanyListItem[] = [];
  let loadError: string | null = null;
  try {
    companies = await listCompanies(user.userId);
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Company data could not be loaded. Reload the workspace to retry.";
  }
  return <AppShell user={{ displayName: user.displayName, email: user.email }} initialCompanies={companies} initialError={loadError} />;
}
