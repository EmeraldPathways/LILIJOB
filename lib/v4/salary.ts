export type PublishedSalary = {
  min: number;
  max: number;
  currency: string | null;
  period: "year" | "month" | "week" | "day" | "hour" | "unknown";
  original: string;
};

const numberPattern = /\d[\d,]*(?:\.\d+)?\s*[kKmM]?/g;

function toNumber(value: string): number {
  const compact = value.replace(/,/g, "").replace(/\s/g, "").toLowerCase();
  const multiplier = compact.endsWith("k") ? 1_000 : compact.endsWith("m") ? 1_000_000 : 1;
  return Number.parseFloat(compact.replace(/[km]$/, "")) * multiplier;
}

function periodOf(value: string): PublishedSalary["period"] {
  if (/\b(hour|hourly|hr)\b/i.test(value)) return "hour";
  if (/\b(day|daily)\b/i.test(value)) return "day";
  if (/\b(week|weekly)\b/i.test(value)) return "week";
  if (/\b(month|monthly)\b/i.test(value)) return "month";
  if (/\b(year|yearly|annual|annum|pa)\b/i.test(value)) return "year";
  return "unknown";
}

export function parsePublishedSalary(payRange: string | null | undefined, currency: string | null | undefined): PublishedSalary | null {
  const original = payRange?.trim();
  if (!original) return null;
  const values = [...original.matchAll(numberPattern)].map((match) => toNumber(match[0])).filter((value) => Number.isFinite(value) && value >= 0);
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min, max, currency: currency?.trim() || null, period: periodOf(original), original };
}
