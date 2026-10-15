import { requireChatGPTUser } from '../chatgpt-auth';
import { EmailPanel } from '../../components/email/email-panel';
export const dynamic='force-dynamic';
export default async function EmailPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  await requireChatGPTUser('/email');
  const params=await searchParams;
  const selected=typeof params.companies==='string'?params.companies.split(',').filter(Boolean).slice(0,1000):[];
  const message=typeof params.error==='string'?params.error.slice(0,300):null;
  return <EmailPanel initialSelected={selected} initialMessage={message}/>;
}
