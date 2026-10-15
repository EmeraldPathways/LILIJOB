import { describe, expect, it } from "vitest";
import { extractClaims } from "../../lib/research/claim-extractor";

describe("research claim extraction", () => {
  it("extracts open roles and public recruiting contacts from sourced results", async () => {
    const claims = await extractClaims(
      { name: "North Star", domain: "northstar.ie", location: "Dublin City" },
      [
        {
          url: "https://jobs.ie/north-star/senior-engineer",
          title: "Senior Software Engineer | North Star",
          snippet: "Senior Software Engineer in Dublin",
          content: "North Star is hiring a Senior Software Engineer in Dublin. Apply for this open role.",
          provider: "test",
          retrievedAt: "2026-10-14T00:00:00.000Z",
          sourceType: "job-board",
          hasFullContent: true,
        },
        {
          url: "https://northstar.ie/contact",
          title: "Contact North Star",
          snippet: "",
          content: "For hiring enquiries contact Jane Doe at jane.doe@northstar.ie.",
          provider: "test",
          retrievedAt: "2026-10-14T00:00:00.000Z",
          sourceType: "official-company",
          hasFullContent: true,
        },
      ],
    );

    expect(claims.some((claim) => claim.field === "job" && (claim.value as { title: string }).title === "Senior Software Engineer")).toBe(true);
    expect(claims.some((claim) => claim.field === "contact" && (claim.value as { email: string }).email === "jane.doe@northstar.ie")).toBe(true);
  });

  it("does not confirm sponsorship from negation or a generic mention", async () => {
    const claims = await extractClaims(
      { name: "North Star", domain: "northstar.ie" },
      [
        {
          url: "https://northstar.ie/careers",
          title: "North Star Careers",
          snippet: "North Star does not offer visa sponsorship. Our guide also explains employment permits.",
          content: "North Star does not offer visa sponsorship. Our guide also explains employment permits.",
          provider: "test",
          retrievedAt: "2026-10-15T00:00:00.000Z",
          sourceType: "official-careers",
          hasFullContent: true,
        },
        {
          url: "https://guide.example/permits",
          title: "Employment permit sponsorship guide",
          snippet: "Employers may discuss visa sponsorship and permits in general.",
          provider: "test",
          retrievedAt: "2026-10-15T00:00:00.000Z",
          sourceType: "search",
          hasFullContent: false,
        },
      ],
    );

    expect(claims.filter((claim) => claim.field === "permitEvidence")).toEqual([]);
    expect(claims.some((claim) => claim.field === "category" && claim.value === "work-permit")).toBe(false);
  });

  it("requires an affirmative company-specific statement and keeps its supporting excerpt", async () => {
    const claims = await extractClaims(
      { name: "North Star", domain: "northstar.ie" },
      [{
        url: "https://northstar.ie/careers",
        title: "North Star Careers",
        snippet: "North Star offers visa sponsorship for eligible engineering hires.",
        provider: "test",
        retrievedAt: "2026-10-15T00:00:00.000Z",
        sourceType: "official-careers",
        hasFullContent: false,
      }],
    );
    const permit = claims.find((claim) => claim.field === "permitEvidence");

    expect((permit?.value as { evidenceType?: string } | undefined)?.evidenceType).toBe("potentially-qualifying-role");
    expect(permit?.excerpt).toContain("offers visa sponsorship");
    expect(permit?.confidence).not.toBe("high");
  });

  it("confirms sponsorship only from an explicit company entry in a trusted permit source", async () => {
    const claims = await extractClaims(
      { name: "North Star", domain: "northstar.ie" },
      [{
        url: "https://enterprise.gov.ie/permits/employers",
        title: "Employment permit employer register",
        snippet: "North Star is listed as an approved employment permit sponsor.",
        provider: "test",
        retrievedAt: "2026-10-15T00:00:00.000Z",
        sourceType: "irish-permit",
        hasFullContent: false,
      }],
    );
    const permit = claims.find((claim) => claim.field === "permitEvidence");

    expect((permit?.value as { evidenceType?: string } | undefined)?.evidenceType).toBe("confirmed-sponsor");
    expect(permit?.confidence).not.toBe("high");
    expect(permit?.excerpt).toBe("North Star is listed as an approved employment permit sponsor.");
  });

  it("extracts canonical profile gaps with a matching sentence excerpt", async () => {
    const claims = await extractClaims(
      { name: "North Star" },
      [{
        url: "https://northstar.ie/",
        title: "About North Star",
        snippet: "North Star builds payment software for local retailers. North Star has 51 to 200 employees and was founded in 2012. North Star is headquartered in Dublin City.",
        provider: "test",
        retrievedAt: "2026-10-15T00:00:00.000Z",
        hasFullContent: false,
      }],
    );

    expect(claims.find((claim) => claim.field === "website")?.value).toBe("https://northstar.ie");
    expect(claims.find((claim) => claim.field === "domain")?.value).toBe("northstar.ie");
    expect(claims.find((claim) => claim.field === "description")?.excerpt).toBe("North Star builds payment software for local retailers.");
    expect(claims.find((claim) => claim.field === "employeeBand")?.value).toBe("51-200");
    expect(claims.find((claim) => claim.field === "foundedYear")?.value).toBe(2012);
    expect(claims.find((claim) => claim.field === "headquarters")?.excerpt).toContain("headquartered in Dublin City");
  });

  it("attributes claims only to results that match the company", async () => {
    const claims = await extractClaims(
      { name: "North Star", domain: "northstar.ie" },
      [{
        url: "https://unrelated.example/",
        title: "Generic profile",
        snippet: "A fintech company based in Dublin City is hiring a software engineer.",
        provider: "test",
        retrievedAt: "2026-10-15T00:00:00.000Z",
        sourceType: "search",
        hasFullContent: false,
      }],
    );

    expect(claims).toEqual([]);
  });

  it("does not match a company name appearing only in an unrelated URL path", async () => {
    const claims = await extractClaims(
      { name: "North Star", domain: "northstar.ie" },
      [{
        url: "https://directory.example/north-star",
        title: "Technology companies",
        snippet: "Companies listed in this directory are hiring.",
        provider: "test",
        retrievedAt: "2026-10-15T00:00:00.000Z",
        sourceType: "directory",
        hasFullContent: false,
      }],
    );

    expect(claims).toEqual([]);
  });
});
