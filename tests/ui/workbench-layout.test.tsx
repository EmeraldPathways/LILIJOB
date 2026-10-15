import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppShell } from '../../components/workbench/app-shell';
import type { CompanyListItem } from '../../lib/repositories/company-repository';
const user={displayName:'Researcher',email:'researcher@example.com'};
describe('Excel-first company workspace',()=>{
 it('starts with Sheet view and explicit research actions without starting searches',()=>{
  const html=renderToStaticMarkup(<AppShell user={user} initialCompanies={[]}/>);

  expect(html).toContain('Sheet view');expect(html).toContain('Detailed view');
  expect(html).toContain('Research selected');expect(html).toContain('Research all in sector');
  expect(html).toContain('Import file');expect(html).toContain('Research runs only when requested');
  expect(html).toContain('Luna low');expect(html).toContain('Luna medium');
 });
 it('keeps Settings and sector selection accessible on mobile',()=>{
  const html=renderToStaticMarkup(<AppShell user={user} initialCompanies={[]}/>);
  expect(html).not.toContain('target="_top"');expect(html).not.toContain('app-sidebar');
  expect(html).toContain('aria-label="Sector"');expect(html).toContain('aria-label="Company workspace"');
 });
 it('shows all raw imported columns in an arbitrary sector without category mappings',()=>{
  const company={id:'co-1',name:'Example Health',sector:'Healthcare',categories:[],importedData:{Company:'Example Health',Sector:'Healthcare','CRM notes':'Call in November'},enrichmentStatus:'not-enriched'} as unknown as CompanyListItem;
  const html=renderToStaticMarkup(<AppShell user={user} initialCompanies={[company]}/>);
  expect(html).toContain('County Dublin · Healthcare');expect(html).toContain('CRM notes');
  expect(html).toContain('Call in November');expect(html).toContain('Example Health');
 });
});
