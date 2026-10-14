import type {
  DublinLocality,
  NormalizedCompanyIdentity,
  RawCompanyIdentity,
} from "./types";

const DUBLIN_LOCALITY_PATTERNS: Array<{
  locality: DublinLocality;
  patterns: RegExp[];
}> = [
  {
    locality: "Fingal",
    patterns: [/\bfingal\b/i, /\bswords\b/i, /\bmalahide\b/i, /\bdonabate\b/i],
  },
  {
    locality: "South Dublin",
    patterns: [
      /\bsouth\s+dublin\b/i,
      /\btallaght\b/i,
      /\bclondalkin\b/i,
      /\bcitywest\b/i,
      /\blucan\b/i,
    ],
  },
  {
    locality: "Dún Laoghaire–Rathdown",
    patterns: [
      /\bd[uú]n\s+laoghaire\b/i,
      /\brathdown\b/i,
      /\bsandyford\b/i,
      /\bblackrock\b/i,
      /\bstillorgan\b/i,
      /\bdalkey\b/i,
      /\bleopardstown\b/i,
    ],
  },
];

const NON_IRISH_DUBLIN_MARKERS = [
  /\bcalifornia\b/i,
  /\bohio\b/i,
  /\bgeorgia\b/i,
  /\bunited\s+states\b/i,
  /\busa\b/i,
  /\bunited\s+kingdom\b/i,
  /\buk\b/i,
];

const OUTSIDE_COUNTY_DUBLIN_MARKERS = [
  /\bcork\b/i,
  /\bgalway\b/i,
  /\blimerick\b/i,
  /\bwaterford\b/i,
  /\bkilkenny\b/i,
  /\bsligo\b/i,
  /\bdonegal\b/i,
  /\bmaynooth\b/i,
  /\bmeath\b/i,
  /\bwicklow\b/i,
  /\btipperary\b/i,
];

function cleanText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeCompanyName(value: string): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(limited|ltd|llc|incorporated|inc)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the\s+/, "");
}

export function normalizeDomain(value?: string | null): string | null {
  if (!value?.trim()) return null;

  try {
    const candidate = /^https?:\/\//i.test(value.trim())
      ? value.trim()
      : `https://${value.trim()}`;
    const url = new URL(candidate);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!hostname.includes(".") || hostname.includes(" ")) return null;
    return hostname;
  } catch {
    return null;
  }
}

function normalizeAliases(value?: string | string[] | null): string[] {
  if (!value) return [];
  const values = Array.isArray(value) ? value : value.split(/[;|]/);
  return values.map(cleanText).filter(Boolean);
}

export function dedupeKey(identity: Pick<NormalizedCompanyIdentity, "domain" | "normalizedName">): string {
  return identity.domain
    ? `domain:${identity.domain}`
    : `name:${identity.normalizedName}`;
}

export function normalizeCompanyIdentity(
  input: RawCompanyIdentity,
): NormalizedCompanyIdentity {
  const name = cleanText(input.companyName);
  const normalizedName = normalizeCompanyName(name);
  const domain = normalizeDomain(input.website);
  const result = {
    name,
    normalizedName,
    domain,
    aliases: normalizeAliases(input.aliases),
    location: input.location ? cleanText(input.location) : null,
    dedupeKey: "",
    original: input,
  } satisfies Omit<NormalizedCompanyIdentity, "dedupeKey"> & {
    dedupeKey: string;
  };

  result.dedupeKey = dedupeKey(result);
  return result;
}

export function normalizeDublinLocality(value?: string | null): DublinLocality | null {
  if (!value?.trim() || NON_IRISH_DUBLIN_MARKERS.some((pattern) => pattern.test(value))) {
    return null;
  }

  for (const { locality, patterns } of DUBLIN_LOCALITY_PATTERNS) {
    if (patterns.some((pattern) => pattern.test(value))) return locality;
  }

  if (/\bdublin\b/i.test(value)) return "Dublin City";
  return null;
}

export function isCountyDublinLocation(value?: string | null): boolean {
  return normalizeDublinLocality(value) !== null;
}

export function isExplicitlyOutsideCountyDublin(value?: string | null): boolean {
  return Boolean(value?.trim()) && !isCountyDublinLocation(value) && OUTSIDE_COUNTY_DUBLIN_MARKERS.some((pattern) => pattern.test(value ?? ""));
}
