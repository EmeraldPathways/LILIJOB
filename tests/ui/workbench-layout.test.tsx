import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AppShell } from "../../components/workbench/app-shell";
import { CompanyTabs } from "../../components/workbench/company-tabs";
import { WORKBENCH_NAV } from "../../components/workbench/navigation";
import type { CompanyListItem } from "../../lib/repositories/company-repository";

describe("Dublin Tech Compass workspace", () => {
  it("exposes the four research tabs", () => {
    expect(WORKBENCH_NAV.map((item) => item.label)).toEqual([
      "Work Permit Companies",
      "Startups",
      "Fintech",
      "E-commerce",
    ]);
  });

  it("renders the split workspace controls and privacy copy", () => {
    const html = renderToStaticMarkup(
      <AppShell user={{ displayName: "Researcher", email: "researcher@example.com" }} initialCompanies={[]} />,
    );
    expect(html).toContain("Dublin Tech Compass");
    expect(html).toContain("Private workspace");
    expect(html).toContain("Refresh now");
    expect(html).toContain("Enrich companies one at a time");
    expect(html).toContain("Import file");
    expect(html).toContain("Find companies");
    expect(html).toContain("Refresh history");
    expect(html).toContain("AI helper");
    expect(html).toContain("Filter companies");
    expect(html).toContain("Permit evidence");
    expect(html).toContain("Open roles");
    expect(html).toContain("Research assistant");
  });

  it("keeps Settings reachable from the mobile-safe top bar", () => {
    const html = renderToStaticMarkup(
      <AppShell user={{ displayName: "Researcher", email: "researcher@example.com" }} initialCompanies={[]} />,
    );

    expect(html).toContain('class="topbar-settings"');
    expect(html).toContain('href="/settings"');
    expect(html).toContain('target="_top"');
    expect(html).toContain('aria-label="Open settings"');
  });

  it("renders a mobile category selector and an accessible split-workspace landmark", () => {
    const html = renderToStaticMarkup(
      <AppShell user={{ displayName: "Researcher", email: "researcher@example.com" }} initialCompanies={[]} />,
    );

    expect(html).toContain('aria-label="Research lens"');
    expect(html).toContain('aria-label="Company workspace"');
    expect(html).toContain('aria-label="Company profile"');
    expect(html).toContain('company-list-scroll');

    const tabs = renderToStaticMarkup(
      <CompanyTabs active="overview" onChange={() => undefined}><p>Overview</p></CompanyTabs>,
    );
    expect(tabs).toContain('company-detail-scroll');
  });

  it("opens on the lens represented by imported companies", () => {
    const company = {
      id: "co-1",
      name: "Acme Payments",
      domain: "acme.ie",
      website: "https://acme.ie",
      locality: "Dublin City",
      locationText: "Dublin City",
      description: null,
      categories: ["fintech"],
      enrichmentStatus: "not-enriched",
      lastEnrichedAt: null,
      nextRefreshAt: null,
      employeeBand: null,
      permitSignal: "unknown",
      openRoles: 0,
      confidence: null,
      freshness: "unknown",
    } as CompanyListItem;
    const html = renderToStaticMarkup(<AppShell user={{ displayName: "Researcher", email: "researcher@example.com" }} initialCompanies={[company]} />);

    expect(html).toContain("County Dublin · Fintech");
    expect(html).toContain('value="fintech" selected=""');
  });
});
