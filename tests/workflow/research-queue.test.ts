import { describe, expect, it } from 'vitest';
import { parseResearchCursor, researchStepResult } from '../../lib/workbench/research-queue';
describe('durable research queue',()=>{
 it('counts companies once and retains failed company IDs',()=>{
  expect(researchStepResult({remainingCompanyIds:['a','b'],retryableCompanyIds:[]},'a','failed')).toEqual({remainingCompanyIds:['b'],retryableCompanyIds:['a']});
  expect(researchStepResult({remainingCompanyIds:['b'],retryableCompanyIds:['a']},'b','completed')).toEqual({remainingCompanyIds:[],retryableCompanyIds:['a']});
 });
 it('sanitizes malformed or duplicate queue identifiers',()=>{
  expect(parseResearchCursor('{"remainingCompanyIds":["a","a",9],"retryableCompanyIds":[]}')).toEqual({remainingCompanyIds:['a'],retryableCompanyIds:[]});
  expect(parseResearchCursor('broken')).toEqual({remainingCompanyIds:[],retryableCompanyIds:[]});
 });
});
