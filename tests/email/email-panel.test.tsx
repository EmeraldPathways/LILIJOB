import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmailPanel } from '../../components/email/email-panel';
describe('company email workspace',()=>{
 it('provides an explicit send flow and starts without claiming Gmail is connected',()=>{
  const html=renderToStaticMarkup(<EmailPanel/>);
  expect(html).toContain('Email companies');expect(html).toContain('Subject');expect(html).toContain('Message');expect(html).toContain('Review recipients');expect(html).toContain('Send individually');expect(html).not.toContain('Gmail connected');expect(html).toContain('Add or update a company email');expect(html).toContain('Save email address');
 });
});
