'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Mail, RefreshCw, Send } from 'lucide-react';
import './email-panel.css';

type Recipient={companyId:string;companyName:string;sector:string|null;email:string|null};
type Delivery={id:string;companyName:string;to:string;subject:string;status:string;error?:string|null;createdAt:string};
type EmailData={configured:boolean;connected:boolean;email?:string;recipients:Recipient[];history:Delivery[]};
async function readEmailData():Promise<EmailData>{
  const response=await fetch('/api/email',{cache:'no-store'});
  const value=await response.json() as EmailData&{error?:{message?:string}};
  if(!response.ok)throw new Error(value.error?.message??'Email workspace could not be loaded.');
  return value;
}
export function EmailPanel({initialSelected=[],initialMessage=null}:{initialSelected?:string[];initialMessage?:string|null}){
  const [data,setData]=useState<EmailData|null>(null);
  const [selected,setSelected]=useState<string[]>(initialSelected);
  const [subject,setSubject]=useState('');const [body,setBody]=useState('');
  const [query,setQuery]=useState('');const [sector,setSector]=useState('All sectors');
  const [message,setMessage]=useState<string|null>(initialMessage);const [loading,setLoading]=useState(true);
  const [emailCompany,setEmailCompany]=useState('');const [emailAddress,setEmailAddress]=useState('');const [savingAddress,setSavingAddress]=useState(false);
  const [sending,setSending]=useState(false);const [review,setReview]=useState(false);
  const requestId=useRef<string|null>(null);const busy=useRef(false);
  const load=useCallback(async()=>{setData(await readEmailData());},[]);
  useEffect(()=>{
    let active=true;
    readEmailData().then(value=>{if(active)setData(value);}).catch(error=>{if(active)setMessage(error instanceof Error?error.message:'Email could not be loaded.');}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[]);
  const recipients=data?.recipients??[];
  const chosen=recipients.filter(item=>selected.includes(item.companyId));
  const missing=chosen.filter(item=>!item.email);
  const unknown=selected.filter(id=>!recipients.some(item=>item.companyId===id));
  const visible=recipients.filter(item=>(sector==='All sectors'||(item.sector??'Unassigned')===sector)&&`${item.companyName} ${item.email??''}`.toLowerCase().includes(query.toLowerCase()));
  const sectors=[...new Set(recipients.map(item=>item.sector??'Unassigned'))].sort();
  function edit(){requestId.current=null;setReview(false);}
  function toggle(id:string){edit();setSelected(current=>current.includes(id)?current.filter(item=>item!==id):[...current,id]);}
  async function send(){
    if(busy.current||!data?.connected||!chosen.length||missing.length||unknown.length||chosen.length>20)return;
    busy.current=true;setSending(true);setMessage(null);
    requestId.current??=crypto.randomUUID();
    try{
      const totals={sent:0,failed:0,unknown:0};
      for(const [index,company] of chosen.entries()){
        setMessage(`Sending ${index+1} of ${chosen.length}: ${company.companyName}…`);
        const response=await fetch('/api/email/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({companyIds:[company.companyId],subject,body,requestId:requestId.current})});
        const value=await response.json() as {sent?:number;failed?:number;unknown?:number;error?:{message?:string}};
        if(!response.ok)throw new Error(value.error?.message??'Sending did not return a confirmed result. Check Gmail Sent before attempting another send.');
        totals.sent+=value.sent??0;totals.failed+=value.failed??0;totals.unknown+=value.unknown??0;
      }
      setMessage(`${totals.sent} sent · ${totals.failed} failed · ${totals.unknown} unconfirmed. Check the sending history below.`);
      setReview(false);await load();
    }catch(error){setMessage(`${error instanceof Error?error.message:'Sending could not be confirmed.'} Check Gmail Sent and sending history before trying again.`);void load().catch(()=>undefined);}
    finally{busy.current=false;setSending(false);}
  }
  async function saveAddress(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(busy.current||!emailCompany)return;busy.current=true;setSavingAddress(true);
    try{
      const response=await fetch(`/api/companies/${encodeURIComponent(emailCompany)}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({cells:{Email:emailAddress.trim()}})});
      const value=await response.json() as {error?:{message?:string}};
      if(!response.ok)throw new Error(value.error?.message??'Email address could not be saved.');
      edit();await load();setMessage('Email address saved to the company sheet.');setEmailAddress('');setEmailCompany('');
    }catch(error){setMessage(error instanceof Error?error.message:'Email address could not be saved.');}finally{busy.current=false;setSavingAddress(false);}
  }
  async function disconnect(){
    if(busy.current)return;busy.current=true;
    try{const response=await fetch('/api/email/disconnect',{method:'POST'});if(!response.ok)throw new Error('Gmail could not be disconnected.');await load();setMessage('Gmail disconnected.');}
    catch(error){setMessage(error instanceof Error?error.message:'Disconnect failed.');}finally{busy.current=false;}
  }
  return <section className="email-workspace workspace-frame__page">
    <div className="standalone-header"><p className="eyebrow">Company outreach</p><h1 className="workspace-title">Email companies</h1><p className="workspace-description">Choose companies from your saved data, write your message, and send a separate email to each company through Gmail.</p></div>
    <div className="email-connection settings-card"><Mail size={20}/><div><strong>{data?.connected?`Gmail connected: ${data.email??'your account'}`:'Connect Gmail to send'}</strong><p>{loading?'Checking connection…':!data?'Connection could not be checked. Choose Refresh to try again.':data.configured?'Your Google account is used only after you choose Send.':'Google OAuth setup is required before Gmail sign-in is available.'}</p></div><div className="email-connection-actions">{data?.connected?<button className="secondary-button" onClick={()=>void disconnect()} disabled={sending}>Disconnect</button>:data?.configured?<a className="primary-button" href="/api/email/connect" target="_top">Sign in with Google</a>:null}<button className="secondary-button" aria-label="Refresh Gmail connection" disabled={sending} onClick={()=>{setLoading(true);void load().catch(error=>setMessage(error.message)).finally(()=>setLoading(false));}}><RefreshCw size={15}/>Refresh</button></div></div>
    {data&&!data.configured&&<details className="settings-card email-setup"><summary>Gmail setup instructions</summary><ol><li>In Google Cloud, enable the Gmail API and create an OAuth client for a Web application.</li><li>Add this authorised redirect URI: <code>{typeof window==='undefined'?'https://dublin-tech-compass.emeraldpathways.chatgpt.site/api/email/callback':`${window.location.origin}/api/email/callback`}</code></li><li>Set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> in the site’s runtime settings.</li><li>Publish the runtime settings, then return here and choose Sign in with Google. If the Google app is in testing, add your Gmail address as a test user.</li></ol><p>Your Gmail password is never entered in this app.</p></details>}
    {message&&<div className="email-notice" role="status">{message}</div>}
    <div className="email-grid"><section className="settings-card email-recipients"><h2>1. Select companies</h2><div className="email-filters"><input aria-label="Search email recipients" placeholder="Search company or email" value={query} onChange={event=>setQuery(event.target.value)}/><select aria-label="Filter recipients by sector" value={sector} onChange={event=>setSector(event.target.value)}><option>All sectors</option>{sectors.map(value=><option key={value}>{value}</option>)}</select></div><div className="email-selection"><span>{chosen.length} selected</span><button className="email-text-button" disabled={sending} onClick={()=>{edit();setSelected([...new Set([...selected,...visible.filter(item=>item.email).map(item=>item.companyId)])]);}}>Select visible with email</button><button className="email-text-button" disabled={sending} onClick={()=>{edit();setSelected([]);}}>Clear</button></div><div className="email-recipient-list">{visible.map(item=><label key={item.companyId} className="email-recipient"><input type="checkbox" checked={selected.includes(item.companyId)} disabled={sending} onChange={()=>toggle(item.companyId)}/><span><strong>{item.companyName}</strong><small>{item.email??'No email address — add one below'}</small></span><small>{item.sector??'Unassigned'}</small></label>)}{!visible.length&&<p>{loading?'Loading companies…':'No matching companies. Import a spreadsheet to begin.'}</p>}</div><details className="email-address-editor"><summary>Add or update a company email</summary><form onSubmit={event=>void saveAddress(event)}><label>Company<select value={emailCompany} required disabled={sending||savingAddress} onChange={event=>setEmailCompany(event.target.value)}><option value="">Choose a company</option>{recipients.map(item=><option key={item.companyId} value={item.companyId}>{item.companyName}</option>)}</select></label><label>Email address<input type="email" value={emailAddress} required disabled={sending||savingAddress} onChange={event=>setEmailAddress(event.target.value)}/></label><button className="secondary-button" disabled={sending||savingAddress||!emailCompany||!emailAddress.trim()}>{savingAddress?'Saving…':'Save email address'}</button></form></details><Link href="/">Open company sheet</Link></section>
    <section className="settings-card email-composer"><h2>2. Compose email</h2><label>Subject<input value={subject} maxLength={200} disabled={sending} onChange={event=>{edit();setSubject(event.target.value);}}/></label><label>Message<textarea value={body} rows={12} maxLength={20000} disabled={sending} onChange={event=>{edit();setBody(event.target.value);}}/></label><p>Send individually: company addresses are never shared with other recipients. Maximum 20 companies per send.</p>{missing.length>0&&<p className="email-warning">{missing.length} selected companies have no email address. Add their address below or deselect them.</p>}{unknown.length>0&&<p className="email-warning">Some selected companies are no longer available. Clear the selection and choose again.</p>}{chosen.length>20&&<p className="email-warning">Select up to 20 companies for this send.</p>}
    {!review?<button className="primary-button" disabled={!data?.connected||!chosen.length||!!missing.length||!!unknown.length||chosen.length>20||!subject.trim()||!body.trim()||sending} onClick={()=>setReview(true)}>Review recipients</button>:<div className="email-review"><h3>Confirm recipients ({chosen.length})</h3><ul>{chosen.map(item=><li key={item.companyId}>{item.companyName}: {item.email}</li>)}</ul><p>The subject and message above will be sent to each address listed.</p><button className="primary-button" disabled={sending} onClick={()=>void send()}><Send size={15}/>{sending?'Sending…':`Send ${chosen.length} emails`}</button><button className="secondary-button" disabled={sending} onClick={()=>setReview(false)}>Back to editing</button></div>}</section></div>
    <section className="settings-card email-history"><h2>Sending history</h2><p>“Sent” means Gmail accepted the message. Unconfirmed messages may have been sent; check Gmail Sent before retrying.</p><div className="overflow-x-auto"><table className="run-table"><thead><tr><th>Company</th><th>To</th><th>Subject</th><th>Status</th><th>Date</th></tr></thead><tbody>{data?.history.map(item=><tr key={item.id}><td>{item.companyName}</td><td>{item.to}</td><td>{item.subject}</td><td>{item.status}{item.error&&<small>{item.error}</small>}</td><td>{new Date(item.createdAt).toLocaleString('en-IE')}</td></tr>)}{!data?.history.length&&<tr><td colSpan={5}>No emails sent from this app yet.</td></tr>}</tbody></table></div></section>
  </section>;
}
