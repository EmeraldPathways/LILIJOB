import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import { notificationPreferences } from "../../db/schema-v4";
import { listSavedSearches } from "./saved-searches";

export type DigestCadence = {
  frequency: "daily" | "weekly";
  time: string;
  weekday: number;
};

export type NotificationPreferences = {
  timezone: string;
  digestEnabled: boolean;
  quietStart: string | null;
  quietEnd: string | null;
  cadence: DigestCadence;
  consent: boolean;
};

export type NotificationPreferencesInput = NotificationPreferences;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  timezone: "Europe/Dublin",
  digestEnabled: false,
  quietStart: null,
  quietEnd: null,
  cadence: { frequency: "daily", time: "09:00", weekday: 1 },
  consent: false,
};

function validClock(value: unknown): value is string {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function validTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function parseCadence(value: unknown): DigestCadence {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Choose a digest cadence and local time.");
  const raw = value as Record<string, unknown>;
  if (raw.frequency !== "daily" && raw.frequency !== "weekly") throw new Error("Digest cadence must be daily or weekly.");
  if (!validClock(raw.time)) throw new Error("Digest time must use 24-hour HH:MM format.");
  const weekday = raw.weekday === undefined ? 1 : raw.weekday;
  if (typeof weekday !== "number" || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new Error("Choose a weekday from Sunday to Saturday.");
  return { frequency: raw.frequency, time: raw.time, weekday };
}

function normalizeQuietTime(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (!validClock(value)) throw new Error("Quiet hours must use 24-hour HH:MM format.");
  return value;
}

function fromRow(row: typeof notificationPreferences.$inferSelect): NotificationPreferences {
  let cadence = DEFAULT_NOTIFICATION_PREFERENCES.cadence;
  try {
    cadence = parseCadence(JSON.parse(row.cadenceJson));
  } catch {
    // Corrupt or legacy cadence data falls back to the safe in-app default.
  }
  return {
    timezone: validTimezone(row.timezone) ? row.timezone : DEFAULT_NOTIFICATION_PREFERENCES.timezone,
    digestEnabled: Boolean(row.digestEnabled),
    quietStart: normalizeQuietTime(row.quietStart),
    quietEnd: normalizeQuietTime(row.quietEnd),
    cadence,
    consent: Boolean(row.consent),
  };
}

export function isWithinQuietHours(at: Date, timezone: string, quietStart: string | null | undefined, quietEnd: string | null | undefined): boolean {
  if (!quietStart || !quietEnd) return false;
  if (!validTimezone(timezone)) throw new Error("Choose a valid IANA timezone.");
  if (!validClock(quietStart) || !validClock(quietEnd) || quietStart === quietEnd) throw new Error("Quiet hours must be two different local times.");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  const localMinute = hour * 60 + minute;
  const [startHour, startMinute] = quietStart.split(":").map(Number);
  const [endHour, endMinute] = quietEnd.split(":").map(Number);
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  return start < end ? localMinute >= start && localMinute < end : localMinute >= start || localMinute < end;
}

export async function getNotificationPreferences(ownerId: string): Promise<NotificationPreferences> {
  const [row] = await getDb().select().from(notificationPreferences).where(eq(notificationPreferences.ownerId, ownerId)).limit(1);
  return row ? fromRow(row) : { ...DEFAULT_NOTIFICATION_PREFERENCES, cadence: { ...DEFAULT_NOTIFICATION_PREFERENCES.cadence } };
}

export async function saveNotificationPreferences(ownerId: string, input: NotificationPreferencesInput): Promise<NotificationPreferences> {
  if (!input || typeof input !== "object") throw new Error("Notification preferences must be an object.");
  if (!validTimezone(input.timezone)) throw new Error("Choose a valid IANA timezone.");
  if (typeof input.digestEnabled !== "boolean" || typeof input.consent !== "boolean") throw new Error("Digest opt-in and consent must be selected explicitly.");
  if (input.digestEnabled && !input.consent) throw new Error("Consent is required to opt in to the in-app digest.");
  const quietStart = normalizeQuietTime(input.quietStart);
  const quietEnd = normalizeQuietTime(input.quietEnd);
  if ((quietStart === null) !== (quietEnd === null)) throw new Error("Set both quiet-hours times or leave both empty.");
  if (quietStart && quietEnd && quietStart === quietEnd) throw new Error("Quiet hours must have different start and end times.");
  const cadence = parseCadence(input.cadence);
  const timestamp = new Date().toISOString();
  await getDb().insert(notificationPreferences).values({
    id: `notification_pref_${crypto.randomUUID()}`,
    ownerId,
    timezone: input.timezone,
    digestEnabled: input.digestEnabled,
    quietStart,
    quietEnd,
    cadenceJson: JSON.stringify(cadence),
    consent: input.consent,
    createdAt: timestamp,
    updatedAt: timestamp,
  }).onConflictDoUpdate({
    target: notificationPreferences.ownerId,
    set: {
      timezone: input.timezone,
      digestEnabled: input.digestEnabled,
      quietStart,
      quietEnd,
      cadenceJson: JSON.stringify(cadence),
      consent: input.consent,
      updatedAt: timestamp,
    },
  });
  return { timezone: input.timezone, digestEnabled: input.digestEnabled, quietStart, quietEnd, cadence, consent: input.consent };
}

export async function buildInternalDigest(ownerId: string, at = new Date()) {
  const preferences = await getNotificationPreferences(ownerId);
  const optedIn = preferences.digestEnabled && preferences.consent;
  const quietHoursActive = optedIn && isWithinQuietHours(at, preferences.timezone, preferences.quietStart, preferences.quietEnd);
  const searches = optedIn ? await listSavedSearches(ownerId) : [];
  const items = searches.map((search) => ({
    searchId: search.id,
    name: search.name,
    query: search.query,
    lastRunAt: search.lastRunAt,
    resultCount: search.lastRunResult?.totalCount ?? null,
  }));
  const withSavedResults = items.filter((item) => item.resultCount !== null).length;
  const savedMatches = items.reduce((total, item) => total + (item.resultCount ?? 0), 0);
  const status = !optedIn ? "opted-out" : quietHoursActive ? "quiet-hours-active" : "preview-ready";
  return {
    status,
    generatedAt: at.toISOString(),
    timezone: preferences.timezone,
    cadence: preferences.cadence,
    quietHoursActive,
    source: "saved-search-results" as const,
    summary: optedIn
      ? `${items.length} saved searches; ${savedMatches} matches in ${withSavedResults} most recent saved runs.`
      : "In-app digest is off until you opt in.",
    items,
    delivery: "This is an in-app preview. Nothing is sent outside the workspace.",
  };
}
