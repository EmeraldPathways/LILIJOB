import { describe, it, expect } from 'vitest';
import { sectorCompanies, sectorPath, SIDEBAR_SECTORS } from '../../lib/workbench/sector-workspace';
import type { CompanyListItem } from '../../lib/repositories/company-repository';
const rows=[
 {id:'a',sector:'E-commerce',categories:[],permitSignal:'unknown'},
 {id:'b',sector:'Startup',categories:[],permitSignal:'unknown'},
 {id:'c',sector:'Fintech',categories:['work-permit'],permitSignal:'confirmed'},
 {id:'d',sector:'Tech Permits',categories:[],permitSignal:'unknown'},
] as unknown as CompanyListItem[];
describe('permanent sector navigation',()=>{
 it('includes all four sections even when no companies exist',()=>{
  expect(SIDEBAR_SECTORS.map(item=>item.label)).toEqual(['Ecommerce','Startups','Tech Permits','Fintech']);
 });
 it('routes canonical sector aliases to their dedicated sections',()=>{
  expect(sectorPath('E-commerce')).toBe('/sectors/ecommerce');expect(sectorPath('work-permit')).toBe('/sectors/tech-permits');
  expect(sectorCompanies(rows,'Ecommerce').map(item=>item.id)).toEqual(['a']);
  expect(sectorCompanies(rows,'Startups').map(item=>item.id)).toEqual(['b']);
  expect(sectorCompanies(rows,'Tech Permits').map(item=>item.id)).toEqual(['c','d']);
  expect(sectorCompanies(rows,'Fintech').map(item=>item.id)).toEqual(['c']);
 });
});
