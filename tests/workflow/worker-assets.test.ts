import { describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
const state=vi.hoisted(()=>({type:'text/html'}));
vi.mock('vinext/server/fetch-handler',()=>({default:{fetch:async()=>new Response('content',{headers:{'content-type':state.type,'cache-control':'public, max-age=3600'}})}}));
import worker from '../../build/sites-worker';
describe('deployment navigation resilience',()=>{
 it('retains the exact previous-release asset paths reported missing in production',()=>{
  expect(existsSync('compatibility/client-assets/_next/static/chunks/x-BQPeVgwu.js')).toBe(true);
  expect(existsSync('compatibility/client-assets/_next/static/css/index.CHVNkvKj.css')).toBe(true);
 });
 it('does not cache dynamic documents or RSC payloads, while preserving static asset policy',async()=>{
  for(const type of ['text/html','text/x-component','application/javascript']){
   state.type=type;
   const response=await worker.fetch(new Request('https://site.example/'),{} as never,{props:{}} as never);
   expect(response.headers.get('cache-control')).toBe(type==='application/javascript'?'public, max-age=3600':'private, no-store');
  }
 });
});
