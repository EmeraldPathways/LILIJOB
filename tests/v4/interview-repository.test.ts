import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../db/schema";
import { v4MigrationStatements } from "../../lib/v4/migration";

const state: { db: ReturnType<typeof drizzle> } = { db: undefined as never };
vi.mock("../../db", () => ({ getDb: () => state.db }));

function adapter(sqlite: DatabaseSync) {
  return { prepare(sql: string) {
    let values: unknown[] = [];
    const statement = {
      bind(...input: unknown[]) { values = input; return statement; },
      async all() { return { results: sqlite.prepare(sql).all(...values as never[]), success: true, meta: {} }; },
      async raw() { return sqlite.prepare(sql).all(...values as never[]).map((row) => Object.values(row)); },
      async run() { return sqlite.prepare(sql).run(...values as never[]); },
    };
    return statement;
  } };
}

let sqlite: DatabaseSync;

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  for (const file of ["0000_abnormal_zeigeist.sql", "0001_tearful_eternity.sql", "0002_majestic_warlock.sql"]) sqlite.exec(readFileSync(new URL(`../../drizzle/${file}`, import.meta.url), "utf8").replaceAll("--> statement-breakpoint", ""));
  for (const statement of v4MigrationStatements) sqlite.exec(statement);
  state.db = drizzle(adapter(sqlite) as never, { schema });
  sqlite.prepare("INSERT INTO companies (id, owner_id, name, normalized_name) VALUES (?, ?, ?, ?)").run("company-a", "owner-a", "Acme", "acme");
  sqlite.prepare("INSERT INTO applications (id, owner_id, company_id, title, dedup_key) VALUES (?, ?, ?, ?, ?)").run("app-a", "owner-a", "company-a", "Product Manager", "app-a");
  sqlite.prepare("INSERT INTO applications (id, owner_id, company_id, title, dedup_key) VALUES (?, ?, ?, ?, ?)").run("app-b", "owner-b", "company-a", "Other role", "app-b");
  sqlite.prepare("INSERT INTO experience_evidence (id, owner_id, profile_id, title, statement, metric, approved) VALUES (?, ?, ?, ?, ?, ?, ?)").run("evidence-approved", "owner-a", "profile-a", "PM", "Owned checkout experimentation.", "18% conversion lift", 1);
  sqlite.prepare("INSERT INTO experience_evidence (id, owner_id, profile_id, title, statement, metric, approved) VALUES (?, ?, ?, ?, ?, ?, ?)").run("evidence-unapproved", "owner-a", "profile-a", "PM", "Unreviewed claim.", null, 0);
  sqlite.prepare("INSERT INTO experience_evidence (id, owner_id, profile_id, title, statement, metric, approved) VALUES (?, ?, ?, ?, ?, ?, ?)").run("evidence-foreign", "owner-b", "profile-b", "PM", "Other owner's story.", "99%", 1);
});

afterEach(() => sqlite.close());

describe("Version 4 interview repository", () => {
  it("keeps interview and application access within the requested owner", async () => {
    const { createInterview, getInterview } = await import("../../lib/v4/interview-repository");
    expect(await createInterview("owner-a", { applicationId: "app-b", round: "Final" })).toBeNull();
    const interview = await createInterview("owner-a", { applicationId: "app-a", round: "Final", scheduledAt: "2026-10-25T01:30:00+01:00" });
    expect(interview?.interview.timezone).toBe("Europe/Dublin");
    expect(interview?.interview.scheduledAt).toBe("2026-10-25T00:30:00.000Z");
    expect(await getInterview("owner-b", interview!.interview.id)).toBeNull();
  });

  it("uses only persisted approved evidence owned by the interview owner", async () => {
    const { createInterview, createInterviewPackForInterview } = await import("../../lib/v4/interview-repository");
    const interview = await createInterview("owner-a", { applicationId: "app-a", round: "Final" });
    const pack = await createInterviewPackForInterview("owner-a", interview!.interview.id, {
      companyName: "Acme",
      roleTitle: "Product Manager",
      jobSourceUrl: "https://acme.test/jobs/1",
      checkedAt: "2026-10-15",
      companyFacts: [],
      requirements: ["experimentation"],
      approvedStories: [
        { id: "evidence-approved", statement: "Client-forged replacement", metric: "999%" },
        { id: "evidence-unapproved", statement: "Unreviewed", metric: null },
        { id: "evidence-foreign", statement: "Foreign", metric: "99%" },
      ],
    });
    const sections = JSON.parse(pack!.sectionsJson) as { starStories: Array<{ evidenceId: string; statement: string; metric: string | null }> };
    expect(sections.starStories).toEqual([{ evidenceId: "evidence-approved", statement: "Owned checkout experimentation.", metric: "18% conversion lift", matchedRequirement: "experimentation" }]);
  });

  it("persists outcome and draft state, and requires explicit owner approval", async () => {
    const { createInterview, updateInterviewOutcome, approveInterviewFollowUp } = await import("../../lib/v4/interview-repository");
    const interview = await createInterview("owner-a", { applicationId: "app-a", round: "Final" });
    const id = interview!.interview.id;
    expect(await updateInterviewOutcome("owner-b", id, { outcome: "progressed" })).toBeNull();
    const updated = await updateInterviewOutcome("owner-a", id, { outcome: "progressed", notes: "Strong conversation", followUpDraft: { text: "Thanks for your time." } });
    expect(updated?.interview).toMatchObject({ outcome: "progressed", notes: "Strong conversation", nextSteps: "Thanks for your time.", followUpDraft: { text: "Thanks for your time.", status: "draft", approvedAt: null } });
    expect(await approveInterviewFollowUp("owner-b", id)).toBeNull();
    const approved = await approveInterviewFollowUp("owner-a", id);
    expect(approved?.interview.followUpDraft).toMatchObject({ text: "Thanks for your time.", status: "approved" });
    expect(approved?.interview.followUpDraft?.approvedAt).toBeTruthy();
    expect(await approveInterviewFollowUp("owner-a", "missing-interview")).toBeNull();
  });

  it("does not approve an interview that has no follow-up draft", async () => {
    const { createInterview, approveInterviewFollowUp } = await import("../../lib/v4/interview-repository");
    const interview = await createInterview("owner-a", { applicationId: "app-a", round: "Final" });
    await expect(approveInterviewFollowUp("owner-a", interview!.interview.id)).rejects.toThrow(/draft/i);
  });

  it("saves practice edits as a new unapproved pack revision without changing generated content", async () => {
    const { createInterview, createInterviewPackForInterview, updateInterviewPractice } = await import("../../lib/v4/interview-repository");
    const interview = await createInterview("owner-a", { applicationId: "app-a", round: "Final" });
    const id = interview!.interview.id;
    await createInterviewPackForInterview("owner-a", id, { companyName: "Acme", roleTitle: "PM", jobSourceUrl: null, checkedAt: null, companyFacts: [], requirements: ["experimentation"], approvedStories: [{ id: "evidence-approved", statement: "ignored" }] });
    expect(await updateInterviewPractice("owner-b", id, [{ topic: "experimentation", answerDraft: "My answer", selfEvaluation: { relevance: 4, specificity: 4, impact: 5, reflection: "Add the baseline." } }])).toBeNull();
    const updated = await updateInterviewPractice("owner-a", id, [{ topic: "experimentation", answerDraft: "My answer", selfEvaluation: { relevance: 4, specificity: 4, impact: 5, reflection: "Add the baseline." } }]);
    expect(updated).toMatchObject({ version: 2, approvedAt: null });
    const sections = JSON.parse(updated!.sectionsJson) as { practiceQas: Array<Record<string, unknown>> };
    expect(sections.practiceQas[0]).toMatchObject({ topic: "experimentation", answerDraft: "My answer", evidenceIds: ["evidence-approved"], selfEvaluation: { relevance: 4, specificity: 4, impact: 5, reflection: "Add the baseline." } });
  });
});
