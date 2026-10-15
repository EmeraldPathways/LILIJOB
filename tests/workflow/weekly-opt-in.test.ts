import { describe, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({env:{} as Record<string,string>,run:vi.fn()}));
vi.mock('cloudflare:workers',()=>({env:state.env}));
vi.mock('../../lib/jobs/weekly-refresh',()=>({runWeeklyRefresh:state.run}));
vi.mock('../../lib/auth/require-user',()=>({userFromRequest:()=>({userId:'owner'}),unauthorizedResponse:()=>new Response(null,{status:401})}));
vi.mock('../../lib/jobs/run-config',()=>({getRunConfig:vi.fn(),listConfiguredOwners:vi.fn(),recordRunUsage:vi.fn()}));
import { POST } from '../../app/api/weekly-refresh/route';
describe('no automatic paid research',()=>{
 it('leaves automatic research disabled until explicitly enabled',async()=>{
  const response=await POST(new Request('https://site/api/weekly-refresh',{method:'POST'}));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({status:'paused'});
  expect(state.run).not.toHaveBeenCalled();
 });
});
