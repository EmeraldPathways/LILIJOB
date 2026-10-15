import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CompanyDetail } from "../../components/workbench/company-detail";
import type { CompanyDetail as CompanyDetailRecord } from "../../lib/repositories/company-repository";

const company = {
  id: "co-1",
  name: "North Star",
  domain: "northstar.ie",
  website: "https://northstar.ie",
  locality: "Dublin City",
  locationText: "Dublin City",
  description: "A Dublin technology company.",
  categories: ["fintech"],
  enrichmentStatus: "completed",
  lastEnrichedAt: "2026-10-14T00:00:00.000Z",
  nextRefreshAt: null,
  employeeBand: "51-200",
  permitSignal: "confirmed",
  openRoles: 1,
  confidence: "high",
  freshness: "fresh",
  aliases: [],
  headquarters: "Dublin",
  foundedYear: 2018,
  metadata: { "Internal note": "priority" },
  jobs: [{ id: "job-1", title: "Senior Engineer", url: "https://northstar.ie/jobs/1", location: "Dublin", employmentType: "Full-time", salary: null, postedAt: null, status: "open", sourceId: null, confidence: "high", ownerId: "owner", companyId: "co-1", createdAt: "2026-10-14", updatedAt: "2026-10-14" }],
  permitEvidence: [],
  contacts: [{ id: "contact-1", name: "Jane Doe", role: "Recruiting contact", email: "jane@northstar.ie", linkedinUrl: null, sourceId: null, confidence: "high", ownerId: "owner", companyId: "co-1", createdAt: "2026-10-14", updatedAt: "2026-10-14" }],
  sources: [],
  claims: [{ id: "claim-1", ownerId: "owner", companyId: "co-1", field: "careersUrl", valueJson: JSON.stringify("https://northstar.ie/careers"), normalizedValue: "https://northstar.ie/careers", confidence: "high", sourceId: null, status: "current", checkedAt: "2026-10-14", createdAt: "2026-10-14", updatedAt: "2026-10-14" }],
  history: [],
} as unknown as CompanyDetailRecord;

describe("company profile", () => {
  it("exposes sourced roles, public contacts, and a dedicated profile link", () => {
    const html = renderToStaticMarkup(<CompanyDetail company={company} activeTab="overview" onTabChange={() => undefined} onEnrich={() => undefined} />);

    expect(html).toContain("View full profile");
    expect(html).toContain("Enrich company");
    expect(html).toContain("Public contacts");
    expect(html).toContain("Jane Doe");
    expect(html).toContain("Careers page");
  });

  it("keeps every profile tab reachable with useful empty or loaded content", () => {
    const roles = renderToStaticMarkup(<CompanyDetail company={company} activeTab="roles" onTabChange={() => undefined} onEnrich={() => undefined} />);
    const permit = renderToStaticMarkup(<CompanyDetail company={company} activeTab="permit" onTabChange={() => undefined} onEnrich={() => undefined} />);
    const sources = renderToStaticMarkup(<CompanyDetail company={company} activeTab="sources" onTabChange={() => undefined} onEnrich={() => undefined} />);

    expect(roles).toContain("Senior Engineer");
    expect(permit).toContain("No permit evidence captured yet");
    expect(sources).toContain("Change history");
    expect(sources).toContain("No changes recorded yet");
  });
});
