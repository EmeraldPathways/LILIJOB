import { and, asc, eq, gte, lte } from "drizzle-orm";
import { getDb } from "../../db";
import { applicationEvents, applications, companies } from "../../db/schema";
import { jobSearchMetricsDaily } from "../../db/schema-v4";

export type AnalyticsFilters = { from?: string; to?: string; channel?: string; sector?: string };

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null;
}

function sectorFromMetadata(metadataJson: string): string | null {
  try {
    const value = JSON.parse(metadataJson) as { sector?: unknown; original?: { Sector?: unknown } };
    return typeof value.sector === "string" ? value.sector : typeof value.original?.Sector === "string" ? value.original.Sector : null;
  } catch { return null; }
}

export async function getApplicationAnalytics(ownerId: string, filters: AnalyticsFilters = {}) {
  const db = getDb();
  const clauses = [eq(applications.ownerId, ownerId)];
  if (filters.from) clauses.push(gte(applications.createdAt, filters.from));
  if (filters.to) clauses.push(lte(applications.createdAt, filters.to));
  if (filters.channel?.trim()) clauses.push(eq(applications.channel, filters.channel.trim()));
  const rows = await db.select({ application: applications, companyMetadata: companies.metadataJson }).from(applications).innerJoin(companies, and(eq(companies.ownerId, ownerId), eq(companies.id, applications.companyId))).where(and(...clauses)).orderBy(asc(applications.createdAt)).limit(10_000);
  const filtered = filters.sector?.trim() ? rows.filter((row) => sectorFromMetadata(row.companyMetadata)?.toLowerCase() === filters.sector!.trim().toLowerCase()) : rows;
  const events = filtered.length ? await db.select().from(applicationEvents).where(and(eq(applicationEvents.ownerId, ownerId), gte(applicationEvents.eventAt, filters.from ?? "0000-01-01T00:00:00.000Z"), ...(filters.to ? [lte(applicationEvents.eventAt, filters.to)] : []))).limit(30_000) : [];
  const allowedIds = new Set(filtered.map((row) => row.application.id));
  const scopedEvents = events.filter((event) => allowedIds.has(event.applicationId));
  const stages: Record<string, number> = {};
  for (const row of filtered) stages[row.application.stage] = (stages[row.application.stage] ?? 0) + 1;
  const sent = scopedEvents.filter((event) => event.type === "outreach-sent" || event.type === "email-sent" || event.type === "stage-change" && event.stageTo === "Contacted").length;
  const responses = scopedEvents.filter((event) => ["reply-observed", "response", "interview-booked", "stage-change"].includes(event.type) && (event.type !== "stage-change" || ["Recruiter Call", "Interview", "Final Interview", "Offer"].includes(event.stageTo ?? ""))).length;
  const contactedDenominator = filtered.filter((row) => ["Contacted", "Applied", "Follow-up", "Recruiter Call", "Interview", "Final Interview", "Offer", "Rejected"].includes(row.application.stage)).length;
  const responseDenominator = Math.max(sent, contactedDenominator);
  const target = filtered.length;
  const transitions = scopedEvents.filter((event) => event.type === "stage-change").length;
  const sampleThreshold = 3;
  return {
    generatedAt: new Date().toISOString(),
    filters,
    sampleThreshold,
    sampleSize: filtered.length,
    insufficientSample: filtered.length < sampleThreshold,
    funnel: { target, stages, transitions },
    rates: {
      contactedFromTarget: ratio(contactedDenominator, target),
      responseRate: ratio(responses, responseDenominator),
      interviewRate: ratio(filtered.filter((row) => ["Interview", "Final Interview", "Offer"].includes(row.application.stage)).length, target),
      offerRate: ratio(filtered.filter((row) => row.application.stage === "Offer").length, target),
    },
    denominators: { target, contacted: contactedDenominator, response: responseDenominator, responses, interviews: filtered.filter((row) => ["Interview", "Final Interview", "Offer"].includes(row.application.stage)).length, offers: filtered.filter((row) => row.application.stage === "Offer").length },
    note: "These are descriptive observed rates from owner-scoped application records and immutable events. They do not establish causal effectiveness.",
  };
}

export async function persistDailyApplicationAnalytics(ownerId: string, at = new Date(), filters: AnalyticsFilters = {}) {
  const date = at.toISOString().slice(0, 10);
  const metrics = await getApplicationAnalytics(ownerId, filters);
  const now = at.toISOString();
  await getDb().insert(jobSearchMetricsDaily).values({ id: `metrics_${ownerId}_${date}`, ownerId, metricDate: date, countsJson: JSON.stringify(metrics), createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: [jobSearchMetricsDaily.ownerId, jobSearchMetricsDaily.metricDate], set: { countsJson: JSON.stringify(metrics), updatedAt: now } });
  const [saved] = await getDb().select().from(jobSearchMetricsDaily).where(and(eq(jobSearchMetricsDaily.ownerId, ownerId), eq(jobSearchMetricsDaily.metricDate, date))).limit(1);
  return saved ?? null;
}
