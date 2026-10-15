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

function extractJobTitle(result: SearchResult, content: string): string | null {
  const titleCandidate = result.title.split(/\s*[|·–—-]\s*/)[0]?.trim();
  if (titleCandidate && !/^(careers?|jobs?|vacancies?|hiring|open roles?)$/i.test(titleCandidate) && /\b(engineer|developer|manager|designer|analyst|lead|director|specialist|architect|scientist|consultant|recruit)/i.test(titleCandidate)) {
    return titleCandidate;
  }
  const contentMatch = content.match(/(?:hiring|open role(?:s)?|vacanc(?:y|ies)|position)\s+(?:for\s+)?(?:an?\s+|the\s+)?([A-Z][A-Za-z0-9/&+ .-]{3,80}?)(?:\s+in\s+|\.|,|$)/i);
  return contentMatch?.[1]?.trim() || null;
}

function extractContact(content: string): { name: string | null; role: string | null; email: string } | null {
  const email = content.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase();
  if (!email) return null;
  const name = content.match(/(?:contact|speak to|reach)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/)?.[1] ?? null;
  const role = /\b(talent|recruit(?:ing|er)?|people|hiring|hr)\b/i.test(content) ? "Recruiting contact" : null;
  return { name, role, email };
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
      claims.push({ field: "category", value: "work-permit", normalizedValue: "work-permit", confidence, source, excerpt });
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

    if (result.sourceType === "job-board" || /\b(hiring|open roles?|vacanc(?:y|ies))\b/i.test(result.title + content)) {
      const title = extractJobTitle(result, content);
      if (title) {
        claims.push({
          field: "job",
          value: { title, url: result.url, location: normalizeDublinLocality(content) ?? "Dublin" },
          normalizedValue: `${normalized(title)}:${result.url.toLowerCase()}`,
          confidence,
          source,
          excerpt,
        });
      }
    }

    if (source.sourceType === "official-company" || source.sourceType === "official-careers") {
      const contact = extractContact(content);
      if (contact) {
        claims.push({ field: "contact", value: contact, normalizedValue: contact.email, confidence, source, excerpt });
      }
    }

    if (source.sourceType === "official-company" && content.length > 80) {
      claims.push({ field: "description", value: excerpt, normalizedValue: normalized(excerpt), confidence, source, excerpt });
    }
  }
  return claims;
}
