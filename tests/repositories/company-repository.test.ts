import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import { groupRowsByCompanyId } from "../../lib/repositories/company-relations";
import { companySheetFields } from "../../lib/repositories/company-repository";
import { buildCompanyCellUpdatePlan } from "../../lib/sheet-data/cell-update";

const state = vi.hoisted(() => ({ db: null as unknown, raceOnCompanyRead: false }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("../../db", () => ({ getDb: () => state.db }));

function sqliteD1Adapter(sqlite: DatabaseSync) {
  return {
    prepare(sql: string) {
      let values: unknown[] = [];
      function readRows() {
        const results = sqlite.prepare(sql).all(...values as never[]);
        if (state.raceOnCompanyRead && /^\s*SELECT/i.test(sql) && /FROM "companies"/i.test(sql)) {
          state.raceOnCompanyRead = false;
          sqlite.prepare("UPDATE companies SET metadata_json = ?, updated_at = ? WHERE id = ?")
            .run('{"original":{"Other tab":"saved"}}', "2026-10-15T12:01:00.000Z", "co-1");
        }
        return results;
      }
      const statement = {
        bind(...input: unknown[]) {
          values = input;
          return statement;
        },
        async all() {
          return { results: readRows(), success: true, meta: {} };
        },
        async raw() {
          return readRows().map((row) => Object.values(row));
        },
        async run() {
          return sqlite.prepare(sql).run(...values as never[]);
        },
      };
      return statement;
    },
  };
}

describe("company relation aggregation", () => {
  it("groups category and evidence rows without losing duplicate relations", () => {
    const grouped = groupRowsByCompanyId([
      { companyId: "company-a", category: "fintech" },
      { companyId: "company-b", category: "startups" },
      { companyId: "company-a", category: "work-permit" },
    ]);

    expect(grouped.get("company-a")).toEqual([
      { companyId: "company-a", category: "fintech" },
      { companyId: "company-a", category: "work-permit" },
    ]);
    expect(grouped.get("company-b")).toEqual([
      { companyId: "company-b", category: "startups" },
    ]);
    expect(grouped.get("missing")).toBeUndefined();
  });

  it("plans cell edits into canonical fields while retaining unknown and original cells", () => {
    const company = {
      name: "Northwind",
      normalizedName: "northwind",
      domain: "northwind.example",
      website: "https://northwind.example",
      aliasesJson: "[]",
      description: null,
      locality: null,
      locationText: null,
      employeeBand: null,
      foundedYear: null,
      metadataJson: JSON.stringify({
        sourceNote: "keep this",
        original: {
          "Company Name": "Northwind",
          Website: "https://northwind.example",
          Category: "fintech",
          Sector: "Financial technology",
          "Internal owner": "Mina",
        },
      }),
    };

    const plan = buildCompanyCellUpdatePlan(company, {
      "Company Name": "Northwind Group",
      Website: "northwind-group.example",
      Category: "startups",
      Sector: "Climate technology",
      "Internal owner": "Rae",
    });
    const metadata = JSON.parse(plan.updates.metadataJson ?? "{}") as Record<string, unknown>;
    const original = metadata.original as Record<string, string>;

    expect(plan.updates).toMatchObject({
      name: "Northwind Group",
      normalizedName: "northwind group",
      domain: "northwind-group.example",
      website: "northwind-group.example",
    });
    expect(plan.category).toBe("startups");
    expect(metadata).toMatchObject({
      sourceNote: "keep this",
      sector: "Climate technology",
      "Internal owner": "Rae",
    });
    expect(original).toMatchObject({
      "Company Name": "Northwind Group",
      Website: "northwind-group.example",
      Category: "startups",
      Sector: "Climate technology",
      "Internal owner": "Rae",
    });
  });

  it("reads arbitrary sectors and string-valued original cells from metadata", () => {
    expect(companySheetFields(JSON.stringify({
      sector: "Clean energy",
      original: { Sector: "Clean energy", "Empty note": "", count: 4 },
    }))).toEqual({
      sector: "Clean energy",
      importedData: { Sector: "Clean energy", "Empty note": "" },
    });
  });

  it("rejects edits that would leave a company without a name", () => {
    const company = {
      name: "Northwind",
      normalizedName: "northwind",
      domain: null,
      website: null,
      aliasesJson: "[]",
      description: null,
      locality: null,
      locationText: null,
      employeeBand: null,
      foundedYear: null,
      metadataJson: JSON.stringify({ original: { Company: "Northwind" } }),
    };

    expect(() => buildCompanyCellUpdatePlan(company, { Company: "  " })).toThrow(/name/i);
  });

  it("rejects a stale cell save when another tab changes metadata after the initial read", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`
      CREATE TABLE companies (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, normalized_name TEXT NOT NULL,
        domain TEXT, website TEXT, aliases_json TEXT NOT NULL, description TEXT, locality TEXT,
        location_text TEXT, employee_band TEXT, founded_year INTEGER, headquarters TEXT,
        enrichment_status TEXT NOT NULL, last_enriched_at TEXT, next_refresh_at TEXT,
        metadata_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT INTO companies (id, owner_id, name, normalized_name, aliases_json, enrichment_status,
        metadata_json, created_at, updated_at)
      VALUES ('co-1', 'owner-1', 'Northwind', 'northwind', '[]', 'not-enriched',
        '{"original":{"Company":"Northwind"}}', '2026-10-15T12:00:00.000Z', '2026-10-15T12:00:00.000Z');
    `);
    state.db = drizzle(sqliteD1Adapter(sqlite) as never, { schema });
    state.raceOnCompanyRead = true;

    try {
      const { updateCompanyCells, CompanyCellConflictError } = await import("../../lib/repositories/company-repository");
      const rejection = await updateCompanyCells("owner-1", "co-1", { "Internal owner": "Mina" }).catch((error) => error);
      expect(rejection).toBeInstanceOf(CompanyCellConflictError);
      expect(sqlite.prepare("SELECT metadata_json, updated_at FROM companies WHERE id = ?").get("co-1"))
        .toEqual({
          metadata_json: '{"original":{"Other tab":"saved"}}',
          updated_at: "2026-10-15T12:01:00.000Z",
        });
    } finally {
      state.raceOnCompanyRead = false;
      state.db = null;
      sqlite.close();
    }
  });
});
