import type { ConfidenceLevel } from "../domain/types";
import { sourceScore } from "./source-policy";
import type {
  ClaimChange,
  ClaimConflict,
  ExistingClaim,
  ExtractedClaim,
  MergeResult,
} from "./types";

const CONFIDENCE_SCORES: Record<ConfidenceLevel, number> = { high: 3, medium: 2, low: 1 };

function score(claim: ExistingClaim | ExtractedClaim): number {
  return CONFIDENCE_SCORES[claim.confidence] * 10 + sourceScore(claim.source.sourceType) + (claim.source.hasFullContent ? 2 : 0);
}

function key(claim: ExistingClaim | ExtractedClaim): string {
  const evidenceType = typeof claim.value === "object" && claim.value && "evidenceType" in claim.value
    ? String((claim.value as { evidenceType: string }).evidenceType)
    : "";
  return `${claim.field}:${evidenceType}`;
}

export function mergeClaims(
  existing: ExistingClaim[],
  incoming: ExtractedClaim[],
  runId: string,
): MergeResult {
  const current = [...existing];
  const changes: ClaimChange[] = [];
  const conflicts: ClaimConflict[] = [];

  for (const next of incoming) {
    const matchIndex = current.findIndex((claim) => key(claim) === key(next));
    if (matchIndex < 0) {
      current.push(next);
      changes.push({ field: next.field, previous: null, next: next.value, runId, reason: "claim-added" });
      continue;
    }

    const previous = current[matchIndex];
    if (previous.normalizedValue === next.normalizedValue) {
      if (score(next) > score(previous)) current[matchIndex] = next;
      continue;
    }

    if (score(next) > score(previous)) {
      current[matchIndex] = next;
      changes.push({ field: next.field, previous: previous.value, next: next.value, runId, reason: "stronger-finding-replaced" });
      conflicts.push({ field: next.field, values: [previous.value, next.value], runId });
      continue;
    }

    if (score(next) < score(previous)) {
      changes.push({ field: next.field, previous: previous.value, next: next.value, runId, reason: "weaker-finding-retained-for-history" });
      continue;
    }

    current.push(next);
    changes.push({ field: next.field, previous: previous.value, next: next.value, runId, reason: "conflict-retained" });
    conflicts.push({ field: next.field, values: [previous.value, next.value], runId });
  }

  return { current, changes, conflicts };
}
