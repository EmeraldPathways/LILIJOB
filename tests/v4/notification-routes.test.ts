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

function request(path: string, init: RequestInit = {}, owner = "owner-a") {
  const headers = new Headers(init.headers);
  headers.set("oai-authenticated-user-id", owner);
  headers.set("oai-authenticated-user-email", `${owner}@example.test`);
  return new Request(`https://site.test${path}`, { ...init, headers });
}

const enabledPreferences = {
  timezone: "Europe/Dublin",
  digestEnabled: true,
  quietStart: null,
  quietEnd: null,
  cadence: { frequency: "weekly", time: "09:30", weekday: 1 },
  consent: true,
};

describe("notification preferences and internal digest routes", () => {
  it("returns safe defaults and requires explicit consent before opting in", async () => {
    const preferencesRoute = await import("../../app/api/v4/notifications/preferences/route");
    expect((await preferencesRoute.GET(new Request("https://site.test/api/v4/notifications/preferences"))).status).toBe(401);
    expect(await (await preferencesRoute.GET(request("/api/v4/notifications/preferences"))).json()).toMatchObject({ preferences: { timezone: "Europe/Dublin", digestEnabled: false, consent: false } });
    const invalid = await preferencesRoute.PUT(request("/api/v4/notifications/preferences", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...enabledPreferences, consent: false }),
    }));
    expect(invalid.status).toBe(400);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM notification_preferences").get()).toMatchObject({ count: 0 });
  });

  it("previews opted-in digest content from a saved local run", async () => {
    const preferencesRoute = await import("../../app/api/v4/notifications/preferences/route");
    const digestRoute = await import("../../app/api/v4/notifications/digest/route");
    const savedSearchesRoute = await import("../../app/api/v4/saved-searches/route");
    const savedSearchRunRoute = await import("../../app/api/v4/saved-searches/[searchId]/run/route");
    sqlite.prepare("INSERT INTO companies (id, owner_id, name, normalized_name) VALUES (?, ?, ?, ?)").run("company-a", "owner-a", "Acme", "acme");
    sqlite.prepare("INSERT INTO jobs (id, owner_id, company_id, title) VALUES (?, ?, ?, ?)").run("job-a", "owner-a", "company-a", "Product Lead");
    await preferencesRoute.PUT(request("/api/v4/notifications/preferences", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(enabledPreferences),
    }));
    const created = await savedSearchesRoute.POST(request("/api/v4/saved-searches", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Product roles", query: { text: "product", scope: "jobs" } }),
    }));
    const id = (await created.json() as { search: { id: string } }).search.id;
    await savedSearchRunRoute.POST(request(`/api/v4/saved-searches/${id}/run`, { method: "POST" }), { params: Promise.resolve({ searchId: id }) });

    const preview = await digestRoute.GET(request("/api/v4/notifications/digest"));
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({ digest: { status: "preview-ready", source: "saved-search-results", items: [{ name: "Product roles", resultCount: 1 }] } });
    const foreign = await digestRoute.GET(request("/api/v4/notifications/digest", {}, "owner-b"));
    expect(await foreign.json()).toMatchObject({ digest: { status: "opted-out", items: [] } });
  });
});
