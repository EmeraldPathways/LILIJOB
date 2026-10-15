import { describe, expect, it } from 'vitest';
import { sectorName, sectorChoices, sectorCompanies, researchTargets } from '../../lib/workbench/sector-workspace';
import type { CompanyListItem } from '../../lib/repositories/company-repository';
const rows = [
 { id:'a',name:'Alpha',sector:'Fintech',categories:[],importedData:{Company:'Alpha',Sector:'Fintech'} },
 { id:'b',name:'Beta',sector:'Fintech',categories:[],importedData:{Company:'Beta',Sector:'Fintech'} },
 { id:'c',name:'Gamma',sector:'Healthcare',categories:[],importedData:{Company:'Gamma',Sector:'Healthcare'} },
 { id:'d',name:'Delta',sector:null,categories:[] },
] as unknown as CompanyListItem[];
describe('sector workspace scope',()=>{
 it('supports arbitrary imported sectors and unassigned records',()=>{
  expect(sectorName(rows[2])).toBe('Healthcare');
  expect(sectorCompanies(rows,'Healthcare').map(r=>r.id)).toEqual(['c']);
  expect(sectorChoices(rows)).toContain('Healthcare');
  expect(sectorCompanies(rows,'Unassigned').map(r=>r.id)).toEqual(['d']);
 });
 it('research all snapshots the whole sector rather than visible filtered rows',()=>{
  expect(researchTargets(rows,'Fintech','all',[])).toEqual(['a','b']);
  expect(researchTargets(rows,'Fintech','selected',['b','c','b'])).toEqual(['b']);
 });
 it('requires a specific sector before Research all',()=>{
  expect(()=>researchTargets(rows,'All sectors','all',[])).toThrow('sector');
 });
});
