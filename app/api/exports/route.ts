import { userFromRequest, unauthorizedResponse } from "../../../lib/auth/require-user";
import { listCompanies } from "../../../lib/repositories/company-repository";

export const dynamic = "force-dynamic";

function csvCell(value: unknown): string {
  const text = Array.isArray(value) ? value.join(", ") : String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const companies = await listCompanies(user.userId);
  const lines = [
    ["Company", "Website", "Locality", "Categories", "Permit signal", "Enrichment status"].map(csvCell).join(","),
    ...companies.map((company) => [company.name, company.website, company.locality, company.categories, company.permitSignal, company.enrichmentStatus].map(csvCell).join(",")),
  ];
  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="dublin-tech-compass.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
