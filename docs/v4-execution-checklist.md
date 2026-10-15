# Version 4 execution checklist

Branch: `version4-interview-engine`
Base: `Version4` / `b1b2e146adf07d09d28f78015ea9560ed7607575`
Started: 2026-10-15
Current status: **IMPLEMENTED LOCALLY; RELEASE GATES BLOCKED**

Evidence labels are strict: PASS means local code/test evidence exists; BLOCKED means an external environment, credential or approval is still required; PARTIAL means the local slice exists but the plan requires an unperformed live/browser check or a missing sub-capability.

## Phase 0 — Preflight

- [x] Repository, branch, Sites project and production URL identified; no remote was assumed locally.
- [x] Private owner-scoped auth and current live version recorded.
- [x] Baseline recorded: 47 files, 154 passing tests, 1 skipped; TypeScript, ESLint and build passed.
- [x] Supplied workbook audited read-only: 991 source rows, 812 raw case-insensitive name keys, 769 stored accepted companies, 222 duplicate source rows, 0 stored import errors.
- [x] Sector source counts recorded: Fintech 316, Tech Permits 270, Ecommerce 155, Startups 250.
- [x] Existing source values and `not-enriched` state verified; no production mutation was run.
- [x] Feature branch created before product changes.
- [x] Architecture, checklist, data audit and plan records created.
- [ ] **BLOCKED:** live navigation/API baseline sampling; the deployed URL redirected to OpenAI authentication in the available browser session.

## Phase 1 — Persistence

- [x] Additive Drizzle schema and D1 migration SQL for all Version 4 entities.
- [x] Repeat-safe 59-statement migration runner and bearer-protected migration route.
- [x] Owner-scoped repositories, indexes, uniqueness and versioned artifacts.
- [x] Re-runnable legacy job/source/contact backfill links with unknown values left unknown.
- [x] Fresh-database, repeat-migration, persistence and owner-isolation tests.
- [ ] **BLOCKED:** staging migration, backup/count manifest and production migration; no deployment authorization was supplied.

## Phase 2 — Candidate profile and ranking

- [x] Candidate strategies, approved evidence and private document metadata UI/API.
- [x] Profile version increment and snapshot-aware deterministic 0–100 ranking.
- [x] Hard constraints, confidence, matches, gaps, unknowns and manual star/dismiss/override persistence.
- [x] Opportunity routes/components and focused ranking/repository tests.
- [ ] **PARTIAL:** PDF/DOCX text extraction and deployed responsive browser evidence remain outstanding.

## Phase 3 — Job Radar

- [x] Official URL validation, safe redirects, JSON-LD/anchor parsing and public Greenhouse/Lever feed shapes.
- [x] Source statuses, discovery runs, snapshots, hashes, diffs, report-invalid route and two-miss removal hysteresis.
- [x] Owner-scoped job list/refresh/run/retry/cancel routes and Job Radar UI.
- [ ] **PARTIAL:** scheduled daily/weekly queues and live 20-page/10-role source sampling are not verified in this environment.

## Phase 4 — Contacts and hiring signals

- [x] Public-contact classification, provenance, quality, correction and do-not-contact state.
- [x] Dated signal scoring, primary-source preference, deduplication, expiry, suppression and correction routes.
- [x] Contact/signal repositories, UI and focused source-fidelity tests.
- [ ] **PARTIAL:** automated permitted public-source collection and live source QA remain unverified.

## Phase 5 — Dublin and permit reality

- [x] Effective-dated permit rules, source URL, unknown labels, Dublin evidence and role evaluation.
- [x] Admin-restricted rule updates and owner-scoped evaluation routes.
- [x] Rule/evaluation, date/salary/unknown and route tests.
- [ ] **BLOCKED:** runtime refresh against current DETE pages and legal-source verification require live external access and review.

## Phase 6 — Application CRM

- [x] Canonical stages, immutable events, duplicate protection, follow-up action items and owner-scoped exports.
- [x] Kanban/table/mobile-safe stage selector and application pack linkage in the app shell.
- [x] CRM, race/dedup, action and export tests.
- [ ] **PARTIAL:** deployed desktop/mobile interaction and Gmail reply/event sync remain unverified.

## Phase 7 — Application packs and sector pitches

- [x] Deterministic evidence-constrained pack and optional OpenAI pack generation with low reasoning, approved-ID and numeric-claim validation, and deterministic fallback.
- [x] Editable/versioned pack API and printable export route.
- [x] Four substantive sector playbooks, approved-evidence references, pitch version revisions and focused tests.
- [ ] **PARTIAL:** DOCX/PDF artifact pipeline and live model response evidence are not complete.

## Phase 8 — Gmail and outreach

- [x] Existing Gmail section preserved; Version 4 draft/approve/send routes reuse provider state.
- [x] No guessed email rule, do-not-contact enforcement, idempotency and provider-confirmed send-state tests.
- [ ] **BLOCKED:** controlled Gmail OAuth/sign-in and one user-authorised test-inbox send require connected credentials and explicit test authorization.

## Phase 9 — Interviews

- [x] Europe/Dublin schedule validation and UTC storage.
- [x] Source-backed preparation pack, prediction labels, approved STAR filtering, printable export and follow-up approval route.
- [x] Editable practice Q&A/self-evaluation backend and in-app preparation/outcome controls.
- [x] Interview repository/API tests: 19 focused tests passed.
- [ ] **PARTIAL:** Google Calendar sync is intentionally manual and deployed browser verification is blocked.

## Phase 10 — Command Centre and agent

- [x] Database-backed Today KPIs, action items, funnel and data-quality indicators.
- [x] 20-tool server registry, argument validation, prompt-injection markers, budgets, usage checkpoints and safe external-action blocking.
- [x] Cancel/resume/retry routes and visible run-control UI.
- [x] Agent focused tests: 24 passed; full suite includes agent coverage.
- [ ] **PARTIAL:** scheduled orchestration/live provider spend and deployed browser evidence are not verified.

## Phase 11 — Hardening

- [x] Full automated regression, TypeScript, ESLint, production build and diff-check pass after all local changes.
- [x] Owner/IDOR, SSRF, upload type/size, formula-safe CSV, no-guess-contact and approval-boundary tests are present.
- [ ] **BLOCKED:** browser QA at 320/375/390/768/1024/1440/1920px and live integration sampling require a reachable authenticated staging deployment.
- [ ] **BLOCKED:** dependency audit reports 16 vulnerabilities (including critical/high Next.js, SheetJS, Browserslist, source-map-js and sharp advisories); remediation or formal risk acceptance is required before release.

## Phase 12 — Release

- [ ] **BLOCKED:** pre-release backup/export and staging migration proof.
- [ ] **BLOCKED:** staging deployment and smoke test.
- [ ] **BLOCKED:** production migration/promotion; explicit authorization was not provided.
- [ ] **BLOCKED:** post-release production smoke test and count verification.
- [x] Documentation and final evidence artifacts are maintained; release report remains NOT RELEASED until external gates are resolved.
