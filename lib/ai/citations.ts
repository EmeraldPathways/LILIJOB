import type { ConfidenceLevel, SourceType } from "../domain/types";
import type { AgentCitation } from "./types";

export type CitationInput = {
  url: string;
  title?: string | null;
  checkedAt?: string | null;
  confidence?: ConfidenceLevel | string | null;
  sourceType?: SourceType | string | null;
};

const confidenceValues: ConfidenceLevel[] = ["high", "medium", "low"];
const sourceValues: SourceType[] = ["official-company", "official-careers", "irish-permit", "job-board", "news", "directory", "search"];

export function formatCitations(sources: CitationInput[]): AgentCitation[] {
  const seen = new Set<string>();
  return sources.flatMap((source) => {
    if (!source.url || seen.has(source.url)) return [];
    seen.add(source.url);
    const confidence = confidenceValues.includes(source.confidence as ConfidenceLevel) ? source.confidence as ConfidenceLevel : "low";
    const sourceType = sourceValues.includes(source.sourceType as SourceType) ? source.sourceType as SourceType : "search";
    return [{ url: source.url, title: source.title?.trim() || source.url, checkedAt: source.checkedAt ?? null, confidence, sourceType }];
  });
}
