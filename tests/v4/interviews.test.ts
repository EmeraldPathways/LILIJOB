import { describe, expect, it } from "vitest";
import { applyPracticeQaUpdates, buildInterviewPack, isDublinTimezone, validateInterviewSchedule } from "../../lib/v4/interviews";

describe("Version 4 interview preparation", () => {
  it("labels predictions and matches only supplied approved evidence", () => {
    const pack = buildInterviewPack({
      companyName: "Acme Payments",
      roleTitle: "Senior Product Manager",
      jobSourceUrl: "https://acme.test/jobs/1",
      checkedAt: "2026-10-15",
      companyFacts: ["Acme publishes a Dublin payments platform."],
      requirements: ["experimentation", "stakeholder leadership"],
      approvedStories: [{ id: "ev-1", statement: "Led experimentation across checkout.", metric: "18% conversion improvement" }],
    });
    expect(pack.sourceMeta).toContain("https://acme.test/jobs/1");
    expect(pack.predictions.every((item) => item.label === "prediction")).toBe(true);
    expect(pack.starStories[0].evidenceId).toBe("ev-1");
    expect(pack.starStories[0].metric).toBe("18% conversion improvement");
    expect(pack.questionsToAsk.length).toBeGreaterThanOrEqual(3);
  });

  it("uses an explicit offline fallback when current sources are absent", () => {
    const pack = buildInterviewPack({ companyName: "Unknown", roleTitle: "Product Manager", jobSourceUrl: null, checkedAt: null, companyFacts: [], requirements: [], approvedStories: [] });
    expect(pack.brief).toMatch(/source|confirm/i);
    expect(pack.starStories).toEqual([]);
  });

  it("keeps the default timezone Europe/Dublin", () => {
    expect(isDublinTimezone(undefined)).toBe(true);
    expect(isDublinTimezone("Europe/Dublin")).toBe(true);
    expect(isDublinTimezone("America/New_York")).toBe(false);
  });

  it("creates practice Q&A with blank answer drafts and self-evaluation linked to approved evidence", () => {
    const pack = buildInterviewPack({
      companyName: "Acme Payments",
      roleTitle: "Senior Product Manager",
      jobSourceUrl: "https://acme.test/jobs/1",
      checkedAt: "2026-10-15",
      companyFacts: [],
      requirements: ["experimentation", "stakeholder leadership"],
      approvedStories: [{ id: "ev-1", statement: "Led experimentation across checkout.", metric: "18% conversion improvement" }],
    });

    expect(pack.practiceQas).toHaveLength(2);
    expect(pack.practiceQas[0]).toMatchObject({
      topic: "experimentation",
      answerDraft: "",
      evidenceIds: ["ev-1"],
      selfEvaluation: { relevance: null, specificity: null, impact: null, reflection: "" },
    });
    expect(pack.practiceQas[0].question).toMatch(/experimentation/i);
  });

  it("rejects malformed, incomplete, and future-dated interview sources", () => {
    const input = { companyName: "Acme", roleTitle: "Product Manager", jobSourceUrl: "https://acme.test/job", checkedAt: "2026-10-15", companyFacts: [], requirements: [], approvedStories: [] };
    expect(() => buildInterviewPack({ ...input, jobSourceUrl: "javascript:alert(1)" })).toThrow(/source/i);
    expect(() => buildInterviewPack({ ...input, checkedAt: "2026-02-30" })).toThrow(/date/i);
    expect(() => buildInterviewPack({ ...input, checkedAt: "2999-12-31" })).toThrow(/future/i);
    expect(() => buildInterviewPack({ ...input, jobSourceUrl: null })).toThrow(/source URL and checked date.*together/i);
  });

  it("requires an explicit timestamp offset and the Europe/Dublin timezone", () => {
    expect(validateInterviewSchedule("2026-10-25T01:30:00", "Europe/Dublin")).toMatch(/offset/i);
    expect(validateInterviewSchedule("2026-10-25T01:30:00+01:00", "America/New_York")).toMatch(/Europe\/Dublin/i);
    expect(validateInterviewSchedule("2026-10-25T01:30:00+01:00", "Europe/Dublin")).toBeNull();
    expect(validateInterviewSchedule("2026-07-01T09:00:00Z", "Europe/Dublin")).not.toBeNull();
    expect(validateInterviewSchedule("2026-02-30T10:00:00Z", "Europe/Dublin")).toMatch(/valid/i);
  });

  it("saves only answer and self-evaluation edits while preserving generated prompts and evidence links", () => {
    const pack = buildInterviewPack({
      companyName: "Acme",
      roleTitle: "Product Manager",
      jobSourceUrl: null,
      checkedAt: null,
      companyFacts: [],
      requirements: ["experimentation"],
      approvedStories: [{ id: "ev-1", statement: "Led experimentation across checkout." }],
    });
    const question = pack.practiceQas[0].question;
    const updated = applyPracticeQaUpdates(pack, [{
      topic: "experimentation",
      answerDraft: "I led the checkout experiment.",
      selfEvaluation: { relevance: 4, specificity: 5, impact: 3, reflection: "Add the baseline metric." },
    }]);

    expect(updated.practiceQas[0]).toMatchObject({
      question,
      evidenceIds: ["ev-1"],
      answerDraft: "I led the checkout experiment.",
      selfEvaluation: { relevance: 4, specificity: 5, impact: 3, reflection: "Add the baseline metric." },
    });
    expect(() => applyPracticeQaUpdates(pack, [{ topic: "unknown", answerDraft: "Answer", selfEvaluation: { relevance: null, specificity: null, impact: null, reflection: "" } }])).toThrow(/question/i);
    expect(() => applyPracticeQaUpdates(pack, [{ topic: "experimentation", answerDraft: "Answer", selfEvaluation: { relevance: 6, specificity: null, impact: null, reflection: "" } }])).toThrow(/1 and 5/i);
  });
});
