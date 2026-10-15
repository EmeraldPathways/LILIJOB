import { DatabaseSync } from "node:sqlite";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { v4MigrationStatements } from "../../lib/v4/migration";
import * as schema from "../../db/schema";

const state: { db: ReturnType<typeof drizzle> } = { db: undefined as never };
vi.mock("../../db", () => ({ getDb: () => state.db }));

function sqliteD1Adapter(sqlite: DatabaseSync) {
  return {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...input: unknown[]) { values = input; return statement; },
        async all() { return { results: sqlite.prepare(sql).all(...values as never[]), success: true, meta: {} }; },
        async raw() { return sqlite.prepare(sql).all(...values as never[]).map((row) => Object.values(row)); },
        async run() { return sqlite.prepare(sql).run(...values as never[]); },
      };
      return statement;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) { for (const statement of statements) await statement.run(); return []; },
  };
}

let sqlite: DatabaseSync;

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  for (const statement of v4MigrationStatements) sqlite.exec(statement);
  state.db = drizzle(sqliteD1Adapter(sqlite) as never, { schema });
});

afterEach(() => sqlite.close());

describe("Version 4 owner-scoped persistence", () => {
  it("keeps candidate profiles isolated and profile creation idempotent", async () => {
    const { getOrCreateCandidateProfile, listCandidateProfiles, getCandidateProfile, updateCandidateProfile } = await import("../../lib/v4/repository");
    const first = await getOrCreateCandidateProfile("owner-a", { name: "Primary profile", targetFamilies: ["Product"] });
    const repeated = await getOrCreateCandidateProfile("owner-a", { name: "Primary profile", targetFamilies: ["Engineering"] });
    await getOrCreateCandidateProfile("owner-b", { name: "Primary profile" });

    expect(repeated.id).toBe(first.id);
    expect((await listCandidateProfiles("owner-a")).map((row) => row.id)).toEqual([first.id]);
    expect(await getCandidateProfile("owner-b", first.id)).toBeNull();
    const updated = await updateCandidateProfile("owner-a", first.id, { constraints: { locations: ["Dublin"] } });
    expect(updated?.approvedVersion).toBe(first.approvedVersion + 1);
    expect(JSON.parse(updated?.constraintsJson ?? "{}")).toEqual({ locations: ["Dublin"] });
  });

  it("refuses evidence and applications that cross an owner boundary and deduplicates within an owner", async () => {
    const { createExperienceEvidence, createApplication, getOrCreateCandidateProfile } = await import("../../lib/v4/repository");
    const profile = await getOrCreateCandidateProfile("owner-a", { name: "Primary profile" });
    expect(await createExperienceEvidence("owner-b", profile.id, { title: "Role", statement: "Evidence" })).toBeNull();

    const first = await createApplication("owner-a", { companyId: "company-a", title: "Product role", dedupKey: "company-a:product" });
    const repeated = await createApplication("owner-a", { companyId: "company-a", title: "Product role", dedupKey: "company-a:product" });
    const otherOwner = await createApplication("owner-b", { companyId: "company-a", title: "Product role", dedupKey: "company-a:product" });
    expect(repeated.created).toBe(false);
    expect(repeated.record.id).toBe(first.record.id);
    expect(otherOwner.created).toBe(true);
  });
});
