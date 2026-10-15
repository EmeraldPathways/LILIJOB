import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({env:{} as Record<string,string>}));
vi.mock('cloudflare:workers',()=>({env:state.env}));
vi.mock('../../db',()=>({getDb:vi.fn()}));
vi.mock('../../lib/import/import-service',()=>({importWorkbook:vi.fn()}));
import {POST} from '../../app/api/maintenance/import-workbook/route';
beforeEach(()=>{for(const key of Object.keys(state.env))delete state.env[key];});
it('disables the maintenance import without server configuration',async()=>{
 expect((await POST(new Request('https://site.test/api/maintenance/import-workbook',{method:'POST'}))).status).toBe(404);
});
it('rejects wrong credentials and a workbook that does not match the approved hash',async()=>{
 Object.assign(state.env,{ADMIN_IMPORT_TOKEN:'secret',ADMIN_IMPORT_OWNER_ID:'owner',ADMIN_IMPORT_SHA256:'not-the-hash',ADMIN_IMPORT_EXPIRES_AT:new Date(Date.now()+60000).toISOString()});
 expect((await POST(new Request('https://site.test/api/maintenance/import-workbook',{method:'POST'}))).status).toBe(401);
 expect((await POST(new Request('https://site.test/api/maintenance/import-workbook',{method:'POST',headers:{authorization:'Bearer secret'},body:'wrong workbook'}))).status).toBe(403);
});
it('rejects expired maintenance authorization',async()=>{
 Object.assign(state.env,{ADMIN_IMPORT_TOKEN:'secret',ADMIN_IMPORT_OWNER_ID:'owner',ADMIN_IMPORT_SHA256:'hash',ADMIN_IMPORT_EXPIRES_AT:'2000-01-01'});
 expect((await POST(new Request('https://site.test/api/maintenance/import-workbook',{method:'POST'}))).status).toBe(404);
});
