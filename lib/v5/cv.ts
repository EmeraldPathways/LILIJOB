import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../db";
import { applications } from "../../db/schema";
import { candidateDocuments, candidateProfiles, cvEditProposals, experienceEvidence, jobSnapshots } from "../../db/schema-v4";
import type { ExportDocument } from "../v4/documents";

type Evidence = { id: string; employer: string | null; project: string | null; title: string; statement: string; metric: string | null; roleRelevance: string | null };

export type TailoredCvPayload = {
  roleTitle: string;
  companyName: string;
  sourceUrl: string;
  summary: string;
  evidenceReferences: string[];
  sections: Array<{ heading: string; items?: string[]; paragraphs?: string[] }>;
  requirements: Array<{ requirement: string; evidenceIds: string[]; status: "supported" | "review" }>;
  atsChecks: { wordCount: number; hasRoleTitle: boolean; hasCompanyName: boolean; unsupportedNumericClaims: string[]; warnings: string[] };
  generationVersion: "v5-cv-1";
};

function parseJson(value: string | null | undefined, fallback: unknown): unknown {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function words(value: string): string[] { return value.trim().split(/\s+/).filter(Boolean); }

function safeText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function requirementsFromSnapshot(row: typeof jobSnapshots.$inferSelect | undefined): string[] {
  const parsed = parseJson(row?.requirementsJson, []);
  return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim()).slice(0, 40) : [];
}

function requirementTokens(value: string): string[] { return value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2); }

function evidenceMatches(requirement: string, evidence: Evidence): boolean {
  const haystack = `${evidence.title} ${evidence.statement} ${evidence.metric ?? ""} ${evidence.roleRelevance ?? ""}`.toLowerCase();
  return requirementTokens(requirement).some((token) => haystack.includes(token));
}

function numericClaims(value: string): string[] { return value.match(/\b\d+(?:\.\d+)?%?\b/g) ?? []; }

function buildPayload(input: { roleTitle: string; companyName: string; sourceUrl: string; requirements: string[]; profile: typeof candidateProfiles.$inferSelect; evidence: Evidence[] }): TailoredCvPayload {
  const roleTitle = input.roleTitle.trim();
  const companyName = input.companyName.trim();
  const evidence = input.evidence.filter((item) => item.statement.trim());
  const evidenceItems = evidence.map((item) => `${item.title}: ${item.statement}${item.metric ? ` (${item.metric})` : ""}`);
  const requirements = input.requirements.map((requirement) => {
    const ids = evidence.filter((item) => evidenceMatches(requirement, item)).map((item) => item.id);
    return { requirement, evidenceIds: ids, status: ids.length ? "supported" as const : "review" as const };
  });
  const targetFamilies = parseJson(input.profile.targetFamiliesJson, []);
  const familyText = Array.isArray(targetFamilies) ? targetFamilies.filter((item): item is string => typeof item === "string").join(", ") : "";
  const summary = `${familyText ? `Targeting ${familyText}. ` : ""}${evidence.length ? `Evidence-backed experience includes ${evidence.slice(0, 2).map((item) => item.statement).join(" ")}` : "Add approved experience evidence before using this CV."}`.trim();
  const sections = [
    { heading: "Professional summary", paragraphs: [summary] },
    { heading: "Selected experience", items: evidenceItems.length ? evidenceItems : ["No approved experience evidence is available; review this section before use."] },
    { heading: "Role alignment", items: requirements.length ? requirements.map((item) => `${item.status === "supported" ? "Supported" : "Review needed"}: ${item.requirement}`) : ["No role requirements were supplied; compare this CV with the published role before use."] },
    { heading: "Review record", items: [`Source: ${input.sourceUrl}`, `Approved evidence references: ${evidence.map((item) => item.id).join(", ") || "none"}`] },
  ];
  const allText = [summary, ...sections.flatMap((section) => [...(section.paragraphs ?? []), ...(section.items ?? [])])].join(" ");
  const allowedNumbers = new Set(evidence.flatMap((item) => numericClaims(`${item.statement} ${item.metric ?? ""}`)));
  const unsupportedNumericClaims = numericClaims(allText).filter((value) => !allowedNumbers.has(value));
  const warnings = requirements.filter((item) => item.status === "review").map((item) => `No approved evidence matched: ${item.requirement}`);
  return {
    roleTitle,
    companyName,
    sourceUrl: input.sourceUrl,
    summary,
    evidenceReferences: evidence.map((item) => item.id),
    sections,
    requirements,
    atsChecks: {
      wordCount: words(allText).length,
      hasRoleTitle: allText.toLowerCase().includes(roleTitle.toLowerCase()),
      hasCompanyName: allText.toLowerCase().includes(companyName.toLowerCase()),
      unsupportedNumericClaims: [...new Set(unsupportedNumericClaims)],
      warnings,
    },
    generationVersion: "v5-cv-1",
  };
}

export function validateTailoredCv(payload: TailoredCvPayload): string[] {
  const errors: string[] = [];
  if (!payload.roleTitle.trim() || !payload.companyName.trim()) errors.push("A role and company are required.");
  if (!/^https?:\/\//.test(payload.sourceUrl)) errors.push("A published role source URL is required.");
  if (payload.atsChecks.unsupportedNumericClaims.length) errors.push("The CV contains numeric claims without approved evidence.");
  if (!payload.evidenceReferences.length) errors.push("At least one approved evidence item is required for a complete tailored CV.");
  return errors;
}

export function tailoredCvExportDocument(payload: TailoredCvPayload): ExportDocument {
  return {
    title: `${payload.roleTitle} CV`,
    subtitle: `${payload.companyName} · Evidence-backed tailored version`,
    sections: payload.sections,
    footer: `Source: ${payload.sourceUrl} · Version ${payload.generationVersion} · Review warnings: ${payload.atsChecks.warnings.length || "none"}`,
  };
}

function withPayload(row: typeof cvEditProposals.$inferSelect) {
  return { ...row, payload: parseJson(row.changesJson, {}) as TailoredCvPayload, warnings: parseJson(row.warningsJson, []) as string[] };
}

export async function getCvProposal(ownerId: string, proposalId: string) {
  const [row] = await getDb().select().from(cvEditProposals).where(and(eq(cvEditProposals.ownerId, ownerId), eq(cvEditProposals.id, proposalId))).limit(1);
  return row ? withPayload(row) : null;
}

export async function listCvProposals(ownerId: string, profileId?: string) {
  const clauses = [eq(cvEditProposals.ownerId, ownerId)];
  if (profileId) clauses.push(eq(cvEditProposals.profileId, profileId));
  const rows = await getDb().select().from(cvEditProposals).where(and(...clauses)).orderBy(desc(cvEditProposals.updatedAt));
  return rows.map(withPayload);
}

export async function createCvProposal(ownerId: string, input: { profileId: string; masterDocumentId: string; jobSnapshotId?: string | null; applicationId?: string | null; roleTitle: string; companyName: string; sourceUrl: string; requirements?: string[] }) {
  const db = getDb();
  const [profile] = await db.select().from(candidateProfiles).where(and(eq(candidateProfiles.ownerId, ownerId), eq(candidateProfiles.id, input.profileId))).limit(1);
  if (!profile) return null;
  const [master] = await db.select().from(candidateDocuments).where(and(eq(candidateDocuments.ownerId, ownerId), eq(candidateDocuments.id, input.masterDocumentId), eq(candidateDocuments.profileId, input.profileId))).limit(1);
  if (!master) throw new Error("The master CV document is unavailable to this owner.");
  if (!/master-cv/i.test(master.type)) throw new Error("Choose a master CV document for tailoring.");
  let snapshot: typeof jobSnapshots.$inferSelect | undefined;
  if (input.jobSnapshotId) {
    [snapshot] = await db.select().from(jobSnapshots).where(and(eq(jobSnapshots.ownerId, ownerId), eq(jobSnapshots.id, input.jobSnapshotId))).limit(1);
    if (!snapshot) throw new Error("The job snapshot is unavailable to this owner.");
  }
  if (input.applicationId) {
    const [application] = await db.select({ id: applications.id }).from(applications).where(and(eq(applications.ownerId, ownerId), eq(applications.id, input.applicationId))).limit(1);
    if (!application) throw new Error("The application is unavailable to this owner.");
  }
  const evidence = await db.select({ id: experienceEvidence.id, employer: experienceEvidence.employer, project: experienceEvidence.project, title: experienceEvidence.title, statement: experienceEvidence.statement, metric: experienceEvidence.metric, roleRelevance: experienceEvidence.roleRelevance }).from(experienceEvidence).where(and(eq(experienceEvidence.ownerId, ownerId), eq(experienceEvidence.profileId, input.profileId), eq(experienceEvidence.approved, true))).orderBy(desc(experienceEvidence.updatedAt));
  const payload = buildPayload({ profile, evidence, roleTitle: safeText(input.roleTitle, snapshot?.jobId ?? "Target role"), companyName: safeText(input.companyName, "Target company"), sourceUrl: input.sourceUrl.trim(), requirements: input.requirements?.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()).slice(0, 40) ?? requirementsFromSnapshot(snapshot) });
  const errors = validateTailoredCv(payload);
  if (errors.length) throw new Error(errors.join(" "));
  const [last] = await db.select({ proposalVersion: cvEditProposals.proposalVersion }).from(cvEditProposals).where(and(eq(cvEditProposals.ownerId, ownerId), eq(cvEditProposals.profileId, input.profileId), eq(cvEditProposals.masterDocumentId, input.masterDocumentId))).orderBy(desc(cvEditProposals.proposalVersion)).limit(1);
  const now = new Date().toISOString();
  const id = `cv_proposal_${crypto.randomUUID()}`;
  await db.insert(cvEditProposals).values({ id, ownerId, applicationId: input.applicationId ?? null, profileId: input.profileId, masterDocumentId: input.masterDocumentId, jobSnapshotId: input.jobSnapshotId ?? null, baseProfileVersion: profile.approvedVersion, proposalVersion: (last?.proposalVersion ?? 0) + 1, status: "draft", changesJson: JSON.stringify(payload), warningsJson: JSON.stringify(payload.atsChecks.warnings), artifactDocumentId: null, createdAt: now, updatedAt: now });
  const created = await getCvProposal(ownerId, id);
  if (!created) throw new Error("Tailored CV proposal was not persisted.");
  return created;
}

export async function updateCvProposal(ownerId: string, proposalId: string, payload: TailoredCvPayload, status: "draft" | "review" | "approved" = "review") {
  const current = await getCvProposal(ownerId, proposalId);
  if (!current) return null;
  const errors = validateTailoredCv(payload);
  if (errors.length) throw new Error(errors.join(" "));
  await getDb().update(cvEditProposals).set({ changesJson: JSON.stringify(payload), warningsJson: JSON.stringify(payload.atsChecks.warnings), status, updatedAt: new Date().toISOString() }).where(and(eq(cvEditProposals.ownerId, ownerId), eq(cvEditProposals.id, proposalId), inArray(cvEditProposals.status, ["draft", "review"])));
  return getCvProposal(ownerId, proposalId);
}

export async function approveCvProposal(ownerId: string, proposalId: string, artifactDocumentId: string) {
  const current = await getCvProposal(ownerId, proposalId);
  if (!current) return null;
  if (!["draft", "review"].includes(current.status)) return current;
  const changed = await getDb().update(cvEditProposals).set({ status: "approved", artifactDocumentId, updatedAt: new Date().toISOString() }).where(and(eq(cvEditProposals.ownerId, ownerId), eq(cvEditProposals.id, proposalId), eq(cvEditProposals.status, current.status))).returning({ id: cvEditProposals.id });
  return changed.length ? getCvProposal(ownerId, proposalId) : getCvProposal(ownerId, proposalId);
}
