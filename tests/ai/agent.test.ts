import { describe, expect, it } from "vitest";
import { needsFreshResearch, buildSavedDataPrompt } from "../../lib/ai/agent";

describe("research-agent routing", () => {
  it("uses fresh research for explicitly current questions", () => {
    expect(needsFreshResearch("Which fintech companies are hiring right now?")) .toBe(true);
    expect(needsFreshResearch("Compare the saved permit signals for these companies")) .toBe(false);
  });

  it("labels potential permit qualification separately from confirmed sponsorship", () => {
    const prompt = buildSavedDataPrompt("owner-1", [{
      name: "Example",
      permitEvidence: [
        { evidenceType: "confirmed-sponsor", statement: "A permit record names the employer." },
        { evidenceType: "potentially-qualifying-role", statement: "A role may meet permit criteria." },
      ],
    }]);
    expect(prompt).toContain("confirmed sponsorship");
    expect(prompt).toContain("potentially qualifying role");
    expect(prompt).toContain("owner-1");
  });
});
