import { requireChatGPTUser } from "../../chatgpt-auth";
import { CompanyProfileClient } from "../../../components/workbench/company-profile-client";

export const dynamic = "force-dynamic";

export default async function CompanyPage({ params }: { params: Promise<{ companyId: string }> }) {
  await requireChatGPTUser("/");
  const { companyId } = await params;
  return <CompanyProfileClient companyId={companyId} />;
}
