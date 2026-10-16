import { describe, expect, it } from 'vitest';
import { checkPermitSources } from '../../lib/v4/permit-sources';

describe('official permit source checks', () => {
  it('captures hashes and dates without treating fetch success as rule approval', async () => {
    const results = await checkPermitSources(async () => new Response('<html><title>Critical skills</title><p>Eligibility requirements and remuneration thresholds</p></html>', { headers: { 'content-type': 'text/html' } }), new Date('2026-10-15T12:00:00Z'));
    expect(results.length).toBe(3);
    expect(results.every(r => r.status === 'retrieved' && r.checkedAt === '2026-10-15T12:00:00.000Z' && r.contentHash.length === 64 && r.requiresRuleReview)).toBe(true);
  });
  it('records blocked and redirected sources without accepting unrelated content', async () => {
    const results = await checkPermitSources(async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/' } }));
    expect(results.every(r => r.status === 'unavailable' && !r.contentHash)).toBe(true);
  });
});
