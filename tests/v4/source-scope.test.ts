import { describe, expect, it } from "vitest";
import { allowedHostsForCompanySource, companyCareerSourceUrl, isEligibleCareerSourceUrl, isSavedCompanyPublicSource, savedCompanyPublicSourceUrls } from "../../lib/v4/source-scope";

describe("saved official company source scope", () => {
  const company = {
    website: "https://www.acme.test/",
    domain: "acme.test",
    metadataJson: JSON.stringify({ original: { Careers: "https://jobs.greenhouse.io/acme" }, publicSources: ["https://www.acme.test/team"] }),
  };

  it("uses only the company's saved website, career URL, manual public URLs, and official source records", () => {
    const sources = [
      { url: "https://www.acme.test/about", sourceType: "company-website", provider: "manual" },
      { url: "https://news.other.test/acme", sourceType: "search", provider: "web-search" },
    ];
    expect(savedCompanyPublicSourceUrls(company, sources)).toEqual([
      "https://www.acme.test/",
      "https://jobs.greenhouse.io/acme",
      "https://www.acme.test/team",
      "https://www.acme.test/about",
    ]);
    expect(isSavedCompanyPublicSource(company, sources, "https://news.other.test/acme")).toBe(false);
    expect(isSavedCompanyPublicSource(company, sources, "https://jobs.greenhouse.io/acme#apply")).toBe(true);
    expect(companyCareerSourceUrl(company, sources)).toBe("https://jobs.greenhouse.io/acme");
  });

  it("limits redirects to the saved company's site and explicitly saved ATS host", () => {
    expect(allowedHostsForCompanySource(company, "https://jobs.greenhouse.io/acme")).toEqual(["jobs.greenhouse.io", "acme.test", "www.acme.test"]);
  });

  it("recognizes imported metadata fields stored as URL objects", () => {
    const imported = { metadataJson: JSON.stringify({ original: { Careers: { url: "https://jobs.lever.co/acme" }, Website: { href: "https://acme.test" } } }) };
    expect(companyCareerSourceUrl(imported)).toBe("https://jobs.lever.co/acme");
    expect(isSavedCompanyPublicSource(imported, [], "https://jobs.lever.co/acme")).toBe(true);
  });

  it("rejects saved domain-marketplace and partner URLs as Job Radar career sources", () => {
    expect(isEligibleCareerSourceUrl("https://hugedomains.com/domain_profile.cfm?d=actusmobile.com")).toBe(false);
    expect(isEligibleCareerSourceUrl("https://go.bluesnap.com/become-a-partner")).toBe(false);
    expect(isEligibleCareerSourceUrl("https://barclays.co.uk/careers")).toBe(true);
  });
});
