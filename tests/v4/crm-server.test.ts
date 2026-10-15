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
  for (const file of ["0000_abnormal_zeigeist.sql", "0001_tearful_eternity.sql", "0002_majestic_warlock.sql"]) {
    sqlite.exec(readFileSync(new URL(`../../drizzle/${file}`, import.meta.url), "utf8").replaceAll("--> statement-breakpoint", ""));
  }
  for (const statement of v4MigrationStatements) sqlite.exec(statement);
  state.db = drizzle(adapter(sqlite) as never, { schema });
  sqlite.prepare("INSERT INTO companies (id, owner_id, name, normalized_name) VALUES (?, ?, ?, ?)").run("company-a", "owner-a", "Acme", "acme");
  sqlite.prepare("INSERT INTO companies (id, owner_id, name, normalized_name) VALUES (?, ?, ?, ?)").run("company-b", "owner-b", "Other", "other");
  sqlite.prepare("INSERT INTO jobs (id, owner_id, company_id, title, url, location, status, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("job-a", "owner-a", "company-a", "Engineer", "https://acme.test/job", "Dublin", "open", "high");
  sqlite.prepare("INSERT INTO jobs (id, owner_id, company_id, title, url, location, status, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("job-b", "owner-b", "company-b", "Engineer", "https://other.test/job", "Dublin", "open", "high");
  sqlite.prepare("INSERT INTO candidate_profiles (id, owner_id, name) VALUES (?, ?, ?)").run("profile-a", "owner-a", "Profile");
  sqlite.prepare("INSERT INTO candidate_documents (id, owner_id, profile_id, type, original_filename, object_key) VALUES (?, ?, ?, ?, ?, ?)").run("doc-a", "owner-a", "profile-a", "cv", "cv.pdf", "owner-a/cv.pdf");
});
afterEach(() => sqlite.close());

describe("server-side application CRM", () => {
  it("rejects cross-owner or mismatched optional references at the application API", async () => {
    const { POST } = await import("../../app/api/v4/applications/route");
    const headers = { "content-type": "application/json", "oai-authenticated-user-id": "owner-a", "oai-authenticated-user-email": "a@example.test" };
    const post = (body: Record<string, unknown>) => POST(new Request("http://localhost/api/v4/applications", { method: "POST", headers, body: JSON.stringify(body) }));
    const base = { companyId: "company-a", title: "Engineer", dedupKey: "api-test" };
    expect((await post({ ...base, jobId: "job-b" })).status).toBe(404);
    expect((await post({ ...base, cvDocumentId: "doc-b" })).status).toBe(404);
    expect((await post({ ...base, companyId: "company-b" })).status).toBe(404);
    expect((await post({ ...base, jobId: "job-a", cvDocumentId: "doc-a" })).status).toBe(201);
  });

  it("deduplicates concurrent creates and appends immutable stage history", async () => {
    const { createApplication, updateApplicationStage, listApplicationEvents } = await import("../../lib/v4/repository");
    const input = { companyId: "company-a", title: "Engineer", dedupKey: "acme:engineer" };
    const [a, b] = await Promise.all([createApplication("owner-a", input), createApplication("owner-a", input)]);
    expect(a.record.id).toBe(b.record.id);
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
    await updateApplicationStage("owner-a", a.record.id, "Applied", "Sent application");
    const firstEvent = (await listApplicationEvents("owner-a", a.record.id))[0];
    await updateApplicationStage("owner-a", a.record.id, "Interview", "Recruiter screen");
    const events = await listApplicationEvents("owner-a", a.record.id);
    expect(events).toHaveLength(2);
    expect(events.find((event) => event.id === firstEvent.id)).toMatchObject({ stageFrom: "Target", stageTo: "Applied", note: "Sent application" });
    await expect(createApplication("owner-a", { ...input, dedupKey: "bad-stage", stage: "Unknown" })).rejects.toThrow(/stage/i);
  });

  it("validates action status, scopes updates by owner, and generates deduplicated reminders", async () => {
    const { upsertActionItem, updateActionItem, listActionItems, generateActionReminders } = await import("../../lib/v4/dashboard");
    await expect(upsertActionItem("owner-a", { type: "x", reason: "x", dedupKey: "cross", jobId: "job-b" })).rejects.toThrow(/owner/i);
    const created = await upsertActionItem("owner-a", { type: "test", reason: "Complete this", dedupKey: "owner-action" });
    await expect(updateActionItem("owner-a", created!.id, "bad-status")).rejects.toThrow(/Use open/);
    expect(await updateActionItem("owner-b", created!.id, "completed")).toBeNull();
    expect((await updateActionItem("owner-a", created!.id, "completed"))?.status).toBe("completed");

    const { createApplication } = await import("../../lib/v4/repository");
    const app = await createApplication("owner-a", { companyId: "company-a", title: "Engineer", dedupKey: "acme:reminder", stage: "Applied", followupDueAt: "2026-10-01T12:00:00.000Z" });
    sqlite.prepare("INSERT INTO interviews (id, owner_id, application_id, round, scheduled_at) VALUES (?, ?, ?, ?, ?)").run("interview-a", "owner-a", app.record.id, "Final", "2026-10-18T12:00:00.000Z");
    sqlite.prepare("INSERT INTO job_matches (id, owner_id, job_id, profile_id, scoring_version, score, confidence, scored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("match-a", "owner-a", "job-a", "profile-a", "v1", 85, "high", "2026-10-15T00:00:00.000Z");
    const first = await generateActionReminders("owner-a", { now: new Date("2026-10-15T00:00:00.000Z") });
    const second = await generateActionReminders("owner-a", { now: new Date("2026-10-15T00:00:00.000Z") });
    expect(first.map((action) => action.type).sort()).toEqual(["high-fit-job", "overdue-follow-up", "upcoming-interview"]);
    expect(second).toHaveLength(first.length);
    expect((await listActionItems("owner-a")).filter((action) => action.dedupKey.startsWith("followup:") || action.dedupKey.startsWith("interview:") || action.dedupKey.startsWith("high-fit-job:")).length).toBe(3);
  });

  it("exports owner-scoped application CSV with safe formula handling", async () => {
    const { createApplication } = await import("../../lib/v4/repository");
    await createApplication("owner-a", { companyId: "company-a", title: "=HYPERLINK(\"https://evil.test\")", dedupKey: "csv:a", notes: "  @SUM(A1:A2)" });
    await createApplication("owner-b", { companyId: "company-b", title: "Other owner", dedupKey: "csv:b" });
    const { GET } = await import("../../app/api/v4/applications/export/route");
    const response = await GET(new Request("http://localhost/api/v4/applications/export", { headers: { "oai-authenticated-user-id": "owner-a", "oai-authenticated-user-email": "a@example.test" } }));
    const csv = await response.text();
    expect(response.status).toBe(200);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'@SUM");
    expect(csv).not.toContain("Other owner");
  });
});
