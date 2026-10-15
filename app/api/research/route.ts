import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '../../../db';
import { refreshRuns } from '../../../db/schema';
import { userFromRequest, unauthorizedResponse } from '../../../lib/auth/require-user';
import { listCompanies } from '../../../lib/repositories/company-repository';
import { parseResearchCursor } from '../../../lib/workbench/research-queue';
import { researchTargets } from '../../../lib/workbench/sector-workspace';
export const dynamic='force-dynamic';
export async function GET(request:Request){
  const user=userFromRequest(request);if(!user)return unauthorizedResponse();
  const requested=new URL(request.url).searchParams.get('runId');
  if(requested){
    const runs=await getDb().select().from(refreshRuns).where(and(eq(refreshRuns.ownerId,user.userId),eq(refreshRuns.kind,'research'),eq(refreshRuns.id,requested))).limit(1);
    return Response.json({runs});
  }
  const runs=await getDb().select().from(refreshRuns).where(and(eq(refreshRuns.ownerId,user.userId),eq(refreshRuns.kind,'research'),inArray(refreshRuns.status,['queued','running','partial']))).orderBy(desc(refreshRuns.createdAt)).limit(5);
  return Response.json({runs:runs.filter(run=>run.processed<run.total)});
}
export async function POST(request:Request){
  const user=userFromRequest(request);if(!user)return unauthorizedResponse();
  const body=await request.json().catch(()=>null) as {scope?:unknown;sector?:unknown;companyIds?:unknown;retryRunId?:unknown}|null;
  if(body&&typeof body.retryRunId==='string'){
    const [previous]=await getDb().select().from(refreshRuns).where(and(eq(refreshRuns.ownerId,user.userId),eq(refreshRuns.kind,'research'),eq(refreshRuns.id,body.retryRunId))).limit(1);
    if(!previous)return Response.json({error:{message:'Research run not found.'}},{status:404});
    if(previous.processed<previous.total)return Response.json({error:{message:'Resume the remaining companies first.'}},{status:409});
    const eligible=new Set((await listCompanies(user.userId)).map(company=>company.id));
    const ids=parseResearchCursor(previous.cursor).retryableCompanyIds.filter(id=>eligible.has(id));
    if(!ids.length)return Response.json({error:{message:'No failed companies to retry.'}},{status:400});
    const now=new Date().toISOString();
    const run={id:`retry_${previous.id}`,ownerId:user.userId,kind:'research',category:previous.category,status:'queued',total:ids.length,processed:0,succeeded:0,failed:0,cursor:JSON.stringify({remainingCompanyIds:ids,retryableCompanyIds:[]}),createdAt:now,updatedAt:now};
    await getDb().insert(refreshRuns).values(run).onConflictDoNothing();
    const [saved]=await getDb().select().from(refreshRuns).where(and(eq(refreshRuns.ownerId,user.userId),eq(refreshRuns.id,run.id))).limit(1);
    return Response.json({run:saved},{status:201});
  }
  if(!body||!['sector','selected'].includes(String(body.scope))||typeof body.sector!=='string'||(body.scope==='selected'&&(!Array.isArray(body.companyIds)||!body.companyIds.every(id=>typeof id==='string'))))return Response.json({error:{message:'Choose a sector or select companies to research.'}},{status:400});
  try{
    const rows=await listCompanies(user.userId);
    const ids=researchTargets(rows,body.sector,body.scope==='sector'?'all':'selected',Array.isArray(body.companyIds)?body.companyIds:[]);
    if(!ids.length)return Response.json({error:{message:'No companies selected in this sector.'}},{status:400});
    const now=new Date().toISOString();
    const run={id:`run_${crypto.randomUUID()}`,ownerId:user.userId,kind:'research',category:body.sector,status:'queued',total:ids.length,processed:0,succeeded:0,failed:0,cursor:JSON.stringify({remainingCompanyIds:ids,retryableCompanyIds:[]}),createdAt:now,updatedAt:now};
    await getDb().insert(refreshRuns).values(run);
    return Response.json({run},{status:201});
  }catch(error){return Response.json({error:{message:error instanceof Error?error.message:'Research could not start.'}},{status:400});}
}
