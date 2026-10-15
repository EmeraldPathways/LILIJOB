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
});
