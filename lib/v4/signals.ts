export const hiringSignalTypes = [
  "funding",
  "product-launch",
  "dublin-office",
  "leadership-change",
  "partnership",
  "acquisition",
  "hiring-surge",
  "team-build-out",
] as const;

export type HiringSignalType = (typeof hiringSignalTypes)[number];
export type SignalReliability = "primary" | "secondary" | "directory" | "unknown";
export type SignalQaStatus = "unverified" | "corrected" | "suppressed" | "expired";

export type HiringSignalCandidate = {
  companyId: string;
  type: HiringSignalType;
  summary: string;
  eventDate: string | null;
  discoveredAt: string;
  sourceUrl: string;
  sourceReliability: SignalReliability;
  dublinConnection: boolean | null;
  functionRelevance: number;
  companyInterest: number;
  qaStatus?: Exclude<SignalQaStatus, "expired">;
};

export type HiringSignalScore = Omit<HiringSignalCandidate, "qaStatus"> & {
  relevanceScore: number;
  isRecent: boolean;
  expirationDate: string | null;
  isExpired: boolean;
  isSuppressed: boolean;
  qaStatus: SignalQaStatus;
  labels: string[];
  rationale: string[];
};

export function isHiringSignalType(value: unknown): value is HiringSignalType {
  return typeof value === "string" && (hiringSignalTypes as readonly string[]).includes(value);
}

export function isValidSignalDate(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function signalDatePart(value: string): string | null {
  if (isValidSignalDate(value)) return value;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !isValidSignalDate(value.slice(0, 10))) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) ? value.slice(0, 10) : null;
}

export function isValidSignalSourceUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export function canonicalSignalSourceUrl(value: string): string | null {
  if (!isValidSignalSourceUrl(value)) return null;
  const url = new URL(value);
  url.hash = "";
  return url.toString();
}

function dayValue(value: string): number | null {
  const day = signalDatePart(value);
  return day ? Date.parse(`${day}T00:00:00.000Z`) : null;
}

function daysBetween(from: string | null, to: string): number | null {
  if (!from || !isValidSignalDate(to)) return null;
  const start = dayValue(from);
  const end = dayValue(to);
  if (start === null || end === null) return null;
  return Math.floor((end - start) / 86_400_000);
}

function expirationDate(candidate: HiringSignalCandidate): string | null {
  const baseDay = candidate.eventDate && isValidSignalDate(candidate.eventDate)
    ? candidate.eventDate
    : signalDatePart(candidate.discoveredAt);
  if (!baseDay) return null;
  const base = Date.parse(`${baseDay}T00:00:00.000Z`);
  const days = candidate.type === "hiring-surge" || candidate.type === "team-build-out" ? 45 : candidate.type === "leadership-change" ? 90 : 180;
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

export const reliabilityRank: Record<SignalReliability, number> = { primary: 4, secondary: 3, directory: 2, unknown: 1 };

export function confidenceForReliability(reliability: SignalReliability): "high" | "medium" | "low" {
  if (reliability === "primary") return "high";
  if (reliability === "secondary") return "medium";
  return "low";
}

export function reliabilityFromConfidence(confidence: string): SignalReliability {
  if (confidence === "high") return "primary";
  if (confidence === "medium") return "secondary";
  return "unknown";
}

export function signalFingerprint(candidate: Pick<HiringSignalCandidate, "companyId" | "type" | "eventDate" | "summary">): string {
  const summary = candidate.summary.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return `${candidate.companyId}|${candidate.type}|${candidate.eventDate ?? "unknown"}|${summary}`;
}

export function scoreHiringSignal(candidate: HiringSignalCandidate, asOfDate: string): HiringSignalScore {
  const age = daysBetween(candidate.eventDate, asOfDate);
  const isFuture = age !== null && age < 0;
  const isRecent = age !== null && age >= 0 && age <= 30;
  const recency = age === null || isFuture ? 0 : age <= 7 ? 40 : age <= 30 ? 30 : age <= 90 ? 14 : 0;
  const dublin = candidate.dublinConnection === true ? 25 : 0;
  const functionPoints = Math.max(0, Math.min(20, candidate.functionRelevance / 5));
  const interestPoints = Math.max(0, Math.min(15, candidate.companyInterest / 6));
  const rawScore = Math.max(0, Math.min(100, Math.round(recency + dublin + functionPoints + interestPoints)));
  const expiry = expirationDate(candidate);
  const isExpired = expiry !== null && isValidSignalDate(asOfDate) && expiry < asOfDate;
  const isSuppressed = candidate.qaStatus === "suppressed";
  const qaStatus: SignalQaStatus = isSuppressed ? "suppressed" : isExpired ? "expired" : candidate.qaStatus === "corrected" ? "corrected" : "unverified";
  const labels = ["possible hiring signal", `source reliability ${candidate.sourceReliability}`, "source has not been independently verified"];
  if (isRecent) labels.push("recent");
  else if (isFuture) labels.push("event date is in the future");
  else if (age === null) labels.push("event date unknown");
  else labels.push("stale");
  if (candidate.dublinConnection === true) labels.push("Dublin connection reported; not independently verified");
  else if (candidate.dublinConnection === false) labels.push("non-Dublin or unverified local connection");
  else labels.push("Dublin connection unknown");
  if (qaStatus === "corrected") labels.push("user-corrected; source remains unverified");
  if (qaStatus === "suppressed") labels.push("suppressed by user");
  if (qaStatus === "expired") labels.push("signal expired");
  if (expiry === null) labels.push("expiry unknown");
  const rationale = [
    age === null ? "Event date is unknown or invalid." : isFuture ? "Event date is after the check date." : `Event was observed ${age} day${age === 1 ? "" : "s"} before the check date.`,
    candidate.dublinConnection === true ? "A Dublin connection was reported but not independently verified." : candidate.dublinConnection === false ? "No Dublin connection is evidenced." : "The Dublin connection is unknown.",
    `Function relevance contributes ${Math.round(functionPoints)} points.`,
    `Company interest contributes ${Math.round(interestPoints)} points.`,
    `Source reliability is recorded as ${candidate.sourceReliability} and has not been independently verified.`,
  ];
  if (isExpired) rationale.push("The signal is past its configured expiry date.");
  if (isSuppressed) rationale.push("The user suppressed this signal.");
  return {
    ...candidate,
    relevanceScore: isExpired || isSuppressed || isFuture ? 0 : rawScore,
    isRecent,
    expirationDate: expiry,
    isExpired,
    isSuppressed,
    qaStatus,
    labels,
    rationale,
  };
}

function preferredCandidate(candidate: HiringSignalCandidate, current: HiringSignalCandidate): boolean {
  const rankDifference = reliabilityRank[candidate.sourceReliability] - reliabilityRank[current.sourceReliability];
  if (rankDifference !== 0) return rankDifference > 0;
  const sourceDifference = Number(isValidSignalSourceUrl(candidate.sourceUrl)) - Number(isValidSignalSourceUrl(current.sourceUrl));
  if (sourceDifference !== 0) return sourceDifference > 0;
  return (dayValue(candidate.discoveredAt) ?? Number.NEGATIVE_INFINITY) > (dayValue(current.discoveredAt) ?? Number.NEGATIVE_INFINITY);
}

export function deduplicateSignals(candidates: HiringSignalCandidate[]): HiringSignalCandidate[] {
  const grouped = new Map<string, HiringSignalCandidate>();
  for (const candidate of candidates) {
    const key = signalFingerprint(candidate);
    const current = grouped.get(key);
    if (!current || preferredCandidate(candidate, current)) grouped.set(key, candidate);
  }
  return [...grouped.values()];
}
