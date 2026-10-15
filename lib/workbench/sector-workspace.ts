import type { CompanyListItem } from '../repositories/company-repository';
import { CATEGORY_LABELS } from '../domain/constants';
import type { CompanyCategory } from '../domain/types';

export const ALL_SECTORS = 'All sectors';
export const UNASSIGNED_SECTOR = 'Unassigned';
export function sectorName(company: CompanyListItem): string {
  return company.sector?.trim() || (company.categories[0] ? CATEGORY_LABELS[company.categories[0]] : UNASSIGNED_SECTOR);
}
export function sectorChoices(companies: CompanyListItem[]): string[] {
  const labels=new Map<string,string>();
  for(const company of companies){const label=sectorName(company);if(!labels.has(label.toLowerCase()))labels.set(label.toLowerCase(),label);}
  return [...labels.values()].sort((a,b)=>a.localeCompare(b));
}
export function sectorCompanies(companies: CompanyListItem[], sector: string): CompanyListItem[] {
  return sector === ALL_SECTORS ? companies : companies.filter(company=>sectorName(company).toLowerCase()===sector.toLowerCase());
}
export function researchTargets(companies: CompanyListItem[], sector:string, scope:'all'|'selected', selectedIds:readonly string[]):string[] {
  if(scope==='all' && sector===ALL_SECTORS) throw new Error('Choose a sector before researching all companies.');
  const selected = new Set(selectedIds);
  return sectorCompanies(companies,sector).filter(company=>scope==='all'||selected.has(company.id)).map(company=>company.id);
}
export function categoryForSector(sector:string):CompanyCategory {
  const lowered=sector.toLowerCase();
  if(lowered.includes('permit')) return 'work-permit';
  if(lowered.includes('startup')) return 'startups';
  if(lowered.includes('commerce')) return 'e-commerce';
  return 'fintech';
}
