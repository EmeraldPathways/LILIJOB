export type JobRadarStatus = "supported" | "unsupported" | "source-blocked" | "empty" | "partial" | "stale" | "error";

export type DiscoveredJob = {
  externalId: string | null;
  title: string;
  url: string;
  description: string | null;
  location: string | null;
  workModel: string | null;
  employmentType: string | null;
  salary: string | null;
  postedAt: string | null;
  firstSeenAt: string;
  lastConfirmedAt: string;
  verified: boolean;
  sourceUrl: string;
};

export type JobRadarResult = {
  status: JobRadarStatus;
  jobs: DiscoveredJob[];
  sourceUrl: string;
  checkedAt: string;
  error?: string;
};

function decodeHtml(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function stripHtml(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = decodeHtml(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
  return clean || null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function identifierValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}

function locationValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const address = source.address && typeof source.address === "object" ? source.address as Record<string, unknown> : source;
  return [address.addressLocality, address.addressRegion, address.addressCountry]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(", ") || null;
}

function absoluteUrl(value: string | null, sourceUrl: string): string | null {
  if (!value) return null;
  try {
    return new URL(value, sourceUrl).toString();
  } catch {
    return null;
  }
}

function asPosting(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const type = source["@type"];
  const types = Array.isArray(type) ? type : [type];
  return types.some((item) => typeof item === "string" && item.toLowerCase() === "jobposting") ? source : null;
}

function postingsFromJson(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap((item) => postingsFromJson(item));
  if (!value || typeof value !== "object") return [];
  const direct = asPosting(value);
  if (direct) return [direct];
  const source = value as Record<string, unknown>;
  if (Array.isArray(source["@graph"])) return postingsFromJson(source["@graph"]);
  return [];
}

function extractJsonLd(html: string): Record<string, unknown>[] {
  const postings: Record<string, unknown>[] = [];
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    try {
      postings.push(...postingsFromJson(JSON.parse(match[1])));
    } catch {
      // A malformed JSON-LD block should not prevent other page evidence from being used.
    }
  }
  return postings;
}

function extractAnchors(html: string, sourceUrl: string): DiscoveredJob[] {
  const jobs: DiscoveredJob[] = [];
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const title = stripHtml(match[2]);
    const url = absoluteUrl(match[1], sourceUrl);
    if (!title || !url || title.length < 3 || title.length > 180) continue;
    const candidate = `${title} ${url}`.toLowerCase();
    if (!/(job|career|product|growth|marketing|manager|analyst|engineer|consultant|designer|lead)/.test(candidate)) continue;
    jobs.push({ externalId: null, title, url, description: null, location: null, workModel: null, employmentType: null, salary: null, postedAt: null, firstSeenAt: "", lastConfirmedAt: "", verified: false, sourceUrl });
  }
  return jobs;
}

export function isSafePublicUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return false;
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname === "metadata.google.internal") return false;
    const ipv4 = hostname.split(".").map(Number);
    if (ipv4.length === 4 && ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
      const [a, b, c] = ipv4;
      if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168) ) || (a === 192 && b === 0 && c === 2) || (a === 198 && (b === 18 || b === 19 || b === 51 && c === 100)) || (a === 203 && b === 0 && c === 113)) return false;
    }
    if (hostname.includes(":")) {
      const first = Number.parseInt(hostname.split(":")[0] || "0", 16);
      if (hostname === "::" || hostname === "::1" || (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00 || (first & 0xe000) !== 0x2000) return false;
      if (hostname.startsWith("::ffff:") && isSafePublicUrl(`http://${hostname.slice(7)}`) === false) return false;
    }
    if (/^[\d.]+$/.test(hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

export function parseCareerPage(html: string, sourceUrl: string, checkedAt = new Date().toISOString()): JobRadarResult {
  const jsonJobs = extractJsonLd(html);
  const jobs: DiscoveredJob[] = [];
  const seen = new Set<string>();
  for (const posting of jsonJobs) {
    const url = absoluteUrl(stringValue(posting.url), sourceUrl) ?? sourceUrl;
    const title = stringValue(posting.title);
    if (!title || seen.has(url)) continue;
    seen.add(url);
    const identifier = posting.identifier && typeof posting.identifier === "object" ? (posting.identifier as Record<string, unknown>).value : posting.identifier;
    const location = locationValue(posting.jobLocation);
    const workModel = stringValue(posting.jobLocationType)?.toLowerCase().includes("telecommute") ? "remote" : location?.toLowerCase().includes("dublin") ? "hybrid-or-onsite" : null;
    jobs.push({
      externalId: stringValue(identifier),
      title,
      url,
      description: stripHtml(posting.description),
      location,
      workModel,
      employmentType: stringValue(posting.employmentType),
      salary: posting.baseSalary && typeof posting.baseSalary === "object" ? JSON.stringify(posting.baseSalary) : null,
      postedAt: stringValue(posting.datePosted),
      firstSeenAt: checkedAt,
      lastConfirmedAt: checkedAt,
      verified: true,
      sourceUrl,
    });
  }

  if (!jobs.length) {
    for (const discovered of extractAnchors(html, sourceUrl)) {
      if (seen.has(discovered.url)) continue;
      seen.add(discovered.url);
      jobs.push({ ...discovered, firstSeenAt: checkedAt, lastConfirmedAt: checkedAt });
    }
  }
  return { status: jsonJobs.length && jobs.some((job) => job.verified) ? "supported" : jobs.length ? "partial" : "empty", jobs, sourceUrl, checkedAt };
}

function parseGreenhouse(value: unknown, sourceUrl: string, checkedAt: string): DiscoveredJob[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as Record<string, unknown>).jobs)) return [];
  return ((value as Record<string, unknown>).jobs as unknown[]).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const job = item as Record<string, unknown>;
    const title = stringValue(job.title);
    const url = stringValue(job.absolute_url) ?? stringValue(job.url);
    if (!title || !url) return [];
    const location = job.location && typeof job.location === "object" ? stringValue((job.location as Record<string, unknown>).name) : stringValue(job.location);
    return [{
      externalId: identifierValue(job.id), title, url: absoluteUrl(url, sourceUrl) ?? url,
      description: stripHtml(job.content), location, workModel: location?.toLowerCase().includes("remote") ? "remote" : location?.toLowerCase().includes("dublin") ? "hybrid-or-onsite" : null,
      employmentType: null, salary: null, postedAt: stringValue(job.updated_at) ?? stringValue(job.created_at), firstSeenAt: checkedAt, lastConfirmedAt: checkedAt, verified: true, sourceUrl,
    } satisfies DiscoveredJob];
  });
}

function parseLever(value: unknown, sourceUrl: string, checkedAt: string): DiscoveredJob[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const job = item as Record<string, unknown>;
    const title = stringValue(job.text);
    const url = stringValue(job.hostedUrl) ?? stringValue(job.applyUrl);
    if (!title || !url) return [];
    const location = job.categories && typeof job.categories === "object" ? stringValue((job.categories as Record<string, unknown>).location) : null;
    const commitment = job.categories && typeof job.categories === "object" ? stringValue((job.categories as Record<string, unknown>).commitment) : null;
    return [{
      externalId: stringValue(job.id), title, url: absoluteUrl(url, sourceUrl) ?? url,
      description: stripHtml(job.description), location, workModel: location?.toLowerCase().includes("remote") ? "remote" : location?.toLowerCase().includes("dublin") ? "hybrid-or-onsite" : null,
      employmentType: commitment, salary: null, postedAt: null, firstSeenAt: checkedAt, lastConfirmedAt: checkedAt, verified: true, sourceUrl,
    } satisfies DiscoveredJob];
  });
}

export function parseCareerFeed(value: unknown, sourceUrl: string, checkedAt = new Date().toISOString()): JobRadarResult {
  const host = (() => { try { return new URL(sourceUrl).hostname.toLowerCase(); } catch { return ""; } })();
  const jobs = host.includes("greenhouse") ? parseGreenhouse(value, sourceUrl, checkedAt) : host.includes("lever") ? parseLever(value, sourceUrl, checkedAt) : [];
  return { status: jobs.length ? "supported" : "empty", jobs, sourceUrl, checkedAt };
}

export async function discoverOfficialCareerPage(
  sourceUrl: string,
  fetcher: (input: string, init?: RequestInit) => Promise<Response> = fetch,
  checkedAt = new Date().toISOString(),
): Promise<JobRadarResult> {
  if (!isSafePublicUrl(sourceUrl)) return { status: "unsupported", jobs: [], sourceUrl, checkedAt, error: "The career URL is not a permitted public HTTP(S) URL." };
  try {
    let currentUrl = sourceUrl;
    const visited = new Set<string>();
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      if (visited.has(currentUrl)) return { status: "stale", jobs: [], sourceUrl: currentUrl, checkedAt, error: "Source redirect loop detected." };
      visited.add(currentUrl);
      const response = await fetcher(currentUrl, { redirect: "manual", headers: { accept: "text/html,application/xhtml+xml" } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        let redirectedUrl: string | null = null;
        try { redirectedUrl = location ? new URL(location, currentUrl).toString() : null; } catch { /* malformed location */ }
        if (!redirectedUrl || !isSafePublicUrl(redirectedUrl)) return { status: "source-blocked", jobs: [], sourceUrl: currentUrl, checkedAt, error: "Source redirected to a location that is not a safe public URL." };
        if (redirects === 5) return { status: "stale", jobs: [], sourceUrl: currentUrl, checkedAt, error: "Source exceeded the safe redirect limit." };
        currentUrl = redirectedUrl;
        continue;
      }
      if (response.status === 401 || response.status === 403) return { status: "source-blocked", jobs: [], sourceUrl: currentUrl, checkedAt, error: `Source returned ${response.status}.` };
      if (response.status === 429) return { status: "stale", jobs: [], sourceUrl: currentUrl, checkedAt, error: "Source rate-limited the request." };
      if (!response.ok) return { status: "error", jobs: [], sourceUrl: currentUrl, checkedAt, error: `Source returned ${response.status}.` };
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      const body = await response.text();
      if (contentType.includes("application/json") || /(?:greenhouse|lever)/i.test(currentUrl)) {
        let parsed: unknown = null;
        try { parsed = JSON.parse(body); } catch { /* Some ATS pages use HTML at a URL containing the vendor name. */ }
        const feed = parseCareerFeed(parsed, currentUrl, checkedAt);
        if (feed.jobs.length || contentType.includes("application/json")) return feed;
      }
      return parseCareerPage(body, currentUrl, checkedAt);
    }
    return { status: "stale", jobs: [], sourceUrl: currentUrl, checkedAt, error: "Source exceeded the safe redirect limit." };
  } catch (error) {
    return { status: "error", jobs: [], sourceUrl, checkedAt, error: error instanceof Error ? error.message : "Career source could not be reached." };
  }
}
