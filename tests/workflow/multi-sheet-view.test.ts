import {describe,it,expect,vi} from 'vitest';
vi.mock('../../db',()=>({getDb:vi.fn()}));
import {companySheetFields, type CompanyListItem} from '../../lib/repositories/company-repository';
import {sectorCompanies,sectorChoices} from '../../lib/workbench/sector-workspace';
import {buildCompanyCellUpdatePlan} from '../../lib/sheet-data/cell-update';

describe('worksheet source data',()=>{
  const metadata={sector:'Payments',original:{Company:'Shared',Sector:'Payments'},collections:['Fintech','Startups'],sheetRows:{Fintech:{Company:'Shared',Sector:'Payments',Email:'finance@example.test'},Startups:{Company:'Shared',Sector:'Software',Email:'startup@example.test'}}};
  const fields=companySheetFields(JSON.stringify(metadata));
  const company={id:'shared',name:'Shared',categories:['fintech','startups'],permitSignal:'unknown',...fields} as CompanyListItem;
  it('uses worksheet membership independently from source industry',()=>{
    expect(sectorChoices([company])).toEqual(['Fintech','Startups']);
    expect(sectorCompanies([company],'Fintech')[0].importedData?.Email).toBe('finance@example.test');
    expect(sectorCompanies([company],'Startups')[0].importedData?.Sector).toBe('Software');
    expect(sectorCompanies([company],'Tech Permits')).toHaveLength(0);
  });
  it('edits one source tab without overwriting other tabs',()=>{
    const snapshot={name:'Shared',normalizedName:'shared',domain:null,website:null,aliasesJson:'[]',description:null,locality:null,locationText:null,employeeBand:null,foundedYear:null,metadataJson:JSON.stringify(metadata)};
    const plan=buildCompanyCellUpdatePlan(snapshot,{Email:'updated@example.test'},'Fintech');
    const result=JSON.parse(plan.updates.metadataJson!);
    expect(result.sheetRows.Fintech.Email).toBe('updated@example.test');
    expect(result.sheetRows.Startups.Email).toBe('startup@example.test');
    expect(plan.updateCategories).toBe(false);
  });
});
