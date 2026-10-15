import { notFound } from 'next/navigation';
import { requireChatGPTUser } from '../../chatgpt-auth';
import { AppShell } from '../../../components/workbench/app-shell';
import { listCompanies, type CompanyListItem } from '../../../lib/repositories/company-repository';
import { SIDEBAR_SECTORS } from '../../../lib/workbench/sector-workspace';
export const dynamic='force-dynamic';
export default async function SectorPage({params}:{params:Promise<{sector:string}>}){
  const {sector}=await params;
  const section=SIDEBAR_SECTORS.find(item=>item.slug===sector);
  if(!section)notFound();
  const user=await requireChatGPTUser(`/sectors/${section.slug}`);
  let companies:CompanyListItem[]=[];let error:string|null=null;
  try{companies=await listCompanies(user.userId);}catch(cause){error=cause instanceof Error?cause.message:'Company data could not be loaded.';}
  return <AppShell key={section.slug} initialSector={section.label} user={{displayName:user.displayName,email:user.email}} initialCompanies={companies} initialError={error}/>;
}
