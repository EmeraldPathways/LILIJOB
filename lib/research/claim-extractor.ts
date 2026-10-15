import { normalizeDublinLocality } from "../domain/normalize";
import type { SourceType } from "../domain/types";
import type { ExtractedClaim, ResearchCompanySeed, SearchResult } from "./types";
import { classifySource, isVerifiedCompanySite, matchesCompany, shouldUseHighConfidence, textMentionsCompany } from "./source-policy";

function normalized(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : JSON.stringify(value);
}

export function sourceTypeForCompany(company: ResearchCompanySeed, result: SearchResult): SourceType {
  const inferred = classifySource(result.url, result.title);
  if (inferred === "irish-permit" || inferred === "job-board" || inferred === "news" || inferred === "directory") return inferred;
  if (!isVerifiedCompanySite(company, result)) return "search";
  return /\/careers?\b|\/jobs?\b|jobs\.|careers\.|work-with-us|join-us/i.test(`${new URL(result.url).hostname}${new URL(result.url).pathname}`)
    ? "official-careers"
    : "official-company";
}

function confidenceFor(result: SearchResult, sourceType: SourceType): ExtractedClaim["confidence"] {
  if (shouldUseHighConfidence({ sourceType, hasFullContent: Boolean(result.hasFullContent) })) return "high";
  if (sourceType === "job-board" || sourceType === "news") return "medium";
  return "low";
}

function sourceFor(result: SearchResult, sourceType: SourceType) {
  return {
    url: result.url,
    title: result.title,
    sourceType,
    provider: result.provider,
    retrievedAt: result.retrievedAt,
    hasFullContent: Boolean(result.hasFullContent),
  };
}

function sentenceExcerpts(result: SearchResult): string[] {
  const text = (result.content?.trim() || result.snippet.trim()).replace(/\s+/g, " ");
  if (!text) return [];
  return text.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
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

function isNegatedSponsorship(sentence: string): boolean {
  const term = "(?:(?:visa\\s+)?sponsorship|sponsors?|employment\\s+permits?|work\\s+permits?)";
  return new RegExp(`\\b(?:does not|doesn't|do not|don't|is not|isn't|are not|aren't|never|no longer|not currently|cannot|can't|won't|will not|without)\\b.{0,60}\\b${term}\\b`, "i").test(sentence)
    || new RegExp(`\\b${term}.{0,45}\\b(?:is|are)?\\s*(?:not|never|unavailable|not offered|not provided)\\b`, "i").test(sentence);
}

function affirmativeSponsorship(sentence: string): boolean {
  if (isNegatedSponsorship(sentence)) return false;
  const term = "(?:(?:visa\\s+)?sponsorship|sponsors?|employment\\s+permits?|work\\s+permits?)";
  return new RegExp(`\\b(?:offers?|provides?|supports?|sponsors?|will sponsor|can sponsor)\\b.{0,80}\\b${term}\\b`, "i").test(sentence)
    || new RegExp(`\\b${term}.{0,50}\\b(?:is|are)\\s+(?:available|offered|provided|supported)\\b`, "i").test(sentence)
    || /\b(?:is|are)\s+(?:an?\s+)?(?:approved\s+)?sponsor\b/i.test(sentence);
}

function formalPermitListing(sentence: string): boolean {
  return /\b(?:listed|registered|approved|named|licensed)\b.{0,70}\b(?:employment\s+permit|permit|sponsor|employer)\b/i.test(sentence)
    || /\b(?:employment\s+permit|permit|sponsor|employer)\b.{0,70}\b(?:listed|registered|approved|named|licensed)\b/i.test(sentence);
}

function addClaim(claims: ExtractedClaim[], seen: Set<string>, claim: ExtractedClaim): void {
  const key = `${claim.field}:${claim.normalizedValue}`;
  if (seen.has(key)) return;
  seen.add(key);
  claims.push(claim);
}

export async function extractClaims(
  company: ResearchCompanySeed,
  results: SearchResult[],
): Promise<ExtractedClaim[]> {
  const claims: ExtractedClaim[] = [];
  const seen = new Set<string>();

  for (const result of results) {
    if (!matchesCompany(company, result)) continue;
    const verifiedSite = isVerifiedCompanySite(company, result);
    const sourceType = sourceTypeForCompany(company, result);
    const source = sourceFor(result, sourceType);
    const confidence = confidenceFor(result, sourceType);
    const sentences = sentenceExcerpts(result);
    const titleNamesCompany = textMentionsCompany(result.title, company.name);

    if (verifiedSite) {
      let url: URL;
      try {
        url = new URL(result.url);
      } catch {
        url = new URL("https://invalid.example");
      }
      const domain = url.hostname.toLowerCase().replace(/^www\./, "");
      const website = url.origin;
      const excerpt = result.url;
      addClaim(claims, seen, {
        field: "website", value: website, normalizedValue: website.toLowerCase(), confidence, source, excerpt,
      });
      addClaim(claims, seen, {
        field: "domain", value: domain, normalizedValue: domain, confidence, source, excerpt,
      });
    }

    for (const sentence of sentences) {
      const sentenceNamesCompany = textMentionsCompany(sentence, company.name);
      if (!verifiedSite && !sentenceNamesCompany) continue;
      const excerpt = sentence.slice(0, 500);

      if (/\b(?:employment|work)\s+permit|\bvisa\s+sponsorship|\bsponsor(?:s|ed|ing)?\b/i.test(sentence)
        && !isNegatedSponsorship(sentence)) {
        const explicitlyNamed = sentenceNamesCompany;
        const evidenceType = sourceType === "irish-permit" && explicitlyNamed && formalPermitListing(sentence)
          ? "confirmed-sponsor"
          : affirmativeSponsorship(sentence)
            ? "potentially-qualifying-role"
            : null;
        if (evidenceType) {
          addClaim(claims, seen, {
            field: "permitEvidence",
            value: { evidenceType, statement: excerpt },
            normalizedValue: `${evidenceType}:${normalized(excerpt)}`,
            confidence,
            source,
            excerpt,
          });
          addClaim(claims, seen, {
            field: "category", value: "work-permit", normalizedValue: "work-permit", confidence, source, excerpt,
          });
        }
      }

      const locality = normalizeDublinLocality(sentence);
      if (locality) {
        addClaim(claims, seen, { field: "locality", value: locality, normalizedValue: normalized(locality), confidence, source, excerpt });
      }

      const lower = sentence.toLowerCase();
      const category = lower.includes("fintech")
        ? "fintech"
        : lower.includes("e-commerce") || lower.includes("ecommerce")
          ? "e-commerce"
          : lower.includes("startup") || lower.includes("start-up")
            ? "startups"
            : null;
      if (category) {
        addClaim(claims, seen, { field: "category", value: category, normalizedValue: category, confidence, source, excerpt });
      }

      if (sourceType === "official-careers" && /\b(careers?|jobs?|vacanc(?:y|ies)|hiring|open roles?)\b/i.test(result.title + sentence)) {
        addClaim(claims, seen, { field: "careersUrl", value: result.url, normalizedValue: result.url.toLowerCase(), confidence, source, excerpt });
      }

      if ((sourceType === "job-board" || /\b(hiring|open roles?|vacanc(?:y|ies))\b/i.test(result.title + sentence))
        && (verifiedSite || sentenceNamesCompany || titleNamesCompany)) {
        const title = extractJobTitle(result, sentence);
        if (title) {
          addClaim(claims, seen, {
            field: "job",
            value: { title, url: result.url, location: normalizeDublinLocality(sentence) ?? "Dublin" },
            normalizedValue: `${normalized(title)}:${result.url.toLowerCase()}`,
            confidence,
            source,
            excerpt,
          });
        }
      }

      if (sourceType === "official-company" || sourceType === "official-careers") {
        const contact = extractContact(sentence);
        if (contact) {
          addClaim(claims, seen, { field: "contact", value: contact, normalizedValue: contact.email, confidence, source, excerpt });
        }
      }

      if (sourceType === "official-company" && sentence.length > 40 && /\b(?:company|business|software|services?|products?|builds?|provides?|develops?|creates?)\b/i.test(sentence)) {
        addClaim(claims, seen, { field: "description", value: excerpt, normalizedValue: normalized(excerpt), confidence, source, excerpt });
      }

      const employeeRange = sentence.match(/\b(\d{1,3}(?:,\d{3})?)\s*(?:-|to)\s*(\d{1,3}(?:,\d{3})?)\s+(?:employees|staff|people|team members)\b/i);
      const employeeCount = sentence.match(/\b(?:over|more than|approximately|about)\s+(\d{1,3}(?:,\d{3})?)\s+(?:employees|staff|people)\b/i);
      if (employeeRange || employeeCount) {
        const value = employeeRange
          ? `${employeeRange[1]!.replace(/,/g, "")}-${employeeRange[2]!.replace(/,/g, "")}`
          : `${employeeCount![1]!.replace(/,/g, "")}+`;
        addClaim(claims, seen, { field: "employeeBand", value, normalizedValue: value, confidence, source, excerpt });
      }

      const foundedYear = sentence.match(/\b(?:founded|established|started)\s+(?:in\s+)?(18\d{2}|19\d{2}|20\d{2})\b/i)?.[1];
      if (foundedYear) {
        addClaim(claims, seen, { field: "foundedYear", value: Number(foundedYear), normalizedValue: foundedYear, confidence, source, excerpt });
      }

      const headquarters = sentence.match(/\b(?:headquartered|headquarters|based)\s+(?:in|at)\s+([^,.;]+)/i)?.[1]?.trim();
      if (headquarters && /[a-z]/i.test(headquarters)) {
        addClaim(claims, seen, { field: "headquarters", value: headquarters, normalizedValue: normalized(headquarters), confidence, source, excerpt });
      }
    }
  }
  return claims;
}
