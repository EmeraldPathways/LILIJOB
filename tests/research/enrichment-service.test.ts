import { describe, expect, it } from "vitest";
import { isRetryableResearchError, retryWithBackoff } from "../../lib/research/enrichment-service";

describe("enrichment retry behavior", () => {
  it("classifies timeouts and rate limits as retryable", () => {
    expect(isRetryableResearchError(new Error("request timed out"))).toBe(true);
    expect(isRetryableResearchError(new Error("429 rate limit"))).toBe(true);
    expect(isRetryableResearchError(new Error("invalid API key"))).toBe(false);
  });

  it("retries a transient provider failure and returns the successful result", async () => {
    let attempts = 0;
    const result = await retryWithBackoff(async () => {
      attempts += 1;
      if (attempts < 2) throw new Error("timeout");
      return "ok";
    }, { retries: 2, baseDelayMs: 0 });

    expect(result).toBe("ok");
    expect(attempts).toBe(2);
  });
});
