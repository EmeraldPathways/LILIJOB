import { describe, expect, it } from "vitest";
import { chunkIds, selectInChunks } from "../../lib/v4/query-utils";
import { parsePublishedSalary } from "../../lib/v4/salary";

describe("Version5 bounded ranking inputs", () => {
  it.each([0, 1, 99, 100, 101, 769, 2_000])("chunks %i identifiers without empty IN clauses or oversized batches", async (count) => {
    const ids = Array.from({ length: count }, (_, index) => `id-${index}`);
    const chunks = chunkIds(ids, 90);
    expect(chunks.every((chunk) => chunk.length > 0 && chunk.length <= 90)).toBe(true);
    expect(chunks.flat()).toEqual(ids);
    const seen: string[] = [];
    await selectInChunks(ids, async (chunk) => {
      if (chunk.length > 90) throw new Error("D1 binding limit exceeded");
      seen.push(...chunk);
      return chunk;
    }, 90);
    expect(seen).toEqual(ids);
  });

  it("removes duplicate identifiers while preserving first-seen order", () => {
    expect(chunkIds(["a", "a", "b", "", "b", "c"], 2)).toEqual([["a", "b"], ["c"]]);
  });

  it("rejects invalid chunk sizes", () => {
    expect(() => chunkIds(["a"], 0)).toThrow(/positive/i);
  });
});

describe("published salary normalization", () => {
  it("keeps an explicit annual EUR range and original text", () => {
    expect(parsePublishedSalary("€60,000–€80,000 per year", "EUR")).toEqual({
      min: 60_000,
      max: 80_000,
      currency: "EUR",
      period: "year",
      original: "€60,000–€80,000 per year",
    });
  });

  it("does not annualise an hourly rate or infer an unpublished value", () => {
    expect(parsePublishedSalary("€25 per hour", "EUR")?.period).toBe("hour");
    expect(parsePublishedSalary(null, null)).toBeNull();
  });
});
