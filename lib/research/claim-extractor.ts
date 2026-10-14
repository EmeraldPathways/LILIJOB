import { normalizeDublinLocality } from "../domain/normalize";
import type { ExtractedClaim, ResearchCompanySeed, SearchResult } from "./types";
import { classifySource, shouldUseHighConfidence } from "./source-policy";

function normalized(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : JSON.stringify(value);
}

function confidenceFor(result: SearchResult): ExtractedClaim["confidence"] {
  const sourceType = result.sourceType ?? classifySource(result.url, result.title);
  if (shouldUseHighConfidence({ sourceType, hasFullContent: Boolean(result.hasFullContent) })) return "high";
  if (sourceType === "job-board" || sourceType === "news") return "medium";
  return "low";
}

function sourceFor(result: SearchResult) {
  return {
    url: result.url,
    title: result.title,
    sourceType: result.sourceType ?? classifySource(result.url, result.title),
    provider: result.provider,
    retrievedAt: result.retrievedAt,
    hasFullContent: Boolean(result.hasFullContent),
  };
}

export async function extractClaims(
  _company: ResearchCompanySeed,
  results: SearchResult[],
): Promise<ExtractedClaim[]> {
  const claims: ExtractedClaim[] = [];
  for (const result of results) {
    const content = `${result.content ?? ""}\n${result.snippet}`.trim();
    if (!content) continue;
    const source = sourceFor(result);
    const confidence = confidenceFor(result);
    const excerpt = content.slice(0, 500);

    if (/employment permit|work permit|sponsor(?:s|ed|ing)?/i.test(content)) {
      const evidenceType = /sponsor(?:s|ed|ing)?|named employer|permit holder/i.test(content)
        ? "confirmed-sponsor"
        : /potential|eligible|qualif/i.test(content)
          ? "potentially-qualifying-role"
          : "not-found";
      claims.push({ field: "permitEvidence", value: { evidenceType, statement: excerpt }, normalizedValue: `${evidenceType}:${normalized(excerpt)}`, confidence, source, excerpt });
    }

    const locality = normalizeDublinLocality(content);
    if (locality) {
      claims.push({ field: "locality", value: locality, normalizedValue: normalized(locality), confidence, source, excerpt });
    }

    const lower = content.toLowerCase();
    const category = lower.includes("fintech")
      ? "fintech"
      : lower.includes("e-commerce") || lower.includes("ecommerce")
        ? "e-commerce"
        : lower.includes("startup") || lower.includes("start-up")
          ? "startups"
          : null;
    if (category) {
      claims.push({ field: "category", value: category, normalizedValue: category, confidence, source, excerpt });
    }

    if (/\b(careers?|jobs?|vacanc(?:y|ies)|hiring|open roles?)\b/i.test(result.title + content)) {
      claims.push({ field: "careersUrl", value: result.url, normalizedValue: result.url.toLowerCase(), confidence, source, excerpt });
    }

    if (source.sourceType === "official-company" && content.length > 80) {
      claims.push({ field: "description", value: excerpt, normalizedValue: normalized(excerpt), confidence, source, excerpt });
    }
  }
  return claims;
}
