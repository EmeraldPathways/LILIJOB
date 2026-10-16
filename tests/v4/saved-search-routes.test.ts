import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../db/schema";
import { v4MigrationStatements } from "../../lib/v4/migration";

const state: { db: ReturnType<typeof drizzle> } = { db: undefined as never };
vi.mock("../../db", () => ({ getDb: () => state.db }));

function adapter(sqlite: DatabaseSync) {
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
  };
}

let sqlite: DatabaseSync;

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  for (const file of ["0000_abnormal_zeigeist.sql", "0001_tearful_eternity.sql", "0002_majestic_warlock.sql"]) {
    sqlite.exec(readFileSync(new URL(`../../drizzle/${file}`, import.meta.url), "utf8").replaceAll("--> statement-breakpoint", ""));
  }
  for (const statement of v4MigrationStatements) sqlite.exec(statement);
  state.db = drizzle(adapter(sqlite) as never, { schema });
});

afterEach(() => sqlite.close());

function request(path: string, owner = "owner-a", init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("oai-authenticated-user-id", owner);
  headers.set("oai-authenticated-user-email", `${owner}@example.test`);
  return new Request(`https://site.test${path}`, { ...init, headers });
}

describe("saved-search API", () => {
  it("requires sign-in and rejects malformed saved-search input", async () => {
    const { GET, POST } = await import("../../app/api/v4/saved-searches/route");
    expect((await GET(new Request("https://site.test/api/v4/saved-searches"))).status).toBe(401);
    const invalid = await POST(request("/api/v4/saved-searches", "owner-a", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Roles", query: { text: "x", scope: "jobs" } }) }));
    expect(invalid.status).toBe(400);
  });

  it("creates, runs and deletes only the current owner's saved search", async () => {
    const { GET, POST } = await import("../../app/api/v4/saved-searches/route");
    const { DELETE } = await import("../../app/api/v4/saved-searches/[searchId]/route");
    const { POST: run } = await import("../../app/api/v4/saved-searches/[searchId]/run/route");
    sqlite.prepare("INSERT INTO companies (id, owner_id, name, normalized_name) VALUES (?, ?, ?, ?)").run("company-a", "owner-a", "Acme", "acme");
    sqlite.prepare("INSERT INTO jobs (id, owner_id, company_id, title) VALUES (?, ?, ?, ?)").run("job-a", "owner-a", "company-a", "Product Lead");
    sqlite.prepare("INSERT INTO companies (id, owner_id, name, normalized_name) VALUES (?, ?, ?, ?)").run("company-b", "owner-b", "Other", "other");
    sqlite.prepare("INSERT INTO jobs (id, owner_id, company_id, title) VALUES (?, ?, ?, ?)").run("job-b", "owner-b", "company-b", "Product Analyst");

    const created = await POST(request("/api/v4/saved-searches", "owner-a", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Product leads", query: { text: "product", scope: "jobs" } }),
    }));
    expect(created.status).toBe(201);
    const saved = (await created.json() as { search: { id: string } }).search;
    expect((await (await GET(request("/api/v4/saved-searches"))).json() as { searches: unknown[] }).searches).toHaveLength(1);
    expect((await (await GET(request("/api/v4/saved-searches", "owner-b"))).json() as { searches: unknown[] }).searches).toEqual([]);

    const foreignRun = await run(request(`/api/v4/saved-searches/${saved.id}/run`, "owner-b", { method: "POST" }), { params: Promise.resolve({ searchId: saved.id }) });
    expect(foreignRun.status).toBe(404);
    const executed = await run(request(`/api/v4/saved-searches/${saved.id}/run`, "owner-a", { method: "POST" }), { params: Promise.resolve({ searchId: saved.id }) });
    expect(executed.status).toBe(200);
    expect(await executed.json()).toMatchObject({ search: { lastRunResult: { totalCount: 1, results: [{ id: "job-a" }] } } });
    const foreignDelete = await DELETE(request(`/api/v4/saved-searches/${saved.id}`, "owner-b", { method: "DELETE" }), { params: Promise.resolve({ searchId: saved.id }) });
    expect(foreignDelete.status).toBe(404);
    const deleted = await DELETE(request(`/api/v4/saved-searches/${saved.id}`, "owner-a", { method: "DELETE" }), { params: Promise.resolve({ searchId: saved.id }) });
    expect(deleted.status).toBe(200);
    expect((await (await GET(request("/api/v4/saved-searches"))).json() as { searches: unknown[] }).searches).toEqual([]);
  });
});
