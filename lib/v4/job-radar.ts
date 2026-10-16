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
  return types.some((item) => typeof item === "string" && item.toLowerCase().split(/[/:]/).pop() === "jobposting") ? source : null;
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

type CareerAnchor = { title: string; url: string };

function isRoleDetailAnchor(title: string, urlValue: string): boolean {
  let url: URL;
  try { url = new URL(urlValue); } catch { return false; }
  if (!isSafePublicUrl(url.toString())) return false;
  const pathParts = url.pathname.toLowerCase().split("/").filter(Boolean);
  if (pathParts.some((part) => /^(about|company|team|people|contact|partners?|partnerships?|benefits|privacy|press|blog|news|locations?)$/.test(part))) return false;
  if (/\b(careers?|about us|our team|meet the team|contact|partners?|become a partner|view all|all jobs|open roles)\b/i.test(title)) return false;
  const roleWords = /\b(engineer|engineering|developer|scientist|analyst|manager|director|designer|consultant|recruiter|specialist|associate|architect|researcher|officer|executive|intern|accountant|lawyer|counsel|sales|operations|product|marketing|finance|security|data|customer success|growth|strategy|people|talent|lead|principal|head of|vice president|vp)\b/i;
  const titleIsRole = roleWords.test(title);
  const jobMarkerIndex = pathParts.findIndex((part) => /^(jobs?|roles?|positions?|vacancies|openings?)$/.test(part));
  const hasDetailPath = jobMarkerIndex >= 0 && pathParts.length > jobMarkerIndex + 1;
  const recognizedAts = /(^|\.)(greenhouse\.io|lever\.co)$/.test(url.hostname.toLowerCase());
  return (titleIsRole || hasDetailPath) && (!recognizedAts || hasDetailPath || titleIsRole);
}

function careerAnchors(html: string, sourceUrl: string): CareerAnchor[] {
  const anchors: CareerAnchor[] = [];
  const seen = new Set<string>();
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const title = stripHtml(match[2]);
    const url = absoluteUrl(match[1], sourceUrl);
    if (!title || !url || title.length < 3 || title.length > 180 || !isRoleDetailAnchor(title, url) || seen.has(url)) continue;
    seen.add(url);
    anchors.push({ title, url });
  }
  return anchors;
}

function extractAnchors(html: string, sourceUrl: string): DiscoveredJob[] {
  return careerAnchors(html, sourceUrl).slice(0, 3).map(({ title, url }) => ({
    externalId: null, title, url, description: null, location: null, workModel: null, employmentType: null, salary: null, postedAt: null,
    firstSeenAt: "", lastConfirmedAt: "", verified: false, sourceUrl,
  }));
}

export function candidateRoleUrlsFromCareerPage(html: string, sourceUrl: string, limit = 3): string[] {
  const boundedLimit = Math.max(0, Math.min(3, Math.floor(limit)));
  return careerAnchors(html, sourceUrl).slice(0, boundedLimit).map((anchor) => anchor.url);
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
    if (!isSafePublicUrl(url)) continue;
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
    const resolvedUrl = url ? absoluteUrl(url, sourceUrl) : null;
    if (!title || !resolvedUrl || !isSafePublicUrl(resolvedUrl)) return [];
    const location = job.location && typeof job.location === "object" ? stringValue((job.location as Record<string, unknown>).name) : stringValue(job.location);
    return [{
      externalId: identifierValue(job.id), title, url: resolvedUrl,
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
    const resolvedUrl = url ? absoluteUrl(url, sourceUrl) : null;
    if (!title || !resolvedUrl || !isSafePublicUrl(resolvedUrl)) return [];
    const location = job.categories && typeof job.categories === "object" ? stringValue((job.categories as Record<string, unknown>).location) : null;
    const commitment = job.categories && typeof job.categories === "object" ? stringValue((job.categories as Record<string, unknown>).commitment) : null;
    return [{
      externalId: stringValue(job.id), title, url: resolvedUrl,
      description: stripHtml(job.description), location, workModel: location?.toLowerCase().includes("remote") ? "remote" : location?.toLowerCase().includes("dublin") ? "hybrid-or-onsite" : null,
      employmentType: commitment, salary: null, postedAt: null, firstSeenAt: checkedAt, lastConfirmedAt: checkedAt, verified: true, sourceUrl,
    } satisfies DiscoveredJob];
  });
}

export function parseCareerFeed(value: unknown, sourceUrl: string, checkedAt = new Date().toISOString()): JobRadarResult {
  const host = (() => { try { return new URL(sourceUrl).hostname.toLowerCase(); } catch { return ""; } })();
  const jobs = host === "boards-api.greenhouse.io" ? parseGreenhouse(value, sourceUrl, checkedAt) : host === "api.lever.co" ? parseLever(value, sourceUrl, checkedAt) : [];
  return { status: jobs.length ? "supported" : "empty", jobs, sourceUrl, checkedAt };
}

export type OfficialPublicSourceStatus = "fetched" | "unsupported" | "source-blocked" | "stale" | "error";
export type OfficialPublicSourceResult = {
  status: OfficialPublicSourceStatus;
  sourceUrl: string;
  finalUrl: string;
  checkedAt: string;
  contentType: string | null;
  body?: string;
  error?: string;
};

const MAX_PUBLIC_SOURCE_BYTES = 256_000;
const PUBLIC_SOURCE_TIMEOUT_MS = 12_000;

async function readBodyWithinLimit(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error("Source response exceeded the 256 KB size limit.");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let body = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytesRead += chunk.value.byteLength;
    if (bytesRead > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Source response exceeded the 256 KB size limit.");
    }
    body += decoder.decode(chunk.value, { stream: true });
  }
  return body + decoder.decode();
}

function hostIsApproved(hostname: string, allowedHosts?: string[]): boolean {
  if (!allowedHosts?.length) return true;
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return allowedHosts.some((value) => {
    const approved = value.toLowerCase().replace(/^https?:\/\//, "").split(/[/:?#]/, 1)[0].replace(/\.$/, "");
    return Boolean(approved) && (host === approved || host.endsWith(`.${approved}`));
  });
}

/** Fetches one bounded public page and follows only safe redirects on approved hosts. */
export async function fetchOfficialPublicSource(
  sourceUrl: string,
  fetcher: (input: string, init?: RequestInit) => Promise<Response> = fetch,
  options: { checkedAt?: string; maxBytes?: number; timeoutMs?: number; allowedHosts?: string[] } = {},
): Promise<OfficialPublicSourceResult> {
  const checkedAt = options.checkedAt ?? new Date().toISOString();
  const maxBytes = Math.max(1, Math.min(MAX_PUBLIC_SOURCE_BYTES, Math.floor(options.maxBytes ?? MAX_PUBLIC_SOURCE_BYTES)));
  let initial: URL;
  try { initial = new URL(sourceUrl); } catch {
    return { status: "unsupported", sourceUrl, finalUrl: sourceUrl, checkedAt, contentType: null, error: "The source URL is invalid." };
  }
  if (!isSafePublicUrl(sourceUrl) || !hostIsApproved(initial.hostname, options.allowedHosts)) {
    return { status: "unsupported", sourceUrl, finalUrl: sourceUrl, checkedAt, contentType: null, error: "The source URL is not an approved safe public URL." };
  }

  try {
    let currentUrl = sourceUrl;
    const visited = new Set<string>();
    const signal = AbortSignal.timeout(Math.max(1, Math.min(PUBLIC_SOURCE_TIMEOUT_MS, options.timeoutMs ?? PUBLIC_SOURCE_TIMEOUT_MS)));
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      if (visited.has(currentUrl)) return { status: "stale", sourceUrl, finalUrl: currentUrl, checkedAt, contentType: null, error: "Source redirect loop detected." };
      visited.add(currentUrl);
      const response = await fetcher(currentUrl, { redirect: "manual", signal, headers: { accept: "text/html,application/xhtml+xml,application/json" } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        let redirectedUrl: string | null = null;
        try { redirectedUrl = location ? new URL(location, currentUrl).toString() : null; } catch { /* malformed redirect */ }
        let redirectedHost: string | null = null;
        try { redirectedHost = redirectedUrl ? new URL(redirectedUrl).hostname : null; } catch { /* malformed URL */ }
        if (!redirectedUrl || !isSafePublicUrl(redirectedUrl) || !redirectedHost || !hostIsApproved(redirectedHost, options.allowedHosts)) {
          return { status: "source-blocked", sourceUrl, finalUrl: currentUrl, checkedAt, contentType: null, error: "Source redirected outside the approved safe public hosts." };
        }
        if (redirects === 5) return { status: "stale", sourceUrl, finalUrl: currentUrl, checkedAt, contentType: null, error: "Source exceeded the safe redirect limit." };
        currentUrl = redirectedUrl;
        continue;
      }
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? null;
      if (response.status === 401 || response.status === 403) return { status: "source-blocked", sourceUrl, finalUrl: currentUrl, checkedAt, contentType, error: `Source returned ${response.status}.` };
      if (response.status === 429) return { status: "stale", sourceUrl, finalUrl: currentUrl, checkedAt, contentType, error: "Source rate-limited the request." };
      if (!response.ok) return { status: "error", sourceUrl, finalUrl: currentUrl, checkedAt, contentType, error: `Source returned ${response.status}.` };
      const body = await readBodyWithinLimit(response, maxBytes);
      return { status: "fetched", sourceUrl, finalUrl: currentUrl, checkedAt, contentType, body };
    }
    return { status: "stale", sourceUrl, finalUrl: currentUrl, checkedAt, contentType: null, error: "Source exceeded the safe redirect limit." };
  } catch (error) {
    return { status: "error", sourceUrl, finalUrl: sourceUrl, checkedAt, contentType: null, error: error instanceof Error ? error.message : "Public source could not be reached." };
  }
}

export function parseCareerSourceBody(body: string, contentType: string | null, sourceUrl: string, checkedAt = new Date().toISOString()): JobRadarResult {
  const isJson = contentType?.toLowerCase().includes("application/json") ?? false;
  if (isJson || /(?:greenhouse|lever)/i.test(sourceUrl)) {
    let parsed: unknown = null;
    try { parsed = JSON.parse(body); } catch { /* Some ATS pages use HTML at a URL containing the vendor name. */ }
    const feed = parseCareerFeed(parsed, sourceUrl, checkedAt);
    if (feed.jobs.length || isJson) return feed;
  }
  return parseCareerPage(body, sourceUrl, checkedAt);
}

type CareerPageOptions = { allowedHosts?: string[]; maxRolePages?: number };
export type FetchedCareerPage = { sourceUrl: string; contentType: string | null; body: string };
export type CareerPageDiscovery = { result: JobRadarResult; fetchedPages: FetchedCareerPage[] };

type EmbeddedBoard = { provider: "greenhouse" | "lever"; feedUrl: string };

function explicitEmbeddedBoard(html: string, sourceUrl: string): EmbeddedBoard | null {
  const pattern = /<(?:iframe|script)\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi;
  for (const match of html.matchAll(pattern)) {
    let url: URL;
    try { url = new URL(decodeHtml(match[2]), sourceUrl); } catch { continue; }
    if (!isSafePublicUrl(url.toString())) continue;
    if (url.hostname.toLowerCase() === "boards.greenhouse.io" && /^\/embed\/job_board(?:\/js)?\/?$/i.test(url.pathname)) {
      const board = url.searchParams.get("for")?.trim() ?? "";
      if (/^[a-z0-9_-]{1,100}$/i.test(board)) {
        return { provider: "greenhouse", feedUrl: `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true` };
      }
    }
    if (url.hostname.toLowerCase() === "jobs.lever.co") {
      const parts = url.pathname.split("/").filter(Boolean);
      const embedPath = parts.length === 2 && parts[1].toLowerCase() === "embed";
      const embedMode = parts.length === 1 && url.searchParams.get("mode")?.toLowerCase() === "embed";
      const board = embedPath ? parts[0] : embedMode ? parts[0] : "";
      if (/^[a-z0-9-]{1,100}$/i.test(board)) {
        return { provider: "lever", feedUrl: `https://api.lever.co/v0/postings/${encodeURIComponent(board)}?mode=json` };
      }
    }
  }
  return null;
}

function jobFeedFromValue(value: unknown, provider: EmbeddedBoard["provider"]): boolean {
  if (provider === "greenhouse") return Boolean(value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).jobs));
  return Array.isArray(value);
}

function safeApprovedHosts(urls: string[], allowedHosts: string[] = []): string[] {
  const hosts = new Set(allowedHosts);
  for (const value of urls) {
    try { hosts.add(new URL(value).hostname); } catch { /* Ignore malformed candidates. */ }
  }
  return [...hosts];
}

/** Fetches a saved career page and verifies only a small sample of explicit role links. */
export async function discoverOfficialCareerPageWithContent(
  sourceUrl: string,
  fetcher: (input: string, init?: RequestInit) => Promise<Response> = fetch,
  checkedAt = new Date().toISOString(),
  options: CareerPageOptions = {},
): Promise<CareerPageDiscovery> {
  const page = await fetchOfficialPublicSource(sourceUrl, fetcher, { checkedAt, allowedHosts: options.allowedHosts });
  if (page.status !== "fetched") return {
    result: { status: page.status, jobs: [], sourceUrl: page.finalUrl, checkedAt, error: page.error },
    fetchedPages: [],
  };
  const body = page.body ?? "";
  const basePage = { sourceUrl: page.finalUrl, contentType: page.contentType, body };
  const parsed = parseCareerSourceBody(body, page.contentType, page.finalUrl, checkedAt);
  const jsonSource = page.contentType?.toLowerCase().includes("application/json") ?? false;
  if (jsonSource) return { result: parsed, fetchedPages: [basePage] };

  const embedded = explicitEmbeddedBoard(body, page.finalUrl);
  if (embedded) {
    const feedPage = await fetchOfficialPublicSource(embedded.feedUrl, fetcher, {
      checkedAt,
      allowedHosts: [embedded.provider === "greenhouse" ? "boards-api.greenhouse.io" : "api.lever.co"],
    });
    if (feedPage.status === "fetched" && feedPage.body !== undefined) {
      try {
        const feedValue: unknown = JSON.parse(feedPage.body);
        if (jobFeedFromValue(feedValue, embedded.provider)) {
          const feed = parseCareerFeed(feedValue, feedPage.finalUrl, checkedAt);
          return { result: feed, fetchedPages: [basePage, { sourceUrl: feedPage.finalUrl, contentType: feedPage.contentType, body: feedPage.body }] };
        }
      } catch { /* A malformed board response falls back to the bounded role-page sample. */ }
    }
  }

  const candidateUrls = candidateRoleUrlsFromCareerPage(body, page.finalUrl, options.maxRolePages ?? 3);
  const baseResult = parseCareerPage(body, page.finalUrl, checkedAt);
  if (!candidateUrls.length) return {
    result: { ...baseResult, status: baseResult.status === "supported" ? "partial" : baseResult.status },
    fetchedPages: [basePage],
  };

  const jobsByUrl = new Map(baseResult.jobs.map((job) => [job.url, job]));
  for (const candidateUrl of candidateUrls) {
    const detailPage = await fetchOfficialPublicSource(candidateUrl, fetcher, {
      checkedAt,
      allowedHosts: safeApprovedHosts([candidateUrl], options.allowedHosts),
    });
    if (detailPage.status !== "fetched" || detailPage.body === undefined) continue;
    const detailResult = parseCareerSourceBody(detailPage.body, detailPage.contentType, detailPage.finalUrl, checkedAt);
    for (const job of detailResult.jobs) {
      if (job.verified && isSafePublicUrl(job.url)) jobsByUrl.set(job.url, job);
    }
  }
  const jobs = [...jobsByUrl.values()];
  return {
    result: { status: "partial", jobs, sourceUrl: page.finalUrl, checkedAt },
    fetchedPages: [basePage],
  };
}

export async function discoverOfficialCareerPage(
  sourceUrl: string,
  fetcher: (input: string, init?: RequestInit) => Promise<Response> = fetch,
  checkedAt = new Date().toISOString(),
  options: CareerPageOptions = {},
): Promise<JobRadarResult> {
  return (await discoverOfficialCareerPageWithContent(sourceUrl, fetcher, checkedAt, options)).result;
}
