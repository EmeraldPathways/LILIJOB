import { describe, expect, it } from "vitest";
import { deduplicateSignals, scoreHiringSignal, type HiringSignalCandidate } from "../../lib/v4/signals";

describe("Version 4 hiring signals", () => {
  it("scores a recent Dublin signal transparently and keeps it as a possible hiring signal", () => {
    const candidate: HiringSignalCandidate = { companyId: "co-1", type: "funding", summary: "Acme announced a Dublin team expansion after a funding round.", eventDate: "2026-10-10", discoveredAt: "2026-10-15", sourceUrl: "https://acme.test/news/1", sourceReliability: "primary", dublinConnection: true, functionRelevance: 80, companyInterest: 90 };
    const result = scoreHiringSignal(candidate, "2026-10-15");
    expect(result.relevanceScore).toBeGreaterThan(70);
    expect(result.summary).toBe(candidate.summary);
    expect(result.labels).toContain("possible hiring signal");
    expect(result.labels).toContain("source has not been independently verified");
    expect(result.labels).toContain("Dublin connection reported; not independently verified");
    expect(result.qaStatus).toBe("unverified");
    expect(result.expirationDate).toBeTruthy();
  });

  it("does not label old or non-Dublin news as a new local hiring trigger", () => {
    const result = scoreHiringSignal({ companyId: "co-1", type: "product-launch", summary: "A product launched in New York.", eventDate: "2025-01-01", discoveredAt: "2026-10-15", sourceUrl: "https://news.test/old", sourceReliability: "secondary", dublinConnection: false, functionRelevance: 20, companyInterest: 20 }, "2026-10-15");
    expect(result.isRecent).toBe(false);
    expect(result.relevanceScore).toBeLessThan(50);
    expect(result.labels).toContain("non-Dublin or unverified local connection");
    expect(result.qaStatus).toBe("expired");
    expect(result.isExpired).toBe(true);
    expect(result.relevanceScore).toBe(0);
  });

  it("deduplicates syndicated coverage while preferring primary evidence", () => {
    const candidates: HiringSignalCandidate[] = [
      { companyId: "co-1", type: "funding", summary: "Acme raised funding", eventDate: "2026-10-10", discoveredAt: "2026-10-15", sourceUrl: "https://news.test/syndicated", sourceReliability: "secondary", dublinConnection: true, functionRelevance: 50, companyInterest: 50 },
      { companyId: "co-1", type: "funding", summary: "Acme raised funding", eventDate: "2026-10-10", discoveredAt: "2026-10-15", sourceUrl: "https://acme.test/news/funding", sourceReliability: "primary", dublinConnection: true, functionRelevance: 50, companyInterest: 50 },
    ];
    expect(deduplicateSignals(candidates)).toHaveLength(1);
    expect(deduplicateSignals(candidates)[0].sourceUrl).toBe("https://acme.test/news/funding");
  });

  it("labels undated and unknown-local signals without presenting them as verified", () => {
    const result = scoreHiringSignal({ companyId: "co-1", type: "funding", summary: "Acme raised funding", eventDate: null, discoveredAt: "2026-10-15", sourceUrl: "https://news.test/funding", sourceReliability: "unknown", dublinConnection: null, functionRelevance: 0, companyInterest: 0 }, "2026-10-15");
    expect(result.labels).toContain("event date unknown");
    expect(result.labels).toContain("Dublin connection unknown");
    expect(result.labels).toContain("source reliability unknown");
    expect(result.qaStatus).toBe("unverified");
  });

  it("does not score future-dated events as recent hiring evidence", () => {
    const result = scoreHiringSignal({ companyId: "co-1", type: "funding", summary: "Acme raised funding", eventDate: "2026-10-20", discoveredAt: "2026-10-15", sourceUrl: "https://news.test/funding", sourceReliability: "primary", dublinConnection: true, functionRelevance: 80, companyInterest: 90 }, "2026-10-15");
    expect(result.isRecent).toBe(false);
    expect(result.labels).toContain("event date is in the future");
    expect(result.relevanceScore).toBeLessThan(50);
  });

  it("deduplicates normalized syndicated descriptions and prefers the highest-fidelity source", () => {
    const secondary: HiringSignalCandidate = { companyId: "co-1", type: "funding", summary: "Acme raised funding!", eventDate: "2026-10-10", discoveredAt: "2026-10-12", sourceUrl: "https://news.test/syndicated", sourceReliability: "secondary", dublinConnection: true, functionRelevance: 50, companyInterest: 50 };
    const primary: HiringSignalCandidate = { ...secondary, summary: " ACME raised funding ", discoveredAt: "2026-10-15", sourceUrl: "https://acme.test/news/funding", sourceReliability: "primary" };
    expect(deduplicateSignals([secondary, primary])).toEqual([primary]);
  });

  it("keeps a user correction visible while suppressing its score", () => {
    const result = scoreHiringSignal({ companyId: "co-1", type: "funding", summary: "Corrected event", eventDate: "2026-10-10", discoveredAt: "2026-10-15", sourceUrl: "https://news.test/funding", sourceReliability: "secondary", dublinConnection: null, functionRelevance: 80, companyInterest: 80, qaStatus: "suppressed" }, "2026-10-15");
    expect(result.qaStatus).toBe("suppressed");
    expect(result.isSuppressed).toBe(true);
    expect(result.relevanceScore).toBe(0);
    expect(result.labels).toContain("suppressed by user");
  });
});
