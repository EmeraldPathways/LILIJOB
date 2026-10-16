import { and, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../db";
import { companies, jobs } from "../../db/schema";
import { jobSnapshots } from "../../db/schema-v4";
import { buildDocxExport, buildPdfExport } from "./documents";
import { createAgentRun, getDashboardSummary, updateAgentRun } from "./dashboard";
import { createInterview, createInterviewPackForInterview } from "./interview-repository";
import { rankAndPersistOpportunities } from "./opportunities";
import { buildApplicationPack } from "./packs";
import {
  createApplication,
  createApplicationPack,
  createExperienceEvidence,
  getApplication,
  getOrCreateCandidateProfile,
  updateApplicationStage,
} from "./repository";
import { executeAgentRun } from "./agent-runner";
import { getV4Job, persistDiscoveredJobs } from "./job-repository";

export type ReleaseSelfTestStepStatus = "passed" | "failed" | "skipped";

export type ReleaseSelfTestStep = {
  name: string;
  status: ReleaseSelfTestStepStatus;
  observed?: Record<string, unknown>;
  error?: string;
};

export type ReleaseSelfTestCleanup = {
  passed: boolean;
  attempted: boolean;
  deletedRows: number;
  remainingRows: number;
  tables: string[];
  error?: string;
  warning?: string;
};

export type ReleaseSelfTestResult = {
  ownerId: string;
  passed: boolean;
  steps: ReleaseSelfTestStep[];
  cleanup: ReleaseSelfTestCleanup;
};

type StepResult<T> = { value: T; observed: Record<string, unknown> };

type CleanupStatement = {
  run(): Promise<unknown>;
  all(): Promise<unknown>;
};

type CleanupD1Binding = {
  prepare(sql: string): { bind(...values: unknown[]): CleanupStatement };
  batch(statements: CleanupStatement[]): Promise<unknown[]>;
};

const STEP_NAMES = [
  "database_binding",
  "synthetic_company",
  "verified_job_snapshot",
  "candidate_evidence",
  "ranking",
  "application_owner_isolation",
  "deterministic_application_pack",
  "interview_and_pack",
  "dashboard_counts",
  "safe_agent_run",
  "document_exports",
] as const;

// Static whitelist of the tables this flow can write. Child records are deleted
// first, and every statement is bound to the generated synthetic owner ID.
const CLEANUP_TABLES = [
  "agent_steps",
  "agent_runs",
  "interview_packs",
  "interviews",
  "application_packs",
  "application_events",
  "applications",
  "job_matches",
  "experience_evidence",
  "candidate_profiles",
  "job_snapshots",
  "jobs",
  "sources",
  "companies",
] as const;

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "The self-test step failed.";
  return message.replace(/[\r\n\t]+/g, " ").slice(0, 300);
}

function countChanges(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const result = value as { changes?: unknown; meta?: { changes?: unknown } };
  const count = result.meta?.changes ?? result.changes;
  return typeof count === "number" && Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
}

async function countOwnerRows(statement: CleanupStatement): Promise<number> {
  const result = await statement.all() as { results?: Array<{ count?: unknown }> };
  const count = Number(result.results?.[0]?.count ?? 0);
  return Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
}

async function cleanupSyntheticOwner(binding: CleanupD1Binding, ownerId: string): Promise<ReleaseSelfTestCleanup> {
  let deletedRows = 0;
  let warning: string | undefined;
  const statements = CLEANUP_TABLES.map((table) => binding.prepare(`DELETE FROM ${table} WHERE owner_id = ?`).bind(ownerId));

  try {
    const results = await binding.batch(statements);
    deletedRows = results.reduce<number>((total, result) => total + countChanges(result), 0);
  } catch (error) {
    // A D1 batch is transactional. If it fails, make a best-effort owner-scoped
    // pass so an unsupported table cannot leave earlier synthetic rows behind.
    warning = `Batch cleanup failed; per-table cleanup was attempted: ${errorMessage(error)}`;
    for (const table of CLEANUP_TABLES) {
      try {
        deletedRows += countChanges(await binding.prepare(`DELETE FROM ${table} WHERE owner_id = ?`).bind(ownerId).run());
      } catch {
        // The final count/verification reports whether cleanup actually finished.
      }
    }
  }

  let remainingRows = 0;
  let verificationError: string | undefined;
  for (const table of CLEANUP_TABLES) {
    try {
      remainingRows += await countOwnerRows(binding.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE owner_id = ?`).bind(ownerId));
    } catch (error) {
      verificationError ??= errorMessage(error);
    }
  }

  return {
    passed: remainingRows === 0 && verificationError === undefined,
    attempted: true,
    deletedRows,
    remainingRows,
    tables: [...CLEANUP_TABLES],
    ...(warning ? { warning } : {}),
    ...(verificationError ? { error: `Could not verify cleanup: ${verificationError}` } : remainingRows ? { error: `${remainingRows} synthetic owner row(s) remain after cleanup.` } : {}),
  };
}

function skipUnrunSteps(steps: ReleaseSelfTestStep[]): void {
  const completedNames = new Set(steps.map((step) => step.name));
  for (const name of STEP_NAMES) {
    if (!completedNames.has(name)) steps.push({ name, status: "skipped", observed: { reason: "A preceding check failed." } });
  }
}

/**
 * Exercise the release-critical V4 persistence path against the configured D1
 * binding using a unique synthetic owner, then remove only that owner's rows.
 * No AI provider, external search, mail send, or application submission runs.
 */
export async function runReleaseSelfTest(): Promise<ReleaseSelfTestResult> {
  const ownerId = `release_validation_${crypto.randomUUID()}`;
  const steps: ReleaseSelfTestStep[] = [];
  const d1 = env.DB as unknown as CleanupD1Binding | undefined;
  let cleanup: ReleaseSelfTestCleanup = {
    passed: false,
    attempted: false,
    deletedRows: 0,
    remainingRows: 0,
    tables: [...CLEANUP_TABLES],
    error: "The configured D1 binding was unavailable; no synthetic rows were created.",
  };

  if (!d1) {
    steps.push({ name: "database_binding", status: "failed", error: "The configured D1 binding is unavailable." });
    skipUnrunSteps(steps);
    return { ownerId, passed: false, steps, cleanup };
  }

  async function runStep<T>(name: string, action: () => Promise<StepResult<T>>): Promise<T> {
    try {
      const result = await action();
      steps.push({ name, status: "passed", observed: result.observed });
      return result.value;
    } catch (error) {
      steps.push({ name, status: "failed", error: errorMessage(error) });
      throw error;
    }
  }

  try {
    const db = getDb();
    await runStep("database_binding", async () => {
      await db.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, ownerId)).limit(1);
      return { value: undefined, observed: { configured: true, provider: "D1" } };
    });

    const company = await runStep("synthetic_company", async () => {
      const timestamp = new Date().toISOString();
      const row = {
        id: `${ownerId}_company`,
        ownerId,
        name: "Synthetic Release Validation Company",
        normalizedName: "synthetic-release-validation-company",
        website: "https://release-validation.example",
        locality: "Dublin",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await db.insert(companies).values(row);
      return { value: row, observed: { created: true, synthetic: true, locality: row.locality } };
    });

    const fixtureUrl = "https://release-validation.example/careers/product-manager";
    const fixtureCheckedAt = new Date().toISOString();
    const job = await runStep("verified_job_snapshot", async () => {
      const persisted = await persistDiscoveredJobs(ownerId, company.id, {
        status: "supported",
        sourceUrl: "https://release-validation.example/careers",
        checkedAt: fixtureCheckedAt,
        jobs: [{
          externalId: `${ownerId}_job`,
          title: "Synthetic Product Manager Role",
          url: fixtureUrl,
          description: "Synthetic release validation fixture for product strategy and experimentation in a Dublin hybrid team.",
          location: "Dublin",
          workModel: "hybrid",
          employmentType: "Full-time",
          salary: null,
          postedAt: null,
          firstSeenAt: fixtureCheckedAt,
          lastConfirmedAt: fixtureCheckedAt,
          verified: true,
          sourceUrl: "https://release-validation.example/careers",
        }],
      });
      if (!persisted.found || persisted.jobsCreated !== 1 || persisted.snapshotsCreated !== 1) {
        throw new Error("The synthetic verified job and snapshot were not created.");
      }
      const [jobRow] = await db.select().from(jobs).where(and(eq(jobs.ownerId, ownerId), eq(jobs.companyId, company.id))).limit(1);
      if (!jobRow) throw new Error("The synthetic job could not be read back.");
      const saved = await getV4Job(ownerId, jobRow.id);
      const snapshot = saved?.snapshots[0];
      if (!snapshot || snapshot.state !== "current" || snapshot.extractionConfidence !== "high" || jobRow.confidence !== "high") {
        throw new Error("The synthetic job snapshot is not verified with high confidence.");
      }
      await db.update(jobSnapshots).set({ requirementsJson: JSON.stringify(["product strategy", "experimentation"]) })
        .where(and(eq(jobSnapshots.ownerId, ownerId), eq(jobSnapshots.id, snapshot.id)));
      return { value: { job: jobRow, snapshot: { ...snapshot, requirementsJson: JSON.stringify(["product strategy", "experimentation"]) } }, observed: { verified: true, jobConfidence: jobRow.confidence, snapshotState: snapshot.state, snapshotsCreated: persisted.snapshotsCreated } };
    });

    const candidate = await runStep("candidate_evidence", async () => {
      const profile = await getOrCreateCandidateProfile(ownerId, {
        name: "Synthetic release validation profile",
        targetFamilies: ["Product Manager"],
        constraints: { locations: ["Dublin"], workModels: ["hybrid"], skills: ["product strategy", "experimentation"] },
      });
      const evidence = await createExperienceEvidence(ownerId, profile.id, {
        title: "Synthetic release validation evidence",
        statement: "Synthetic fixture only: product strategy and experimentation details for release validation; not a candidate achievement.",
        approved: true,
      });
      if (!evidence?.approved) throw new Error("Approved synthetic candidate evidence was not persisted.");
      return { value: { profile, evidence }, observed: { profileCreated: true, evidenceApproved: evidence.approved, syntheticOnly: true } };
    });

    await runStep("ranking", async () => {
      const rows = await rankAndPersistOpportunities(ownerId, candidate.profile.id);
      const match = rows?.find((row) => row.job.id === job.job.id)?.match;
      if (!rows || rows.length !== 1 || !match) throw new Error("The synthetic job was not ranked and persisted.");
      return { value: match, observed: { matches: rows.length, score: match.score, confidence: match.confidence } };
    });

    const application = await runStep("application_owner_isolation", async () => {
      const created = await createApplication(ownerId, {
        companyId: company.id,
        jobId: job.job.id,
        title: job.job.title,
        manualUrl: job.job.url ?? fixtureUrl,
        dedupKey: `${ownerId}:${job.job.id}`,
        stage: "Target",
      });
      const moved = await updateApplicationStage(ownerId, created.record.id, "Applied", "Synthetic release validation stage change.");
      if (!moved || moved.stage !== "Applied") throw new Error("The synthetic application stage was not persisted.");
      const foreignOwnerLookup = await getApplication(`${ownerId}_other`, created.record.id);
      if (foreignOwnerLookup !== null) throw new Error("A different owner could read the synthetic application.");
      return { value: { application: moved, created: created.created }, observed: { stage: moved.stage, created: created.created, foreignOwnerLookup } };
    });

    await runStep("deterministic_application_pack", async () => {
      const requirements = JSON.parse(job.snapshot.requirementsJson) as string[];
      const payload = buildApplicationPack({
        jobTitle: job.job.title,
        companyName: company.name,
        requirements,
        jobSourceUrl: fixtureUrl,
        approvedEvidence: [{ id: candidate.evidence.id, statement: candidate.evidence.statement, metric: candidate.evidence.metric }],
        candidateSummary: "Synthetic release validation profile; no candidate facts.",
      });
      if (payload.generation.provider !== "rules") throw new Error("The application pack did not use deterministic generation.");
      const persisted = await createApplicationPack(ownerId, { applicationId: application.application.id, profileId: candidate.profile.id, sourceUrl: fixtureUrl, payload });
      if (!persisted) throw new Error("The synthetic application pack was not persisted.");
      return { value: { persisted, payload }, observed: { created: true, generation: payload.generation.provider, evidenceReferences: payload.evidenceReferences.length } };
    });

    await runStep("interview_and_pack", async () => {
      const created = await createInterview(ownerId, { applicationId: application.application.id, round: "Synthetic release validation" });
      if (!created) throw new Error("The synthetic interview was not created.");
      const pack = await createInterviewPackForInterview(ownerId, created.interview.id, {
        companyName: company.name,
        roleTitle: job.job.title,
        jobSourceUrl: fixtureUrl,
        checkedAt: job.snapshot.lastSeenAt.slice(0, 10),
        companyFacts: [],
        requirements: JSON.parse(job.snapshot.requirementsJson) as string[],
        approvedStories: [{ id: candidate.evidence.id, statement: candidate.evidence.statement }],
      });
      if (!pack) throw new Error("The synthetic interview preparation pack was not persisted.");
      const sections = JSON.parse(pack.sectionsJson) as { starStories?: Array<{ evidenceId: string }> };
      if (!sections.starStories?.some((story) => story.evidenceId === candidate.evidence.id)) {
        throw new Error("The interview pack did not retain its persisted approved evidence reference.");
      }
      return { value: { interview: created.interview, pack }, observed: { interviewCreated: true, packCreated: true, approvedStories: sections.starStories.length } };
    });

    await runStep("dashboard_counts", async () => {
      const summary = await getDashboardSummary(ownerId);
      if (summary.funnel.Applied !== 1) throw new Error("The dashboard did not count the synthetic Applied application.");
      return { value: summary, observed: { funnel: summary.funnel, scheduledInterviews: summary.cards.scheduledInterviews } };
    });

    await runStep("safe_agent_run", async () => {
      const run = await createAgentRun(ownerId, {
        request: "Read the release validation usage budget.",
        authorisedTools: ["get_usage_budget"],
        budget: { maxSearches: 0, maxTokens: 1_500, maxCostCents: 0, maxSteps: 1 },
      });
      if (!run) throw new Error("The synthetic agent run was not created.");
      await updateAgentRun(ownerId, run.run.id, {
        checkpoint: { version: 1, plan: [{ tool: "get_usage_budget", input: {} }], nextPlanIndex: 0, attempts: {} },
      });
      const completed = await executeAgentRun(ownerId, run.run.id);
      const step = completed?.steps[0];
      if (completed?.run.status !== "completed" || step?.status !== "completed" || step.tool !== "get_usage_budget") {
        throw new Error("The internal safe agent tool did not complete.");
      }
      return { value: completed, observed: { status: completed.run.status, tool: step.tool, externalActions: 0, searchUnits: 0 } };
    });

    await runStep("document_exports", async () => {
      const document = {
        title: "Synthetic release validation export",
        sections: [{ heading: "Verification", paragraphs: ["Synthetic release validation content only."] }],
      };
      const pdf = await buildPdfExport(document);
      const docx = await buildDocxExport(document);
      const pdfMagic = new TextDecoder().decode(pdf.subarray(0, 5)) === "%PDF-";
      const docxPrefix = new Uint8Array(await docx.arrayBuffer()).subarray(0, 4);
      const docxMagic = docxPrefix[0] === 0x50 && docxPrefix[1] === 0x4b && docxPrefix[2] === 0x03 && docxPrefix[3] === 0x04;
      if (!pdfMagic || !docxMagic) throw new Error("The generated document bytes have invalid PDF or DOCX signatures.");
      return { value: undefined, observed: { pdfMagic, docxMagic, pdfBytes: pdf.byteLength, docxBytes: docx.size } };
    });
  } catch {
    skipUnrunSteps(steps);
  } finally {
    cleanup = await cleanupSyntheticOwner(d1, ownerId);
  }

  return { ownerId, passed: steps.every((step) => step.status === "passed") && cleanup.passed, steps, cleanup };
}
