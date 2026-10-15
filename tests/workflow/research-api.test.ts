import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/d1';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../db/schema';
const state=vi.hoisted(()=>({db:null as unknown,user:'owner-1',enrich:vi.fn()}));
vi.mock('../../db',()=>({getDb:()=>state.db}));
vi.mock('../../lib/auth/require-user',()=>({userFromRequest:()=>state.user?{userId:state.user}:null,unauthorizedResponse:()=>Response.json({error:{message:'Sign in'}},{status:401})}));
vi.mock('../../lib/research/enrichment-service',()=>({enrichCompany:state.enrich}));
vi.mock('../../lib/repositories/company-repository',()=>({listCompanies:async()=>[
 {id:'co-a',name:'A',sector:'Fintech',categories:[]}, {id:'co-b',name:'B',sector:'Fintech',categories:[]}, {id:'co-c',name:'C',sector:'Healthcare',categories:[]}
]}));
import { POST as create, GET as getRuns } from '../../app/api/research/route';
import { POST as step } from '../../app/api/research/[runId]/step/route';
type RunBody={run:{id:string;total:number;processed:number;succeeded:number;failed:number;status:string;cursor:string}};
let sqlite:DatabaseSync;
function adapter(){
 return {prepare(sql:string){let values:unknown[]=[];const statement={bind(...input:unknown[]){values=input;return statement;},async all(){const rows=sqlite.prepare(sql).all(...values as never[]);return {results:rows,success:true,meta:{}};},async raw(){return sqlite.prepare(sql).all(...values as never[]).map(row=>Object.values(row));},async run(){return sqlite.prepare(sql).run(...values as never[]);}};return statement;}};
}
beforeEach(()=>{
 state.user='owner-1';state.enrich.mockReset();state.enrich.mockResolvedValue({status:'completed'});
 sqlite=new DatabaseSync(':memory:');
 sqlite.exec('CREATE TABLE refresh_runs (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, kind TEXT NOT NULL,status TEXT NOT NULL,category TEXT,company_id TEXT,requested_by TEXT DEFAULT "user",total INTEGER DEFAULT 0,processed INTEGER DEFAULT 0,succeeded INTEGER DEFAULT 0,failed INTEGER DEFAULT 0,cursor TEXT,error TEXT,started_at TEXT,finished_at TEXT,created_at TEXT,updated_at TEXT); CREATE TABLE companies (id TEXT PRIMARY KEY,owner_id TEXT,enrichment_status TEXT,updated_at TEXT);');
 state.db=drizzle(adapter() as never,{schema});
});
const request=(value:unknown)=>new Request('https://site/api/research',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
describe('persisted research queue',()=>{
 it('snapshots only the current sector and processes one company per step',async()=>{
  const result=await create(request({scope:'sector',sector:'Fintech'}));expect(result.status).toBe(201);
  const {run}=await result.json() as RunBody;expect(run.total).toBe(2);
  const response=await step(request({}),{params:Promise.resolve({runId:run.id})});expect(response.status).toBe(200);
  const body=await response.json() as RunBody;expect(body.run).toMatchObject({processed:1,total:2,succeeded:1});
  const saved=sqlite.prepare('SELECT cursor FROM refresh_runs WHERE id=?').get(run.id);expect(JSON.parse(String(saved?.cursor)).remainingCompanyIds).toEqual(['co-b']);
  expect(state.enrich).toHaveBeenCalledTimes(1);
 });
 it('denies access to another owner and does not call the provider',async()=>{
  const {run}=await (await create(request({scope:'selected',sector:'Fintech',companyIds:['co-a']}))).json() as RunBody;
  state.user='other-owner';const response=await step(request({}),{params:Promise.resolve({runId:run.id})});expect(response.status).toBe(404);expect(state.enrich).not.toHaveBeenCalled();
 });
 it('retains failures and advances without pretending the company succeeded',async()=>{
  const {run}=await (await create(request({scope:'sector',sector:'Fintech'}))).json() as RunBody;state.enrich.mockRejectedValueOnce(new Error('Provider unavailable'));
  const response=await step(request({}),{params:Promise.resolve({runId:run.id})});const body=await response.json() as RunBody;expect(body.run).toMatchObject({processed:1,failed:1,succeeded:0,status:'partial'});expect(JSON.parse(body.run.cursor).retryableCompanyIds).toEqual(['co-a']);
 });
 it('retrieves an exact older history run and retries only its failed companies',async()=>{
  const {run}=await (await create(request({scope:'sector',sector:'Fintech'}))).json() as RunBody;
  state.enrich.mockResolvedValueOnce({status:'failed'});
  await step(request({}),{params:Promise.resolve({runId:run.id})});
  await step(request({}),{params:Promise.resolve({runId:run.id})});
  for(let i=0;i<6;i++)await create(request({scope:'sector',sector:'Healthcare'}));
  const found=await (await getRuns(new Request(`https://site/api/research?runId=${run.id}`))).json() as {runs:RunBody['run'][]};
  expect(found.runs.map(item=>item.id)).toEqual([run.id]);
  const retried=await (await create(request({retryRunId:run.id}))).json() as RunBody;
  const repeated=await (await create(request({retryRunId:run.id}))).json() as RunBody;
  expect(repeated.run.id).toBe(retried.run.id);
  expect(retried.run.total).toBe(1);expect(JSON.parse(retried.run.cursor).remainingCompanyIds).toEqual(['co-a']);
  state.user='other-owner';expect((await create(request({retryRunId:run.id}))).status).toBe(404);
 });
 it('requires identity for queues and rejects concurrent steps',async()=>{
  const {run}=await (await create(request({scope:'sector',sector:'Fintech'}))).json() as RunBody;sqlite.prepare('UPDATE refresh_runs SET status=?,updated_at=? WHERE id=?').run('running',new Date().toISOString(),run.id);
  expect((await step(request({}),{params:Promise.resolve({runId:run.id})})).status).toBe(409);expect(state.enrich).not.toHaveBeenCalled();
  state.user='';expect((await create(request({scope:'sector',sector:'Fintech'}))).status).toBe(401);
 });
});
