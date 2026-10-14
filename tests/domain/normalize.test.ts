import { describe, expect, it } from "vitest";
import {
  dedupeKey,
  normalizeCompanyIdentity,
} from "../../lib/domain/normalize";

describe("normalizeCompanyIdentity", () => {
  it("normalizes names, aliases, domains, and preserves original values", () => {
    const result = normalizeCompanyIdentity({
      companyName: "  Example  Labs, Ltd. ",
      website: "https://www.Example.ie/jobs/",
      aliases: "Example Labs; Example",
      location: "Dublin 2",
    });

    expect(result.name).toBe("Example Labs, Ltd.");
    expect(result.normalizedName).toBe("example labs");
    expect(result.domain).toBe("example.ie");
    expect(result.aliases).toEqual(["Example Labs", "Example"]);
    expect(result.original.website).toBe("https://www.Example.ie/jobs/");
    expect(result.dedupeKey).toBe("domain:example.ie");
  });

  it("falls back to a normalized name when no usable domain exists", () => {
    const result = normalizeCompanyIdentity({
      companyName: "The Dublin AI Company!",
      website: "not-a-url",
    });

    expect(result.domain).toBeNull();
    expect(result.dedupeKey).toBe("name:dublin ai company");
    expect(dedupeKey(result)).toBe("name:dublin ai company");
  });

  it("handles missing optional values without throwing", () => {
    const result = normalizeCompanyIdentity({ companyName: "  Acme  " });

    expect(result.name).toBe("Acme");
    expect(result.aliases).toEqual([]);
    expect(result.domain).toBeNull();
    expect(result.location).toBeNull();
  });
});
