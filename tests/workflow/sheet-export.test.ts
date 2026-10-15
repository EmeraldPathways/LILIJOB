import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
vi.mock('../../lib/repositories/company-repository',()=>({listCompanies:async()=>[
 {id:'a',name:'Alpha',sector:'Fintech',website:null,locality:null,categories:[],importedData:{Sector:'Fintech',Notes:'=1+1',Balance:'-12.5'}},
 {id:'b',name:'Beta',sector:'Fintech',website:null,locality:null,categories:[],importedData:{Sector:'Fintech','CRM code':'B-9'}},
 {id:'c',name:'Health',sector:'Healthcare',website:null,locality:null,categories:[],importedData:{Sector:'Healthcare'}}
]}));
import { GET } from '../../app/api/exports/route';
const request=(format:string)=>new Request(`https://site/api/exports?format=${format}&sector=Fintech`,{headers:{'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test'}});
describe('sector spreadsheet export',()=>{
 it('keeps columns aligned even when uploaded rows have different columns',async()=>{
  const response=await GET(request('csv'));
  const workbook=XLSX.read(await response.text(),{type:'string'});
  const rows=XLSX.utils.sheet_to_json<Record<string,string>>(workbook.Sheets[workbook.SheetNames[0]],{defval:''});
  expect(rows).toHaveLength(2);expect(rows[0].Notes).toBe("'=1+1");expect(Number(rows[0].Balance)).toBe(-12.5);expect(rows[1]['CRM code']).toBe('B-9');expect(rows[1].Notes).toBe('');
 });
 it('includes raw spreadsheet cells in the current-sector Excel file',async()=>{
  const response=await GET(request('xlsx'));
  const workbook=XLSX.read(await response.arrayBuffer());
  const rows=XLSX.utils.sheet_to_json<Record<string,string>>(workbook.Sheets[workbook.SheetNames[0]],{defval:''});
  expect(rows).toHaveLength(2);expect(rows[1]['CRM code']).toBe('B-9');expect(rows[1].Sector).toBe('Fintech');
 });
});
