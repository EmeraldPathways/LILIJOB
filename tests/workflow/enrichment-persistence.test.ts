import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/d1';
import { describe, it, expect, vi } from 'vitest';
import * as schema from '../../db/schema';
const state=vi.hoisted(()=>({db:null as unknown}));
vi.mock('../../db',()=>({getDb:()=>state.db}));
import { enrichCompany } from '../../lib/research/enrichment-service';

describe('enrichment persistence against SQLite',()=>{
 it('makes one request, fills gaps and preserves imported data and parent-run counters',async()=>{
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../drizzle/0000_abnormal_zeigeist.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../../drizzle/0001_tearful_eternity.sql',import.meta.url),'utf8'));
  sqlite.prepare('INSERT INTO companies (id,owner_id,name,normalized_name,description,metadata_json) VALUES (?,?,?,?,?,?)').run('co-a','owner-a','Acme Payments','acme payments','Imported description',JSON.stringify({sector:'Fintech',original:{Company:'Acme Payments',Sector:'Fintech',Description:'Imported description',Website:''}}));
  sqlite.prepare('INSERT INTO refresh_runs (id,owner_id,kind,status,total,processed) VALUES (?,?,?,?,?,?)').run('run-parent','owner-a','research','running',2,0);
  const adapter={prepare(sql:string){let values:unknown[]=[];const statement={bind(...input:unknown[]){values=input;return statement;},async all(){return {results:sqlite.prepare(sql).all(...values as never[]),success:true,meta:{}};},async raw(){return sqlite.prepare(sql).all(...values as never[]).map(row=>Object.values(row));},async run(){return sqlite.prepare(sql).run(...values as never[]);}};return statement;}};
  state.db=drizzle(adapter as never,{schema});
  let requests=0;
  const provider={name:'fixture',async search(){requests++;sqlite.prepare('UPDATE companies SET headquarters=? WHERE id=?').run('User entered HQ','co-a');return [{url:'https://acmepayments.example',title:'Acme Payments',snippet:'Acme Payments is a financial technology company based in Dublin City, Ireland. The company provides payment software and payment processing for business customers.',provider:'fixture',retrievedAt:new Date().toISOString(),sourceType:'official-company' as const,hasFullContent:false,status:'ok' as const}];}};
  const result=await enrichCompany('owner-a','co-a','run-parent',{provider});
  expect(requests).toBe(1);expect(result.status).toBe('completed');
  const company=sqlite.prepare('SELECT website,description,metadata_json,locality,headquarters FROM companies WHERE id=?').get('co-a');
  expect(company?.headquarters).toBe('User entered HQ');
  expect(company?.description).toBe('Imported description');expect(company?.website).toBe('https://acmepayments.example');
  expect(JSON.parse(String(company?.metadata_json)).original).toMatchObject({Website:'',Description:'Imported description'});
  const run=sqlite.prepare('SELECT total,processed,status FROM refresh_runs WHERE id=?').get('run-parent');expect(run).toMatchObject({total:2,processed:0,status:'running'});
  expect(sqlite.prepare('SELECT COUNT(*) AS count FROM sources WHERE owner_id=?').get('owner-a')).toMatchObject({count:1});
  sqlite.close();
 });
});
