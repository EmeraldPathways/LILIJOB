import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { companies, sources } from "../../db/schema";
import { companySignals, permitEvaluations, permitRules, recruitmentContacts } from "../../db/schema-v4";
import { classifyContact, type ContactClassificationInput } from "./contacts";
import { canonicalSignalSourceUrl, confidenceForReliability, deduplicateSignals, isHiringSignalType, isValidSignalDate, isValidSignalSourceUrl, reliabilityFromConfidence, reliabilityRank, scoreHiringSignal, signalDatePart, signalFingerprint, type HiringSignalCandidate, type SignalReliability } from "./signals";
import { isValidIsoDate, type PermitEvaluation, type PermitEvaluationInput, type PermitRule, type PermitRuleProvenance, type PermitRuleRefresh } from "./permit";

function now(): string {
  return new Date().toISOString();
}

export async function listRecruitmentContacts(ownerId: string, companyId?: string) {
  const clauses = [eq(recruitmentContacts.ownerId, ownerId)];
  if (companyId) clauses.push(eq(recruitmentContacts.companyId, companyId));
  return getDb().select().from(recruitmentContacts).where(and(...clauses)).orderBy(asc(recruitmentContacts.companyId), asc(recruitmentContacts.name));
}

export async function createRecruitmentContact(ownerId: string, input: ContactClassificationInput & { companyId: string }) {
  const [company] = await getDb().select({ id: companies.id }).from(companies).where(and(eq(companies.ownerId, ownerId), eq(companies.id, input.companyId))).limit(1);
  if (!company) return null;
  const classified = classifyContact(input);
  const identity = classified.email
    ? eq(recruitmentContacts.email, classified.email)
    : input.linkedinUrl?.trim()
      ? eq(recruitmentContacts.linkedinUrl, input.linkedinUrl.trim())
      : eq(recruitmentContacts.id, "__no_existing_contact_identity__");
  const existing = await getDb().select().from(recruitmentContacts).where(and(
    eq(recruitmentContacts.ownerId, ownerId),
    eq(recruitmentContacts.companyId, input.companyId),
    identity,
  )).limit(1);
  if (existing[0]) return existing[0];
  const timestamp = now();
  const id = `recruitment_contact_${crypto.randomUUID()}`;
  await getDb().insert(recruitmentContacts).values({
    id,
    ownerId,
    companyId: input.companyId,
    name: input.name?.trim() || null,
    role: input.role?.trim() || null,
    department: input.department?.trim() || null,
    relevanceType: classified.type.includes("recruiter") || classified.type === "recruitment-specific" ? "recruiter" : classified.type.includes("hiring") ? "hiring-manager" : "unknown",
    email: classified.email,
    linkedinUrl: input.linkedinUrl?.trim() || null,
    sourceUrl: classified.sourceUrl,
    observedAt: input.observedAt ?? timestamp,
    verificationStatus: "unverified",
    contactType: classified.type,
    qualityScore: classified.qualityScore,
    doNotContact: false,
    correctionFlag: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const [created] = await getDb().select().from(recruitmentContacts).where(and(eq(recruitmentContacts.ownerId, ownerId), eq(recruitmentContacts.id, id))).limit(1);
  return created ?? null;
}

export async function updateRecruitmentContact(ownerId: string, contactId: string, input: { doNotContact?: boolean; correctionFlag?: boolean; verificationStatus?: string }) {
  const timestamp = now();
  const changed = await getDb().update(recruitmentContacts).set({
    ...(input.doNotContact === undefined ? {} : { doNotContact: input.doNotContact }),
    ...(input.correctionFlag === undefined ? {} : { correctionFlag: input.correctionFlag }),
    ...(input.verificationStatus === undefined ? {} : { verificationStatus: input.verificationStatus }),
    updatedAt: timestamp,
  }).where(and(eq(recruitmentContacts.ownerId, ownerId), eq(recruitmentContacts.id, contactId))).returning({ id: recruitmentContacts.id });
  if (!changed.length) return null;
  const [contact] = await getDb().select().from(recruitmentContacts).where(and(eq(recruitmentContacts.ownerId, ownerId), eq(recruitmentContacts.id, contactId))).limit(1);
  return contact ?? null;
}

export async function deleteRecruitmentContact(ownerId: string, contactId: string) {
  const deleted = await getDb().delete(recruitmentContacts).where(and(eq(recruitmentContacts.ownerId, ownerId), eq(recruitmentContacts.id, contactId))).returning({ id: recruitmentContacts.id });
  return deleted.length > 0;
}

export type HiringSignalCorrection = { summary?: string; eventDate?: string | null; sourceUrl?: string };
export type HiringSignalUpdate = { correction?: HiringSignalCorrection; suppressed?: boolean };

function parseStoredObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function normalizedQaStatus(value: string): "unverified" | "corrected" | "suppressed" | "suppressed-corrected" {
  if (value === "corrected" || value === "suppressed-corrected") return value;
  if (value === "suppressed") return "suppressed";
  // Legacy rows marked primary-source observations as "verified". That was not an actual verification.
  return "unverified";
}

function reliabilityFromProvider(provider: string | null, confidence: string): SignalReliability {
  const match = provider?.match(/^user-reported:(primary|secondary|directory|unknown)$/);
  return match ? match[1] as SignalReliability : reliabilityFromConfidence(confidence);
}

function isSignalSuppressed(status: string): boolean {
  return status === "suppressed" || status === "suppressed-corrected";
}

function isSignalCorrected(status: string): boolean {
  return status === "corrected" || status === "suppressed-corrected";
}

export async function listHiringSignals(ownerId: string, companyId?: string, asOfDate = new Date().toISOString().slice(0, 10)) {
  const clauses = [eq(companySignals.ownerId, ownerId)];
  if (companyId) clauses.push(eq(companySignals.companyId, companyId));
  const rows = await getDb().select({
    id: companySignals.id,
    ownerId: companySignals.ownerId,
    companyId: companySignals.companyId,
    type: companySignals.type,
    summary: companySignals.summary,
    eventDate: companySignals.eventDate,
    discoveredAt: companySignals.discoveredAt,
    sourceId: companySignals.sourceId,
    sourceUrl: sources.url,
    sourceTitle: sources.title,
    sourceProvider: sources.provider,
    sourceType: sources.sourceType,
    sourceStatus: sources.status,
    relevanceScore: companySignals.relevanceScore,
    confidence: companySignals.confidence,
    verifiedStatus: companySignals.verifiedStatus,
    expiresAt: companySignals.expiresAt,
    createdAt: companySignals.createdAt,
    updatedAt: companySignals.updatedAt,
  }).from(companySignals).leftJoin(sources, and(eq(sources.ownerId, companySignals.ownerId), eq(sources.id, companySignals.sourceId))).where(and(...clauses)).orderBy(desc(companySignals.discoveredAt));
  return rows.map((row) => {
    const storedStatus = normalizedQaStatus(row.verifiedStatus);
    const isSuppressed = isSignalSuppressed(storedStatus);
    const isExpired = Boolean(row.expiresAt && isValidIsoDate(row.expiresAt) && isValidIsoDate(asOfDate) && row.expiresAt < asOfDate);
    const qaStatus = isSuppressed ? "suppressed" : isExpired ? "expired" : isSignalCorrected(storedStatus) ? "corrected" : "unverified";
    return {
      ...row,
      verifiedStatus: storedStatus,
      qaStatus,
      isExpired,
      isSuppressed,
      sourceReliability: reliabilityFromProvider(row.sourceProvider, row.confidence),
      sourceVerificationStatus: "not-live-verified" as const,
      relevanceScore: isExpired || isSuppressed ? 0 : row.relevanceScore,
    };
  });
}

type SignalInput = HiringSignalCandidate & { sourceId?: string | null };

function validateSignalInput(input: SignalInput) {
  if (!input.companyId.trim() || !isHiringSignalType(input.type) || !input.summary.trim()) throw new Error("Invalid hiring signal content.");
  if (!isValidSignalSourceUrl(input.sourceUrl) || !canonicalSignalSourceUrl(input.sourceUrl)) throw new Error("Invalid hiring signal source URL.");
  if (!signalDatePart(input.discoveredAt) || (input.eventDate !== null && !isValidSignalDate(input.eventDate))) throw new Error("Invalid hiring signal date.");
  if (!Number.isFinite(input.functionRelevance) || input.functionRelevance < 0 || input.functionRelevance > 100 || !Number.isFinite(input.companyInterest) || input.companyInterest < 0 || input.companyInterest > 100) throw new Error("Invalid hiring signal score.");
  if (typeof input.sourceReliability !== "string" || !Object.hasOwn(reliabilityRank, input.sourceReliability) || (input.dublinConnection !== null && typeof input.dublinConnection !== "boolean")) throw new Error("Invalid hiring signal evidence.");
}

async function getSourceForSignal(ownerId: string, companyId: string, sourceUrl: string, summary: string, sourceReliability: SignalReliability, sourceId?: string | null): Promise<string> {
  const normalizedUrl = canonicalSignalSourceUrl(sourceUrl);
  if (!normalizedUrl) throw new Error("Invalid hiring signal source URL.");
  let source: { id: string; companyId: string | null; normalizedUrl: string } | undefined;
  if (sourceId) {
    const [record] = await getDb().select({ id: sources.id, companyId: sources.companyId, normalizedUrl: sources.normalizedUrl }).from(sources).where(and(eq(sources.ownerId, ownerId), eq(sources.id, sourceId))).limit(1);
    source = record;
    if (!source || source.normalizedUrl !== normalizedUrl || (source.companyId !== null && source.companyId !== companyId)) throw new Error("Signal source ID does not match the owner, company, and URL.");
  } else {
    const [record] = await getDb().select({ id: sources.id, companyId: sources.companyId, normalizedUrl: sources.normalizedUrl }).from(sources).where(and(eq(sources.ownerId, ownerId), eq(sources.normalizedUrl, normalizedUrl))).limit(1);
    source = record;
    if (source && source.companyId !== null && source.companyId !== companyId) throw new Error("Signal source URL belongs to a different company.");
  }
  if (source) return source.id;
  const timestamp = now();
  const id = `source_${crypto.randomUUID()}`;
  await getDb().insert(sources).values({
    id,
    ownerId,
    companyId,
    url: sourceUrl.trim(),
    normalizedUrl,
    title: "User-provided hiring signal source",
    snippet: summary.trim(),
    provider: `user-reported:${sourceReliability}`,
    sourceType: "hiring-signal",
    retrievedAt: null,
    checkedAt: null,
    status: "user-provided",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return id;
}

async function assertSignalSourceReference(ownerId: string, companyId: string, sourceUrl: string, sourceId?: string | null) {
  const normalizedUrl = canonicalSignalSourceUrl(sourceUrl);
  if (!normalizedUrl) throw new Error("Invalid hiring signal source URL.");
  if (sourceId) {
    const [source] = await getDb().select({ id: sources.id, companyId: sources.companyId, normalizedUrl: sources.normalizedUrl }).from(sources).where(and(eq(sources.ownerId, ownerId), eq(sources.id, sourceId))).limit(1);
    if (!source || source.normalizedUrl !== normalizedUrl || (source.companyId !== null && source.companyId !== companyId)) throw new Error("Signal source ID does not match the owner, company, and URL.");
    return;
  }
  const [source] = await getDb().select({ id: sources.id, companyId: sources.companyId }).from(sources).where(and(eq(sources.ownerId, ownerId), eq(sources.normalizedUrl, normalizedUrl))).limit(1);
  if (source && source.companyId !== null && source.companyId !== companyId) throw new Error("Signal source URL belongs to a different company.");
}

async function sourceReliabilityForSignal(ownerId: string, signal: typeof companySignals.$inferSelect): Promise<SignalReliability> {
  if (signal.sourceId) {
    const [source] = await getDb().select({ provider: sources.provider }).from(sources).where(and(eq(sources.ownerId, ownerId), eq(sources.id, signal.sourceId))).limit(1);
    return reliabilityFromProvider(source?.provider ?? null, signal.confidence);
  }
  return reliabilityFromConfidence(signal.confidence);
}

export async function createHiringSignal(ownerId: string, input: SignalInput) {
  validateSignalInput(input);
  const [company] = await getDb().select({ id: companies.id }).from(companies).where(and(eq(companies.ownerId, ownerId), eq(companies.id, input.companyId))).limit(1);
  if (!company) return null;
  await assertSignalSourceReference(ownerId, input.companyId, input.sourceUrl, input.sourceId);
  const candidate = deduplicateSignals([input])[0];
  const asOfDate = new Date().toISOString().slice(0, 10);
  const scored = scoreHiringSignal(candidate, asOfDate);
  const existingRows = await getDb().select().from(companySignals).where(and(eq(companySignals.ownerId, ownerId), eq(companySignals.companyId, input.companyId), eq(companySignals.type, input.type)));
  const existing = existingRows.find((row) => signalFingerprint({ companyId: row.companyId, type: row.type as HiringSignalCandidate["type"], eventDate: row.eventDate, summary: row.summary }) === signalFingerprint(candidate));
  if (existing) {
    const existingReliability = await sourceReliabilityForSignal(ownerId, existing);
    if (reliabilityRank[input.sourceReliability] <= reliabilityRank[existingReliability]) return existing;
    const sourceId = await getSourceForSignal(ownerId, input.companyId, input.sourceUrl, input.summary, input.sourceReliability, input.sourceId);
    const timestamp = now();
    const existingStatus = normalizedQaStatus(existing.verifiedStatus);
    const preserveCorrection = isSignalCorrected(existingStatus);
    await getDb().update(companySignals).set({
      summary: preserveCorrection ? existing.summary : input.summary.trim(),
      eventDate: preserveCorrection ? existing.eventDate : input.eventDate,
      discoveredAt: input.discoveredAt,
      sourceId,
      relevanceScore: scored.relevanceScore,
      confidence: confidenceForReliability(input.sourceReliability),
      verifiedStatus: existingStatus,
      expiresAt: preserveCorrection ? existing.expiresAt : scored.expirationDate,
      updatedAt: timestamp,
    }).where(and(eq(companySignals.ownerId, ownerId), eq(companySignals.id, existing.id)));
    const [updated] = await getDb().select().from(companySignals).where(and(eq(companySignals.ownerId, ownerId), eq(companySignals.id, existing.id))).limit(1);
    return updated ?? existing;
  }
  const sourceId = await getSourceForSignal(ownerId, input.companyId, input.sourceUrl, input.summary, input.sourceReliability, input.sourceId);
  const timestamp = now();
  const id = `signal_${crypto.randomUUID()}`;
  await getDb().insert(companySignals).values({
    id,
    ownerId,
    companyId: input.companyId,
    type: input.type,
    summary: input.summary.trim(),
    eventDate: input.eventDate,
    discoveredAt: input.discoveredAt,
    sourceId,
    relevanceScore: scored.relevanceScore,
    confidence: confidenceForReliability(input.sourceReliability),
    verifiedStatus: "unverified",
    expiresAt: scored.expirationDate,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const [created] = await getDb().select().from(companySignals).where(and(eq(companySignals.ownerId, ownerId), eq(companySignals.id, id))).limit(1);
  return created ?? null;
}

export async function updateHiringSignal(ownerId: string, signalId: string, input: HiringSignalUpdate) {
  if (!input.correction && input.suppressed === undefined) throw new Error("A signal correction or suppression change is required.");
  const [existing] = await getDb().select().from(companySignals).where(and(eq(companySignals.ownerId, ownerId), eq(companySignals.id, signalId))).limit(1);
  if (!existing) return null;
  const correction = input.correction;
  if (correction?.summary !== undefined && !correction.summary.trim()) throw new Error("Corrected summary cannot be empty.");
  if (correction?.eventDate !== undefined && correction.eventDate !== null && !isValidSignalDate(correction.eventDate)) throw new Error("Corrected event date is invalid.");
  if (correction?.sourceUrl !== undefined && !isValidSignalSourceUrl(correction.sourceUrl)) throw new Error("Corrected signal source URL is invalid.");
  if (correction && !Object.keys(correction).length) throw new Error("At least one correction field is required.");

  const previousStatus = normalizedQaStatus(existing.verifiedStatus);
  const wasCorrected = isSignalCorrected(previousStatus);
  const correctedSummary = correction?.summary?.trim() ?? existing.summary;
  const correctedEventDate = correction?.eventDate !== undefined ? correction.eventDate : existing.eventDate;
  const correctedSourceUrl = correction?.sourceUrl;
  const sourceId = correctedSourceUrl
    ? await getSourceForSignal(ownerId, existing.companyId, correctedSourceUrl, correctedSummary, "unknown", null)
    : existing.sourceId;
  const timestamp = now();
  const scoreCandidate: HiringSignalCandidate = {
    companyId: existing.companyId,
    type: isHiringSignalType(existing.type) ? existing.type : "funding",
    summary: correctedSummary,
    eventDate: correctedEventDate,
    discoveredAt: existing.discoveredAt,
    sourceUrl: correctedSourceUrl ?? "https://invalid.example/legacy",
    sourceReliability: reliabilityFromConfidence(existing.confidence),
    dublinConnection: null,
    functionRelevance: 0,
    companyInterest: 0,
  };
  const scored = scoreHiringSignal(scoreCandidate, timestamp.slice(0, 10));
  const isSuppressed = input.suppressed ?? isSignalSuppressed(previousStatus);
  const nextStatus = isSuppressed ? (wasCorrected || Boolean(correction) ? "suppressed-corrected" : "suppressed") : (wasCorrected || Boolean(correction) ? "corrected" : "unverified");
  await getDb().update(companySignals).set({
    ...(correction?.summary === undefined ? {} : { summary: correctedSummary }),
    ...(correction?.eventDate === undefined ? {} : { eventDate: correctedEventDate }),
    ...(correctedSourceUrl ? { sourceId } : {}),
    relevanceScore: scored.relevanceScore,
    expiresAt: scored.expirationDate,
    verifiedStatus: nextStatus,
    updatedAt: timestamp,
  }).where(and(eq(companySignals.ownerId, ownerId), eq(companySignals.id, signalId)));
  const [updated] = await getDb().select().from(companySignals).where(and(eq(companySignals.ownerId, ownerId), eq(companySignals.id, signalId))).limit(1);
  return updated ?? null;
}

export async function listPermitRules() {
  const rows = await getDb().select().from(permitRules).orderBy(desc(permitRules.effectiveFrom));
  return rows.map((row) => {
    const stored = parseStoredObject(row.rulesJson);
    const rawProvenance = stored.provenance && typeof stored.provenance === "object" && !Array.isArray(stored.provenance) ? stored.provenance as Record<string, unknown> : {};
    const reportedCheckDate = isValidIsoDate(rawProvenance.sourceCheckedAt) ? rawProvenance.sourceCheckedAt : null;
    const provenance: PermitRuleProvenance = {
      authority: typeof rawProvenance.authority === "string" && rawProvenance.authority.trim() ? rawProvenance.authority : null,
      title: typeof rawProvenance.title === "string" && rawProvenance.title.trim() ? rawProvenance.title : null,
      sourceCheckedAt: reportedCheckDate,
      sourceCheckBasis: reportedCheckDate ? "admin-reported" : "not-provided",
      verificationStatus: "not-live-verified",
    };
    const refresh: PermitRuleRefresh = { status: "manual-review-required", automated: false, liveVerificationPerformed: false, lastAttemptAt: null };
    const { checkedAt, ...rest } = row;
    return { ...rest, recordedAt: checkedAt, provenance, refresh };
  });
}

export async function createPermitRule(input: PermitRule) {
  const timestamp = now();
  const provenance = {
    authority: input.provenance?.authority?.trim() || null,
    title: input.provenance?.title?.trim() || null,
    sourceCheckedAt: isValidIsoDate(input.provenance?.sourceCheckedAt) ? input.provenance.sourceCheckedAt : null,
  };
  const inserted = await getDb().insert(permitRules).values({
    id: input.id,
    ruleSet: input.ruleSet,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
    sourceUrl: input.sourceUrl,
    title: input.ruleSet,
    rulesJson: JSON.stringify({ eligibleOccupations: input.eligibleOccupations, salaryThreshold: input.salaryThreshold, provenance }),
    checkedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  }).onConflictDoNothing().returning({ id: permitRules.id });
  if (!inserted.length) return null;
  const [rule] = await getDb().select().from(permitRules).where(eq(permitRules.id, input.id)).limit(1);
  if (!rule) return null;
  const [mapped] = (await listPermitRules()).filter((current) => current.id === input.id);
  return mapped ?? null;
}

export async function savePermitEvaluation(ownerId: string, input: PermitEvaluationInput & { companyId: string; jobId?: string | null }, result: PermitEvaluation) {
  const timestamp = now();
  const id = `permit_evaluation_${crypto.randomUUID()}`;
  await getDb().insert(permitEvaluations).values({
    id,
    ownerId,
    companyId: input.companyId,
    jobId: input.jobId ?? null,
    ruleId: result.ruleId,
    status: result.status,
    labelsJson: JSON.stringify(result.labels),
    inputsJson: JSON.stringify({
      ...input,
      ruleSnapshot: result.ruleId ? {
        ruleId: result.ruleId,
        ruleSet: result.ruleSet,
        effectiveFrom: result.ruleEffectiveFrom,
        effectiveTo: result.ruleEffectiveTo,
        sourceUrl: result.sourceUrl,
        provenance: result.provenance,
        refresh: result.refresh,
      } : null,
    }),
    explanation: result.explanation,
    sourceUrl: result.sourceUrl,
    evaluatedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return id;
}
