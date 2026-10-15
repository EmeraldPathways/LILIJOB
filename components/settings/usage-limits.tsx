"use client";

import Link from "next/link";

export function UsageLimits() {
  return <section className="settings-card">
    <p className="eyebrow">Research controls</p><h2 className="mt-1 text-xl font-semibold text-slate-900">Choose when to spend on research</h2>
    <div className="usage-summary" aria-label="Research settings"><div><strong>Low</strong><span>GPT-5.6 Luna enrichment</span></div><div><strong>Medium</strong><span>GPT-5.6 Luna assistant</span></div><div><strong>1</strong><span>maximum research request per company per attempt</span></div></div>
    <p className="mt-5 text-sm leading-6 text-slate-600">Importing, editing and viewing your spreadsheet do not trigger paid research. Choose Research selected or Research all in sector when you want new evidence. Existing spreadsheet values are preserved; enrichment fills gaps.</p>
    <p className="mt-3 text-sm leading-6 text-slate-500">Automatic weekly research is disabled. You can stop a batch after the current company and resume it from the workspace or Research history.</p>
    <Link href="/" className="primary-button mt-5">Back to company workspace</Link>
  </section>;
}
