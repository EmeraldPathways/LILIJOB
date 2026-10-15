import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/d1";
import * as XLSX from "xlsx";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";

const state = vi.hoisted(() => ({
  db: null as unknown,
  env: {
    DB: {},
    BUCKET: { put: vi.fn(), delete: vi.fn() },
  },
}));

vi.mock("cloudflare:workers", () => ({ env: state.env }));
vi.mock("../../db", () => ({ getDb: () => state.db }));

import { importWorkbook } from "../../lib/import/import-service";

let sqlite: DatabaseSync;

function d1Adapter() {
  return {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...input: unknown[]) {
          values = input;
          return statement;
        },
        async all() {
          const results = sqlite.prepare(sql).all(...values as never[]);
          return { results, success: true, meta: {} };
        },
        async raw() {
          return sqlite.prepare(sql).all(...values as never[]).map((row) => Object.values(row));
        },
        async run() {
          return sqlite.prepare(sql).run(...values as never[]);
        },
      };
      return statement;
    },
    async batch(statements: Array<{ all(): Promise<{ results: unknown[]; success: boolean; meta: object }> }>) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.all());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function setupSchema() {
  sqlite.exec(`
    CREATE TABLE companies (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, normalized_name TEXT NOT NULL,
      domain TEXT, website TEXT, aliases_json TEXT NOT NULL DEFAULT '[]', description TEXT,
      locality TEXT, location_text TEXT, employee_band TEXT, founded_year INTEGER, headquarters TEXT,
      enrichment_status TEXT NOT NULL DEFAULT 'queued', last_enriched_at TEXT, next_refresh_at TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(owner_id, normalized_name), UNIQUE(owner_id, domain)
    );
    CREATE TABLE company_categories (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, company_id TEXT NOT NULL, category TEXT NOT NULL,
      confidence TEXT NOT NULL DEFAULT 'medium', source_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(owner_id, company_id, category)
    );
    CREATE TABLE imports (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, file_key TEXT, file_name TEXT NOT NULL,
      file_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', row_count INTEGER NOT NULL DEFAULT 0,
      accepted_count INTEGER NOT NULL DEFAULT 0, duplicate_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0, errors_json TEXT NOT NULL DEFAULT '[]', run_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO companies (id, owner_id, name, normalized_name, website, domain, metadata_json, enrichment_status)
    VALUES ('co-existing', 'owner-1', 'Northwind Energy', 'northwind energy', NULL, NULL,
      '{"kept":"existing metadata","original":{"Legacy note":"retain me"}}', 'not-enriched');
  `);
}

function toArrayBuffer(value: Buffer): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

beforeEach(() => {
  sqlite?.close();
  sqlite = new DatabaseSync(":memory:");
  setupSchema();
  state.db = drizzle(d1Adapter() as never, { schema });
  state.env.BUCKET.put.mockReset().mockResolvedValue(undefined);
  state.env.BUCKET.delete.mockReset().mockResolvedValue(undefined);
});

describe("Excel import persistence", () => {
  it("persists 316 XLSX rows, including matched website/domain and arbitrary sector metadata", async () => {
    const rows: unknown[][] = [["Company Name", "Website", "Category", "Sector", "Internal note"]];
    rows.push(["Northwind Energy", "https://northwind.example", "fintech", "Clean energy", "matched row"]);
    for (let index = 2; index <= 316; index += 1) {
      rows.push([
        `Company ${index}`,
        `https://company-${index}.example`,
        index % 2 === 0 ? "startups" : "fintech",
        index % 2 === 0 ? "Climate software" : "Healthcare operations",
        index === 316 ? "" : `source row ${index}`,
      ]);
    }
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Companies");
    const file = toArrayBuffer(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));

    const summary = await importWorkbook(file, "316-companies.xlsx", "owner-1");

    expect(summary.accepted).toBe(316);
    expect(summary.queuedCompanyIds).toHaveLength(316);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM companies WHERE owner_id = ?").get("owner-1")).toMatchObject({ count: 316 });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM company_categories WHERE owner_id = ?").get("owner-1")).toMatchObject({ count: 316 });

    const matched = sqlite.prepare("SELECT website, domain, metadata_json, enrichment_status FROM companies WHERE id = ?").get("co-existing") as {
      website: string;
      domain: string;
      metadata_json: string;
      enrichment_status: string;
    };
    const matchedMetadata = JSON.parse(matched.metadata_json) as Record<string, unknown>;
    expect(matched).toMatchObject({
      website: "https://northwind.example",
      domain: "northwind.example",
      enrichment_status: "not-enriched",
    });
    expect(matchedMetadata).toMatchObject({
      kept: "existing metadata",
      sector: "Clean energy",
      original: {
        "Legacy note": "retain me",
        "Internal note": "matched row",
      },
    });

    const last = sqlite.prepare("SELECT metadata_json, enrichment_status FROM companies WHERE name = ?").get("Company 316") as {
      metadata_json: string;
      enrichment_status: string;
    };
    const lastMetadata = JSON.parse(last.metadata_json) as Record<string, unknown>;
    expect(last.enrichment_status).not.toBe("running");
    expect(lastMetadata.sector).toBe("Climate software");
    expect(lastMetadata.original).toMatchObject({ "Internal note": "" });
    expect(sqlite.prepare("SELECT status, run_id FROM imports WHERE id = ?").get(summary.importId)).toMatchObject({ status: "stored", run_id: null });
    expect(state.env.BUCKET.put).toHaveBeenCalledTimes(1);
  });
});
