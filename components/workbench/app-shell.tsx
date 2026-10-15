"use client";

import Link from "next/link";
import "./workspace-tools.css";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Mail, Search, Sparkles, X } from 'lucide-react';
import type { CompanyDetail, CompanyListItem } from '../../lib/repositories/company-repository';
import { ALL_SECTORS, categoryForSector, sectorChoices, sectorCompanies } from '../../lib/workbench/sector-workspace';
import { CompanyList } from './company-list';
import { CompanyDetail as CompanyDetailView } from './company-detail';
import { CompanySheet } from './company-sheet';
import { ImportDialog } from './import-dialog';
import { AiHelper } from './ai-helper';
import type { CompanyListFilterState } from './filter-sheet';

export type AppShellUser = { displayName: string; email: string };
type ResearchRun = { id: string; status: string; total: number; processed: number; succeeded: number; failed: number };
const EMPTY_FILTERS:CompanyListFilterState={locality:'all',status:'all',permitSignal:'all',freshness:'all',confidence:'all',openRoles:'all'};

export function AppShell({initialCompanies,initialError=null}:{user:AppShellUser;initialCompanies:CompanyListItem[];initialError?:string|null}) {
  const [companies,setCompanies]=useState(initialCompanies);
  const [sector,setSector]=useState(()=>sectorChoices(initialCompanies)[0]??ALL_SECTORS);
  const [view,setView]=useState<'sheet'|'detail'>('sheet');
  const [selectedIds,setSelectedIds]=useState<string[]>([]);
  const [selectedId,setSelectedId]=useState<string|null>(initialCompanies[0]?.id??null);
  const [detail,setDetail]=useState<CompanyDetail|null>(null);
  const [activeTab,setActiveTab]=useState<'overview'|'roles'|'permit'|'sources'>('overview');
  const [query,setQuery]=useState('');
  const [filters,setFilters]=useState(EMPTY_FILTERS);
  const [status,setStatus]=useState<string|null>(initialError);
  const [busy,setBusy]=useState(false);
  const [activeRun,setActiveRun]=useState<ResearchRun|null>(null);
  const [detailRevision,setDetailRevision]=useState(0);
  const stopRequested=useRef(false);
  const busyRef=useRef(false);
  const loadVersion=useRef(0);
  const cellSaveQueue=useRef<Promise<void>>(Promise.resolve());
  const sectors=useMemo(()=>sectorChoices(companies),[companies]);
  const currentCompanies=useMemo(()=>sectorCompanies(companies,sector),[companies,sector]);
  const visibleDetailCompanies=useMemo(()=>currentCompanies.filter(company=>{
    if(query && ![company.name,company.description,...Object.values(company.importedData??{})].join(' ').toLowerCase().includes(query.toLowerCase()))return false;
    if(filters.locality!=='all'&&company.locality!==filters.locality)return false;
    if(filters.status!=='all'&&company.enrichmentStatus!==filters.status)return false;
    if(filters.permitSignal!=='all'&&company.permitSignal!==filters.permitSignal)return false;
    if(filters.freshness!=='all'&&company.freshness!==filters.freshness)return false;
    if(filters.confidence!=='all'&&company.confidence!==filters.confidence)return false;
    if(filters.openRoles==='yes'&&!company.openRoles)return false;
    if(filters.openRoles==='no'&&company.openRoles)return false;
    return true;
  }),[currentCompanies,query,filters]);

  const loadCompanies=useCallback(async()=>{
    const version=++loadVersion.current;
    const response=await fetch('/api/companies',{cache:'no-store'});
    const body=await response.json() as {companies?:CompanyListItem[];error?:{message?:string}};
    if(!response.ok||!body.companies)throw new Error(body.error?.message??'Unable to load companies.');
    if(version===loadVersion.current)setCompanies(body.companies);
    return body.companies;
  },[]);

  useEffect(()=>{
    if(view!=='detail'||!selectedId)return;
    const controller=new AbortController();
    fetch(`/api/companies/${encodeURIComponent(selectedId)}`,{cache:'no-store',signal:controller.signal}).then(async response=>{
      const body=await response.json() as {company?:CompanyDetail;error?:{message?:string}};
      if(!response.ok||!body.company)throw new Error(body.error?.message??'Unable to load company profile.');
      if(!controller.signal.aborted)setDetail(body.company);
    }).catch(error=>{if(!controller.signal.aborted){setDetail(null);setStatus(error instanceof Error?error.message:'Unable to load company profile.');}});
    return()=>controller.abort();
  },[view,selectedId,detailRevision]);
  useEffect(()=>{
    const controller=new AbortController();
    const requested=new URLSearchParams(window.location.search).get('researchRun');
    fetch(requested?`/api/research?runId=${encodeURIComponent(requested)}`:'/api/research',{cache:'no-store',signal:controller.signal}).then(async response=>{
      if(!response.ok)return;
      const {runs}=await response.json() as {runs:ResearchRun[]};
      const run=requested?runs.find(item=>item.id===requested):runs[0];
      if(run&&!controller.signal.aborted){setActiveRun(run);setStatus(`Saved research: ${run.processed} of ${run.total} processed. Choose Resume research to continue.`);}
    }).catch(()=>undefined);
    return()=>controller.abort();
  },[]);
  useEffect(()=>{stopRequested.current=false;return()=>{stopRequested.current=true;};},[]);

  function chooseSector(value:string){setSector(value);setSelectedIds([]);setQuery('');setFilters(EMPTY_FILTERS);const first=sectorCompanies(companies,value)[0];setSelectedId(first?.id??null);setDetail(null);}
  function openDetail(id:string){setSelectedId(id);setDetail(null);setActiveTab('overview');setView('detail');}
  function saveCell(id:string,column:string,value:string):Promise<void>{
    const save=cellSaveQueue.current.catch(()=>undefined).then(()=>persistCell(id,column,value));
    cellSaveQueue.current=save;
    return save;
  }
  async function persistCell(id:string,column:string,value:string){
    const response=await fetch(`/api/companies/${encodeURIComponent(id)}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({cells:{[column]:value}})});
    const body=await response.json() as {error?:{message?:string}};
    if(!response.ok)throw new Error(body.error?.message??'Cell could not be saved.');
    const next=await loadCompanies();
    setSector(current=>current!==ALL_SECTORS&&!sectorCompanies(next,current).length?ALL_SECTORS:current);
    setSelectedIds(current=>current.filter(id=>next.some(company=>company.id===id)));
    setDetailRevision(value=>value+1);
  }
  async function advanceRun(initial:ResearchRun){
    let run=initial;
    setActiveRun(run);
    while(run.processed<run.total&&!stopRequested.current){
      setStatus(`Researching ${run.processed+1} of ${run.total} · ${run.succeeded} completed · ${run.failed} need attention.`);
      const response=await fetch(`/api/research/${encodeURIComponent(run.id)}/step`,{method:'POST'});
      const body=await response.json() as {run?:ResearchRun;error?:{message?:string}};
      if(!response.ok||!body.run)throw new Error(body.error?.message??'Research stopped. Resume this run when ready.');
      if(body.run.processed<=run.processed)throw new Error('This company is still being processed. Resume after it completes.');
      run=body.run;setActiveRun(run);await loadCompanies();setDetailRevision(value=>value+1);
    }
    setStatus(stopRequested.current?`Research paused after ${run.processed} of ${run.total}. Resume when ready.`:`Research finished: ${run.succeeded} completed, ${run.failed} need attention. Existing spreadsheet values were preserved.`);
  }
  async function research(scope:'all'|'selected',ids=selectedIds){
    if(busyRef.current)return;busyRef.current=true;setBusy(true);stopRequested.current=false;
    try{
      const response=await fetch('/api/research',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scope:scope==='all'?'sector':'selected',sector,companyIds:ids})});
      const body=await response.json() as {run?:ResearchRun;error?:{message?:string}};
      if(!response.ok||!body.run)throw new Error(body.error?.message??'Research could not start.');
      await advanceRun(body.run);
    }catch(error){setStatus(error instanceof Error?error.message:'Research could not complete.');}
    finally{busyRef.current=false;setBusy(false);}
  }
  async function retryFailed(){
    if(!activeRun||busyRef.current)return;busyRef.current=true;setBusy(true);stopRequested.current=false;
    try{
      const response=await fetch('/api/research',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({retryRunId:activeRun.id})});
      const body=await response.json() as {run?:ResearchRun;error?:{message?:string}};
      if(!response.ok||!body.run)throw new Error(body.error?.message??'Failed companies could not be retried.');
      await advanceRun(body.run);
    }catch(error){setStatus(error instanceof Error?error.message:'Retry stopped.');}finally{busyRef.current=false;setBusy(false);}
  }
  async function resume(){if(!activeRun||busyRef.current)return;busyRef.current=true;setBusy(true);stopRequested.current=false;try{await advanceRun(activeRun);}catch(error){setStatus(error instanceof Error?error.message:'Research could not resume.');}finally{busyRef.current=false;setBusy(false);}}
  const pending=activeRun&&activeRun.processed<activeRun.total;

  return <section className="company-workspace">
      <div className="company-workspace-tools"><label className="workspace-sector-select"><span>Sector</span><select value={sector} onChange={event=>chooseSector(event.target.value)} aria-label="Sector"><option value={ALL_SECTORS}>All companies</option>{sectors.map(item=><option key={item}>{item}</option>)}</select></label><a href={`/api/exports?format=xlsx&sector=${encodeURIComponent(sector)}`} className="secondary-button"><Download size={15}/>Export Excel</a></div>
      <section className="workspace-header"><div><p className="eyebrow">County Dublin · {sector}</p><h1 className="workspace-title">Your company workspace.</h1><p className="workspace-description">Bring your Excel data into one place. Edit your sheet or open a profile, then choose which companies to research.</p></div><div className="workspace-actions"><ImportDialog onImported={async()=>{const next=await loadCompanies();const nextSectors=sectorChoices(next);if(sector===ALL_SECTORS&&nextSectors.length===1)setSector(nextSectors[0]);}}/></div></section>
      <section className="sector-toolbar" aria-label="Sector views and research"><div className="view-switch" role="group" aria-label="Company view"><button type="button" aria-pressed={view==='sheet'} onClick={()=>setView('sheet')}>Sheet view</button><button type="button" aria-pressed={view==='detail'} onClick={()=>{setView('detail');if(!selectedId)setSelectedId(currentCompanies[0]?.id??null);}}>Detailed view</button></div><span className="sector-summary">{currentCompanies.length} companies · {selectedIds.length} selected</span><div className="research-actions">{selectedIds.length>0&&<Link className="secondary-button" href={`/email?companies=${encodeURIComponent(selectedIds.join(','))}`}><Mail size={15}/>Email selected ({selectedIds.length})</Link>}<button className="secondary-button" type="button" disabled={busy||!selectedIds.length} onClick={()=>void research('selected')}><Search size={15}/>Research selected ({selectedIds.length})</button><button className="primary-button" type="button" disabled={busy||!currentCompanies.length||sector===ALL_SECTORS} title={sector===ALL_SECTORS?'Choose a sector first':'Research every company in this sector'} onClick={()=>void research('all')}><Sparkles size={15}/>Research all in sector</button>{busy&&<button className="secondary-button" onClick={()=>{stopRequested.current=true;setStatus('Stopping after the current company.');}}>Stop after current</button>}{!busy&&activeRun&&activeRun.processed>=activeRun.total&&activeRun.failed>0&&<button className="secondary-button" onClick={()=>void retryFailed()}>Retry failed companies ({activeRun.failed})</button>}{!busy&&pending&&<button className="secondary-button" onClick={()=>void resume()}>Resume research</button>}</div></section>
      {status&&<div className="status-banner" role="status"><span>{status}</span><button aria-label="Dismiss status" onClick={()=>setStatus(null)}><X size={14}/></button></div>}
      {activeRun&&<div className="research-progress" aria-label="Research progress"><progress max={activeRun.total||1} value={activeRun.processed}/><span>{activeRun.processed}/{activeRun.total} processed</span></div>}
      {view==='detail'&&<label className="mobile-detail-picker"><span>Company profile</span><select aria-label="Select company profile" value={selectedId??''} onChange={event=>openDetail(event.target.value)}><option value="" disabled>Choose a company</option>{currentCompanies.map(company=><option key={company.id} value={company.id}>{company.name}</option>)}</select></label>}
      {view==='sheet'?<section className="sheet-workspace" aria-label="Company workspace"><CompanySheet key={sector} companies={currentCompanies} selectedIds={selectedIds} onSelectionChange={setSelectedIds} onSaveCell={saveCell} onOpenDetail={openDetail}/></section>:<section className="workspace-grid workspace-detail-mode" aria-label="Company workspace"><CompanyList companies={visibleDetailCompanies} selectedId={selectedId} onSelect={openDetail} query={query} onQueryChange={setQuery} category={categoryForSector(sector)} filters={filters} onFiltersChange={setFilters}/><div className="detail-column"><div className="profile-region" role="region" aria-label="Company profile"><CompanyDetailView company={detail?.id===selectedId?detail:null} activeTab={activeTab} onTabChange={setActiveTab} onEnrich={()=>{if(selectedId)void research('selected',[selectedId]);}} enriching={busy}/></div><AiHelper companyId={selectedId}/></div></section>}
      <footer className="app-footer"><span>Research runs only when requested · Existing values are preserved</span><span>Enrichment: Luna low · Assistant: Luna medium</span></footer>
  </section>;
}
