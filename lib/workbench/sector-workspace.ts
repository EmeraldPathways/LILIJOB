import type { CompanyListItem } from '../repositories/company-repository';
import { CATEGORY_LABELS } from '../domain/constants';
import type { CompanyCategory } from '../domain/types';

export const ALL_SECTORS = 'All sectors';
export const UNASSIGNED_SECTOR = 'Unassigned';
export const SIDEBAR_SECTORS = [
  {slug:'ecommerce',label:'Ecommerce'},
  {slug:'startups',label:'Startups'},
  {slug:'tech-permits',label:'Tech Permits'},
  {slug:'fintech',label:'Fintech'},
] as const;
export function canonicalSector(value:string):string {
  const key=value.trim().toLowerCase().replace(/[^a-z0-9]/g,'');
  if(['ecommerce','ecommerces'].includes(key))return 'ecommerce';
  if(['startup','startups'].includes(key))return 'startups';
  if(['techpermit','techpermits','workpermit','workpermits','employmentpermit','employmentpermits'].includes(key))return 'tech-permits';
  if(key==='fintech')return 'fintech';
  return value.trim().toLowerCase();
}
export function sectorPath(value:string):string {
  const canonical=canonicalSector(value);
  const known=SIDEBAR_SECTORS.find(item=>item.slug===canonical);
  return value===ALL_SECTORS?'/':known?`/sectors/${known.slug}`:`/?sector=${encodeURIComponent(value)}`;
}

export function sectorName(company: CompanyListItem): string {
  return company.sector?.trim() || (company.categories[0] ? CATEGORY_LABELS[company.categories[0]] : UNASSIGNED_SECTOR);
}
export function sectorChoices(companies: CompanyListItem[]): string[] {
  const labels=new Map<string,string>();
  for(const company of companies){const label=sectorName(company);if(!labels.has(label.toLowerCase()))labels.set(label.toLowerCase(),label);}
  return [...labels.values()].sort((a,b)=>a.localeCompare(b));
}
export function sectorCompanies(companies: CompanyListItem[], sector: string): CompanyListItem[] {
  if(sector===ALL_SECTORS)return companies;
  const key=canonicalSector(sector);
  return companies.filter(company=>canonicalSector(sectorName(company))===key || (key==='tech-permits'&&(company.categories.includes('work-permit')||company.permitSignal==='confirmed'||company.permitSignal==='potential')));
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
