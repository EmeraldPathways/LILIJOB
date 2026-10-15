import { userFromRequest, unauthorizedResponse } from "../../../lib/auth/require-user";
import { listCompanies } from "../../../lib/repositories/company-repository";
import { sectorCompanies } from "../../../lib/workbench/sector-workspace";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

function csvCell(value: unknown): string {
  const raw = Array.isArray(value) ? value.join(", ") : String(value ?? "");
  const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw.trim());
  const text = !numeric && /^[\s]*[=+@-]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const format = new URL(request.url).searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  let companies;
  try {
    companies = await listCompanies(user.userId);
  } catch (error) {
    return Response.json({ error: { code: "EXPORT_FAILED", message: error instanceof Error ? error.message : "Unable to prepare export." } }, { status: 500 });
  }
  const sector = new URL(request.url).searchParams.get("sector") ?? "All sectors";
  const records = sectorCompanies(companies, sector).map((company) => ({
    "Profile company": company.name,
    "Profile website": company.website,
    "Profile sector": company.sector,
    Company: company.name,
    Website: company.website,
    Locality: company.locality,
    Categories: company.categories.join(", "),
    "Permit signal": company.permitSignal,
    "Open roles": company.openRoles,
    Confidence: company.confidence,
    Freshness: company.freshness,
    "Enrichment status": company.enrichmentStatus,
    Description: company.description,
    ...company.importedData,
  }));
  if (format === "xlsx") {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(records);
    XLSX.utils.book_append_sheet(workbook, sheet, "Companies");
    const output = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    return new Response(output, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": "attachment; filename=\"dublin-tech-compass.xlsx\"",
        "cache-control": "private, no-store",
      },
    });
  }
  const headers = records.length ? [...new Set(records.flatMap(record=>Object.keys(record)))] : ["Company", "Website", "Sector"];
  const lines = [
    headers.map(csvCell).join(","),
    ...records.map(record=>headers.map(header=>csvCell((record as Record<string,unknown>)[header])).join(",")),
  ];
  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="dublin-tech-compass.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
