# Dublin Tech Compass Version 4 release report

Status: **NOT RELEASED — implementation complete locally; release gates remain blocked**

Branch: `version4-interview-engine`
Base: `b1b2e146adf07d09d28f78015ea9560ed7607575`
Implementation commit: `079eb2e` (`feat: implement Dublin Tech Compass Version 4`)
Live site currently associated with the project: `https://dublin-tech-compass.emeraldpathways.chatgpt.site`

The branch was created before product changes. Existing company records and source values were preserved. No production import, migration, enrichment, Gmail send or production deployment was performed.

## Executive result

The ten Version 4 feature areas have local implementations, persistence paths, route coverage, UI surfaces and automated tests. The application is not being declared fully accepted because several plan requirements need an authenticated staging/live environment, real provider credentials or explicit user approval. Those gates are recorded below rather than inferred from local unit tests.

## Implemented locally

1. Personal opportunity ranking: owner-scoped candidate profile/evidence records, versioning, deterministic 0–100 ranking, hard constraints, explanations, star/dismiss/override and snapshot-aware inputs.
2. Live Job Radar: safe official-source handling, JSON-LD/anchor parsing, Greenhouse/Lever feeds, discovery runs, snapshots/diffs, invalid-source reporting, cancellation/retry and two-miss removal hysteresis.
3. Recruiter and hiring-team finder: sourced public contacts, classification, quality, correction and do-not-contact controls, plus hiring-signal scoring, expiry, deduplication and suppression.
4. Application CRM: canonical stages, immutable events, duplicate protection, follow-up actions, Kanban/table/mobile-safe controls, pack linkage and CSV export.
5. AI application packs: evidence-constrained deterministic generation, optional OpenAI low-reasoning generation, approved-evidence and numeric-claim validation, word caps and deterministic fallback.
6. Sector pitch engine: substantive E-commerce, Startups, Fintech and Work Permit playbooks with approved evidence references and versioned edits.
7. Hiring-trigger intelligence: dated possible-signal labels, reliability/relevance scoring, primary-source preference, expiry and correction/suppression routes.
8. Dublin and permit reality: effective-dated rules, Dublin evidence, explicit unknown/cannot-determine states, owner-scoped evaluation and admin-restricted rule changes.
9. Interview preparation: Europe/Dublin schedule validation, UTC storage, source-backed brief, predictions, approved STAR evidence, editable practice Q&A/self-evaluation, outcome and follow-up approval, printable export.
10. Command Centre and agent: database-backed KPIs/actions/funnel, 20 validated tools, prompt-injection markers, search/token/cost/step budgets, checkpoints, cancel/resume/retry and visible controls.

The existing sector workspace, Sheet/Detailed views, on-demand company enrichment, imports, settings, Gmail area and sidebar navigation were retained and integrated with the new surfaces. The sidebar now keeps pages beside the shell and includes Ecommerce, Startups, Tech Permits and Fintech.

## Data and persistence evidence

- Supplied workbook was audited read-only: 991 source rows; Fintech 316, Tech Permits 270, Ecommerce 155 and Startups 250.
- Existing reconciliation contains 769 accepted companies, 222 duplicate source rows and 0 stored import errors. Source fields remain preserved and existing records remain `not-enriched` until explicitly enriched.
- Version 4 uses additive schema objects and a repeat-safe migration runner containing 59 DDL/index statements. Fresh-database, repeat-migration, persistence, owner-isolation and backfill tests pass locally.
- A staging backup/count manifest and staging migration have not been run because no staging access was available. Production was not mutated.

## Test evidence

Executed locally on 2026-10-15:

- `pnpm test`: **PASS — 77 test files, 292 passed, 1 skipped**.
- `pnpm exec tsc --noEmit --pretty false`: **PASS**.
- `pnpm lint`: **PASS**.
- `pnpm build`: **PASS — Vinext production build completed and included the Version 4 page/API routes**.
- `git diff --check`: **PASS**.
- Import/security/UI focused checks: **PASS — 7 files, 23 passed, 1 skipped**.
- Agent focused checks: **PASS — 3 files, 24 passed**.
- Interview focused checks: **PASS — 3 files, 19 passed**.
- Permit/signal/intelligence focused checks: **PASS — 5 files, 32 passed**.

The detailed command record is in [`docs/v4-test-evidence.md`](./v4-test-evidence.md). The acceptance matrix is in [`docs/v4-feature-acceptance.md`](./v4-feature-acceptance.md), and the phase checklist is in [`docs/v4-execution-checklist.md`](./v4-execution-checklist.md).

## Genuine blockers and unverified gates

- **Desktop/mobile browser QA:** not claimed. The available browser session redirected the live URL to OpenAI authentication, and no authenticated staging URL was available. Required widths are 320, 375, 390, 768, 1024, 1440 and 1920px.
- **Live Job Radar evidence:** not claimed. The required sample of 20 permitted official careers pages and 10 current ranked roles needs reachable live/staging sources.
- **Gmail:** not claimed. A connected OAuth account and explicit authorization for one controlled test-inbox message are required. No recruiter was contacted.
- **Staging/release:** not claimed. Migration, backup/count verification, deployment and post-release smoke testing need staging access and explicit production deployment authorization.
- **Local browser smoke:** Wrangler preview was blocked by the environment error `uv_interface_addresses returned Unknown system error 1`; the local automated route and repository tests remain valid, but this is not browser evidence.
- **Security gate:** `pnpm audit --prod --audit-level high` reported 16 vulnerabilities: 2 low, 6 moderate, 7 high and 1 critical. Reported production paths include Next.js 16.3.4, SheetJS `xlsx@0.18.5`, Browserslist, source-map-js and sharp. No release claim is made until patched versions or a documented risk decision are accepted.

## Deployment status

No deployment was performed. The existing live URL has not been promoted from this branch, and no live verification is claimed. Deployment requires explicit authorization plus staging migration proof, browser/provider QA, security disposition and post-release count verification.

## Handoff

The implementation is committed locally and is ready to push as `version4-interview-engine`. The branch should be reviewed and deployed only after the blockers above are resolved.
