import { describe, expect, it, vi } from "vitest";

const ai = vi.hoisted(() => ({ askOpenAI: vi.fn() }));
vi.mock("../../lib/ai/client", () => ({ askOpenAI: ai.askOpenAI, configuredModel: () => "gpt-5.6-luna" }));

import { buildApplicationPack, buildApplicationPackWithAI, buildSectorPitch, validatePack } from "../../lib/v4/packs";

describe("Version 4 evidence-constrained packs", () => {
  it("references approved evidence and flags missing metrics for confirmation", () => {
    const pack = buildApplicationPack({
      jobTitle: "Product Manager",
      companyName: "Acme Payments",
      requirements: ["payments", "experimentation", "analytics"],
      jobSourceUrl: "https://acme.test/jobs/1",
      approvedEvidence: [{ id: "ev-1", statement: "Owned payment product strategy.", metric: null }, { id: "ev-2", statement: "Led experimentation across checkout.", metric: "18% conversion improvement" }],
      candidateSummary: "Product leader focused on measurable customer outcomes.",
    });
    expect(pack.sourceUrl).toBe("https://acme.test/jobs/1");
    expect(pack.evidenceReferences).toEqual(expect.arrayContaining(["ev-1", "ev-2"]));
    expect(pack.recommendedEdits.some((edit) => edit.needsConfirmation)).toBe(true);
    expect(validatePack(pack)).toEqual([]);
    expect(pack.coverNote.split(/\s+/).length).toBeLessThanOrEqual(180);
    expect(pack.recruiterEmail.split(/\s+/).length).toBeLessThanOrEqual(120);
  });

  it("makes sector pitches materially different without adding unsupported claims", () => {
    const input = { companyName: "Acme", role: "Product Manager", companyFacts: ["The company publishes a Dublin payments platform."], approvedEvidence: [{ id: "ev-1", statement: "Owned payment product strategy.", metric: null }] };
    const fintech = buildSectorPitch("fintech", input);
    const ecommerce = buildSectorPitch("e-commerce", input);
    expect(fintech.pitch).not.toBe(ecommerce.pitch);
    expect(fintech.evidenceReferences).toContain("ev-1");
    expect(fintech.pitch).not.toMatch(/banking expertise|guaranteed sponsorship/i);
    expect(fintech.questions).toHaveLength(2);
    expect(fintech.pitch.split(/\s+/).length).toBeLessThanOrEqual(100);
  });

  it("uses low reasoning for optional AI packs and drops unapproved evidence references", async () => {
    ai.askOpenAI.mockResolvedValueOnce({
      text: JSON.stringify({
        tailoredSummary: "Evidence-backed product leader.",
        coverNote: "I am applying with approved experience.",
        recruiterEmail: "Subject: Product Manager\n\nHello, I am interested.",
        linkedinMessage: "Hello, I am interested in the role.",
        talkingPoints: ["Owned payment product strategy."],
        recommendedEdits: [
          { requirement: "payments", proposal: "Owned payment product strategy.", evidenceId: "ev-1", needsConfirmation: false },
          { requirement: "analytics", proposal: "Claimed 999% improvement.", evidenceId: "invented", needsConfirmation: false },
        ],
      }),
      raw: {},
    });
    const pack = await buildApplicationPackWithAI({
      jobTitle: "Product Manager",
      companyName: "Acme Payments",
      requirements: ["payments", "analytics"],
      jobSourceUrl: "https://acme.test/jobs/1",
      approvedEvidence: [{ id: "ev-1", statement: "Owned payment product strategy.", metric: null }],
      candidateSummary: "Product leader.",
    });
    expect(ai.askOpenAI).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ reasoningEffort: "low" }));
    expect(pack.generation?.provider).toBe("openai");
    expect(pack.recommendedEdits[1].evidenceId).toBeNull();
    expect(pack.recommendedEdits[1].needsConfirmation).toBe(true);
    expect(pack.recommendedEdits[1].proposal).not.toContain("999%");
    expect(validatePack(pack)).toEqual([]);
  });
});
