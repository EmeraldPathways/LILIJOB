import { describe, expect, it, vi } from 'vitest';
const { env } = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock('cloudflare:workers', () => ({ env }));
import { POST } from '../../app/api/operations/release/route';
describe('release maintenance access', () => {
  it('is absent without time-limited credentials', async () => {
    expect((await POST(new Request('https://app/api/operations/release',{method:'POST'}))).status).toBe(404);
  });
  it('rejects expired credentials and missing bearer before database access', async () => {
    Object.assign(env,{RELEASE_OPERATIONS_TOKEN:'test-token',RELEASE_OPERATIONS_OWNER_ID:'site-owner',RELEASE_OPERATIONS_EXPIRES_AT:'2000-01-01T00:00:00Z'});
    expect((await POST(new Request('https://app/api/operations/release',{method:'POST',headers:{authorization:'Bearer test-token'}}))).status).toBe(404);
    env.RELEASE_OPERATIONS_EXPIRES_AT = new Date(Date.now()+60000).toISOString();
    expect((await POST(new Request('https://app/api/operations/release',{method:'POST'}))).status).toBe(401);
  });
});
