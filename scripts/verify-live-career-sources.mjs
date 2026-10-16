import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parse } from 'node:path';
import { parseCareerPage } from '../lib/v4/job-radar.ts';
const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
const output = process.argv[3];
const results=[];
const userAgent='DublinTechCompassSourceCheck/1.0';
function disallowed(robots, pathname) {
 let applies=false;
 for (const line of robots.split(/\r?\n/)) {
  const m=line.replace(/#.*/,'').trim().match(/^(user-agent|disallow):\s*(.*)$/i); if(!m)continue;
  if(m[1].toLowerCase()==='user-agent') applies=m[2]==='*';
  else if(applies && m[2] && pathname.startsWith(m[2]))return true;
 }
 return false;
}
for(let start=0;start<input.length;start+=4){
 const batch=await Promise.all(input.slice(start,start+4).map(async row=>{
  const checkedAt=new Date().toISOString();
  if(/hugedomains|become-a-partner|domain_profile/i.test(row.url))return {...row,checkedAt,status:'invalid-careers-source',verifiedJobs:0};
  try{
   const u=new URL(row.url);
   const rr=await fetch(new URL('/robots.txt',u),{signal:AbortSignal.timeout(10000),headers:{'user-agent':userAgent}});
   if(rr.status===403||rr.status===429)return {...row,checkedAt,status:'robots-unavailable',httpStatus:rr.status};
   if(rr.ok&&disallowed(await rr.text(),u.pathname))return {...row,checkedAt,status:'robots-disallowed'};
   const response=await fetch(row.url,{signal:AbortSignal.timeout(12000),headers:{'user-agent':userAgent,accept:'text/html'}});
   if(!response.ok)return {...row,checkedAt,status:'source-unavailable',httpStatus:response.status};
   const html=await response.text();
   if(html.length>2_000_000)return {...row,checkedAt,status:'oversize'};
   const result=parseCareerPage(html,response.url,checkedAt);
   return {...row,checkedAt,httpStatus:response.status,finalUrl:response.url,status:result.status,verifiedJobs:result.jobs.filter(j=>j.verified).length,unverifiedLinks:result.jobs.filter(j=>!j.verified).length,jobSample:result.jobs.filter(j=>j.verified).slice(0,3).map(j=>({title:j.title,url:j.url,location:j.location,postedAt:j.postedAt}))};
  }catch(error){return {...row,checkedAt,status:'network-unavailable',error:error.message};}
 }));results.push(...batch);
}
await mkdir(parse(output).dir,{recursive:true});await writeFile(output,JSON.stringify({executedAt:new Date().toISOString(),count:results.length,results},null,2));
console.log(JSON.stringify({count:results.length,statuses:results.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{}),verifiedJobs:results.reduce((s,r)=>s+(r.verifiedJobs||0),0)}));
