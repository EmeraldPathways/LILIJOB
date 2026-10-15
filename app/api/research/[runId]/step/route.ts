import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '../../../../../db';
import { companies, refreshRuns } from '../../../../../db/schema';
import { userFromRequest, unauthorizedResponse } from '../../../../../lib/auth/require-user';
import { enrichCompany } from '../../../../../lib/research/enrichment-service';
import { parseResearchCursor, researchStepResult } from '../../../../../lib/workbench/research-queue';
export const dynamic='force-dynamic';
export async function POST(request:Request,context:{params:Promise<{runId:string}>}){
  const user=userFromRequest(request);if(!user)return unauthorizedResponse();
  const {runId}=await context.params;const db=getDb();
  const scope=and(eq(refreshRuns.ownerId,user.userId),eq(refreshRuns.id,runId),eq(refreshRuns.kind,'research'));
  const [run]=await db.select().from(refreshRuns).where(scope).limit(1);
  if(!run)return Response.json({error:{message:'Research run not found.'}},{status:404});
  if(run.status==='running'&&Date.now()-Date.parse(run.updatedAt)<60_000)return Response.json({error:{message:'The current company is still being processed. Try Resume shortly.'}},{status:409});
  const cursor=parseResearchCursor(run.cursor);const companyId=cursor.remainingCompanyIds[0];
  if(!companyId)return Response.json({run});
  const now=new Date().toISOString();
  const lease=crypto.randomUUID();
  const leasedCursor=JSON.stringify({...cursor,lease});
  const locked=await db.update(refreshRuns).set({status:'running',startedAt:run.startedAt??now,updatedAt:now,cursor:leasedCursor,finishedAt:null}).where(and(scope,eq(refreshRuns.updatedAt,run.updatedAt),run.cursor===null?isNull(refreshRuns.cursor):eq(refreshRuns.cursor,run.cursor))).returning({id:refreshRuns.id});
  if(!locked.length)return Response.json({error:{message:'This run is already being processed.'}},{status:409});
  const heartbeat=setInterval(()=>{void db.update(refreshRuns).set({updatedAt:new Date().toISOString()}).where(and(scope,eq(refreshRuns.cursor,leasedCursor))).catch(()=>undefined);},15_000);
  let status='failed';let errorMessage:string|null=null;
  try{const result=await enrichCompany(user.userId,companyId,runId);status=result.status;errorMessage=result.error??null;}
  catch(error){errorMessage=error instanceof Error?error.message:'Company research failed.';await db.update(companies).set({enrichmentStatus:'failed',updatedAt:new Date().toISOString()}).where(and(eq(companies.ownerId,user.userId),eq(companies.id,companyId)));}
  finally{clearInterval(heartbeat);}
  const next=researchStepResult(cursor,companyId,status);const done=next.remainingCompanyIds.length===0;const end=new Date().toISOString();
  const [updated]=await db.update(refreshRuns).set({status:done?(next.retryableCompanyIds.length?'partial':'completed'):'partial',total:run.total,processed:run.processed+1,succeeded:run.succeeded+(status==='completed'?1:0),failed:run.failed+(status==='completed'?0:1),cursor:JSON.stringify(next),error:errorMessage,finishedAt:done?end:null,updatedAt:end}).where(and(scope,eq(refreshRuns.cursor,leasedCursor))).returning();
  if(!updated)return Response.json({error:{message:'Run changed while processing. Reload research history.'}},{status:409});
  return Response.json({run:updated,companyId,status});
}
