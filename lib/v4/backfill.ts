import { and, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { companies, contacts, jobs, sources } from "../../db/schema";
import { jobSnapshots, recruitmentContacts } from "../../db/schema-v4";

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function contactType(email: string | null): string {
  const local = email?.split("@", 1)[0]?.toLowerCase() ?? "";
  if (["sales", "business", "partnerships"].includes(local)) return "sales";
  if (["info", "contact", "hello", "office", "admin"].includes(local)) return "general-business";
  if (["hr", "careers", "jobs", "recruitment", "talent"].includes(local)) return "generic-hr";
  return email ? "public-email" : "unknown";
}

export type V4BackfillResult = {
  companiesLinked: number;
  sourceLinksObserved: number;
  jobSnapshotsCreated: number;
  recruitmentContactsCreated: number;
};

/**
 * Links the legacy research records into the new model without altering or
 * deleting the source tables. Re-running uses stable legacy IDs and hashes.
 */
export async function backfillV4ExistingData(ownerId: string): Promise<V4BackfillResult> {
  const db = getDb();
  const [companyRows, jobRows, contactRows, sourceRows] = await Promise.all([
    db.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, ownerId)),
    db.select().from(jobs).where(eq(jobs.ownerId, ownerId)),
    db.select().from(contacts).where(eq(contacts.ownerId, ownerId)),
    db.select().from(sources).where(eq(sources.ownerId, ownerId)),
  ]);
  const sourceById = new Map(sourceRows.map((source) => [source.id, source]));
  const timestamp = new Date().toISOString();
  let sourceLinksObserved = 0;
  let jobSnapshotsCreated = 0;
  let recruitmentContactsCreated = 0;

  for (const job of jobRows) {
    const source = job.sourceId ? sourceById.get(job.sourceId) : undefined;
    if (source) sourceLinksObserved += 1;
    const snapshotInput = JSON.stringify({ title: job.title, url: job.url, location: job.location, salary: job.salary, status: job.status, source: source?.snippet ?? null });
    const contentHash = await sha256(snapshotInput);
    const [existing] = await db.select({ id: jobSnapshots.id }).from(jobSnapshots).where(and(
      eq(jobSnapshots.ownerId, ownerId),
      eq(jobSnapshots.jobId, job.id),
      eq(jobSnapshots.contentHash, contentHash),
    )).limit(1);
    if (existing) continue;
    await db.insert(jobSnapshots).values({
      id: `legacy_snapshot_${job.id}_${contentHash.slice(0, 12)}`,
      ownerId,
      jobId: job.id,
      contentHash,
      description: source?.snippet ?? null,
      payRange: job.salary,
      currency: null,
      requirementsJson: "[]",
      function: null,
      seniority: null,
      location: job.location,
      workModel: null,
      postedAt: job.postedAt,
      firstSeenAt: job.createdAt ?? timestamp,
      lastSeenAt: job.updatedAt ?? timestamp,
      sourceId: job.sourceId,
      state: job.status === "closed" ? "removed" : "current",
      diffJson: "{}",
      extractionConfidence: source?.snippet ? "medium" : "low",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    jobSnapshotsCreated += 1;
  }

  for (const contact of contactRows) {
    if (contact.sourceId) sourceLinksObserved += 1;
    const id = `legacy_contact_${contact.id}`;
    const [existing] = await db.select({ id: recruitmentContacts.id }).from(recruitmentContacts).where(and(
      eq(recruitmentContacts.ownerId, ownerId),
      eq(recruitmentContacts.id, id),
    )).limit(1);
    if (existing) continue;
    const source = contact.sourceId ? sourceById.get(contact.sourceId) : undefined;
    const relevant = /recruit|talent|people|hiring/i.test(contact.role ?? "") ? "recruiter" : "unknown";
    await db.insert(recruitmentContacts).values({
      id,
      ownerId,
      companyId: contact.companyId,
      name: contact.name,
      role: contact.role,
      department: null,
      relevanceType: relevant,
      email: contact.email,
      linkedinUrl: contact.linkedinUrl,
      sourceUrl: source?.url ?? null,
      observedAt: contact.updatedAt ?? timestamp,
      verificationStatus: contact.confidence === "high" ? "verified" : "unverified",
      contactType: contactType(contact.email),
      qualityScore: contact.confidence === "high" ? 80 : contact.confidence === "medium" ? 60 : 35,
      doNotContact: false,
      correctionFlag: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    recruitmentContactsCreated += 1;
  }

  return { companiesLinked: companyRows.length, sourceLinksObserved, jobSnapshotsCreated, recruitmentContactsCreated };
}
