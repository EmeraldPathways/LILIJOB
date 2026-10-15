export type ResearchCursor = { remainingCompanyIds: string[]; retryableCompanyIds: string[] };
export function parseResearchCursor(cursor:string|null):ResearchCursor {
  try {
    const value=JSON.parse(cursor??'{}');
    const ids=(input:unknown)=>Array.isArray(input)?[...new Set(input.filter((item):item is string=>typeof item==='string'&&Boolean(item.trim())))]:[];
    return {remainingCompanyIds:ids(value?.remainingCompanyIds),retryableCompanyIds:ids(value?.retryableCompanyIds)};
  } catch {return {remainingCompanyIds:[],retryableCompanyIds:[]};}
}
export function researchStepResult(cursor:ResearchCursor,companyId:string,status:string):ResearchCursor {
  return {remainingCompanyIds:cursor.remainingCompanyIds.filter(id=>id!==companyId),retryableCompanyIds:[...new Set([...cursor.retryableCompanyIds.filter(id=>id!==companyId),...(status==='completed'?[]:[companyId])])]};
}
