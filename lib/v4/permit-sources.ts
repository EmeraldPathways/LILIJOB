export const OFFICIAL_PERMIT_SOURCES = [
  'https://enterprise.gov.ie/en/what-we-do/workplace-and-skills/employment-permits/permit-types/critical-skills-employment-permit/',
  'https://enterprise.gov.ie/en/what-we-do/workplace-and-skills/employment-permits/employment-permit-eligibility/highly-skilled-eligible-occupations-list/',
  'https://enterprise.gov.ie/en/what-we-do/workplace-and-skills/economic-migration-policy/minimum-annual-remuneration/',
] as const;

export type PermitSourceCheck = { sourceUrl: string; checkedAt: string; status: 'retrieved' | 'unavailable'; contentHash: string; title: string | null; requiresRuleReview: true; error?: string };

/** Fetch success verifies source availability, never the interpretation or applicability of law. */
export async function checkPermitSources(fetcher: typeof fetch = fetch, now = new Date()): Promise<PermitSourceCheck[]> {
  return Promise.all(OFFICIAL_PERMIT_SOURCES.map(async (sourceUrl): Promise<PermitSourceCheck> => {
    const base = { sourceUrl, checkedAt: now.toISOString(), requiresRuleReview: true as const };
    try {
      const response = await fetcher(sourceUrl, { redirect: 'manual', signal: AbortSignal.timeout(12_000), headers: { accept: 'text/html' } });
      if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error(`Official source returned ${response.status}; review the source manually.`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Official source returned no content.');
      const decoder = new TextDecoder(); let html = ''; let size = 0;
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 2_000_000) { await reader.cancel(); throw new Error('Official source exceeds the safe size limit.'); }
        html += decoder.decode(value, { stream: true });
      }
      html += decoder.decode();
      if (html.length < 60) throw new Error('Official source content is incomplete.');
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html));
      return { ...base, status: 'retrieved', contentHash: Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join(''), title: html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? null };
    } catch (error) {
      return { ...base, status: 'unavailable', contentHash: '', title: null, error: error instanceof Error ? error.message : 'Source unavailable.' };
    }
  }));
}
