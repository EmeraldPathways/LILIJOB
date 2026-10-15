# Version 4 feature acceptance matrix

Status is evidence-based. A local test pass does not substitute for a required live provider, staging, browser or user-approval check.

| Feature | Status | Implemented evidence | Remaining acceptance work |
|---|---|---|---|
| 1. Personal opportunity ranking | **PARTIAL** | Candidate strategies, private document metadata, approved evidence, profile versioning, deterministic 0–100 ranking, snapshot-aware inputs, explanations, hard constraints, star/dismiss/override and owner-scoped tests. | PDF/DOCX extraction, richer compare/export evidence and deployed desktop/mobile verification. |
| 2. Live Job Radar | **PARTIAL** | Official URL/redirect safety, JSON-LD/anchor parsing, public Greenhouse/Lever feed shapes, source statuses, snapshots/diffs, removal hysteresis, run controls, report-invalid route and tests. | Scheduled daily/weekly execution and live sample of 20 permitted career pages/10 roles. |
| 3. Recruiter and hiring-team finder | **PARTIAL** | Public-contact classification, source URL/observed date, quality/correction/do-not-contact state, signal/contact repositories and tests. | Automated public-source discovery, richer role association and Gmail thread sync. |
| 4. Application CRM | **PARTIAL** | Canonical stages, owner-scoped applications/events, duplicate prevention, follow-up action items, Kanban/table UI, mobile-safe selectors, pack linkage and CSV export tests. | Deployed browser/race evidence and optional Gmail reply event sync. |
| 5. AI application pack | **PARTIAL** | Prepare action, deterministic evidence-constrained pack, optional OpenAI `gpt-5.6-luna` low-reasoning path, approved-evidence/numeric validation, fallback, versioned edits and printable export. | Live model/credential evidence, DOCX/PDF artifacts and full side-by-side acceptance UI. |
| 6. Sector pitch engine | **PARTIAL** | Substantive E-commerce, Startups, Fintech and Work Permit playbooks, approved evidence references, editable saved versions/revisions and tests. | Current source retrieval/citations, usage outcomes and document export. |
| 7. Hiring trigger intelligence | **PARTIAL** | Dated possible-signal labels, reliability/relevance scoring, primary-source preference, deduplication, expiry, suppression/correction routes and tests. | Permitted scheduled collection, notifications, comparable job-count surge and live source QA. |
| 8. Dublin and permit reality | **PARTIAL** | Dublin evidence labels, effective-dated rule registry, explicit unknown/cannot-determine states, admin restriction, evaluation persistence and tests. | Runtime DETE refresh and live legal-source verification; this remains evidence guidance, not legal advice. |
| 9. Interview preparation | **PARTIAL** | Europe/Dublin schedule validation, UTC storage, source-backed pack, prediction labels, approved STAR matching, editable practice Q&A/self-evaluation, outcome/follow-up approval, printable export and 19 focused tests. | Calendar integration is intentionally manual; deployed browser and live-source verification remain blocked. |
| 10. Command Centre and agent | **PARTIAL** | Database-backed KPIs/actions/funnel, 20-tool registry, owner-scoped validation, prompt-injection checks, budgets/checkpoints, safe external blocking, cancel/resume/retry and visible controls; 24 focused tests. | Scheduled orchestration, live provider spend, staging browser run and production observability. |

## Cross-feature gates

| Gate | Status | Evidence / blocker |
|---|---|---|
| Existing four sectors, imports, Sheet/Detailed views and enrichment-on-demand preserved | **PASS locally / browser blocked** | Existing import, sheet, detail, sector, settings and enrichment code/tests remain; live browser session was not authenticated. |
| Workbook traceability and preservation | **PASS read-only audit** | 991 rows, 769 accepted records, 222 duplicate rows, source fields retained; no production re-import was performed. |
| Approval boundary for external actions | **PASS automated** | Outreach and agent tests block unapproved sends/applies/schedules; Gmail controlled send remains untested. |
| Owner isolation / private records | **PASS automated** | Route/repository tests scope queries by authenticated owner. |
| Desktop/mobile UI | **BLOCKED** | No authenticated staging deployment/browser session available. |
| Gmail controlled test | **BLOCKED** | Requires connected OAuth and explicit test-inbox authorization. |
| Staging/production release | **BLOCKED** | No deployment authorization; dependency audit also reports 16 vulnerabilities. |
