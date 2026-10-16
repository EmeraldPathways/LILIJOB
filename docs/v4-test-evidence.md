# Version 4 test evidence

This record distinguishes executed evidence from intended behaviour. No browser, Gmail, staging or production result is marked PASS without an observed response.

## Baseline — 2026-10-15

- `node node_modules/vitest/vitest.mjs run --maxWorkers=2` — PASS: 47 files, 154 passing tests, 1 skipped.
- `node node_modules/typescript/bin/tsc --noEmit` — PASS.
- `node node_modules/eslint/bin/eslint.js . --ignore-pattern dist --ignore-pattern .next` — PASS.
- `node scripts/build-with-retained-assets.mjs` — PASS: Vinext build completed.
- Read-only source audit — PASS: 991 workbook rows, 769 accepted unique companies, 222 duplicates, 0 stored import errors; sector source counts 316/270/155/250.
- Existing records — PASS: source values were preserved and existing records remained `not-enriched`; no production enrichment was run.
- Live browser baseline — **BLOCKED**: the live Site redirected to `https://auth.openai.com/log-in` in the available browser session.

## Final local automated evidence — 2026-10-15

- `pnpm test` — **PASS: 77 test files, 292 passed, 1 skipped**.
- `pnpm exec tsc --noEmit --pretty false` — **PASS**.
- `pnpm lint` — **PASS**: full repository ESLint run.
- `pnpm build` — **PASS**: Vinext production build completed and listed the V4 page/API routes, including agent cancel/resume/retry, packs, interviews, permit, signals, pitches and profiles.
- `git diff --check` — **PASS**.
- Focused import/security/UI checks — **PASS: 7 files, 23 passed, 1 skipped**, including 10 MB upload rejection, parser/persistence, application-pack/AI low-effort validation, operational pages and responsive contracts.
- Agent focused checks — **PASS: 3 files, 24 passed**.
- Interview focused checks — **PASS: 3 files, 19 passed**.
- Permit/signal/intelligence focused checks — **PASS: 5 files, 32 passed**.
- `pnpm audit --prod --audit-level high` — **BLOCKED/FAIL**: 16 vulnerabilities reported (2 low, 6 moderate, 7 high, 1 critical). Reported production paths include Next.js `16.3.4`, SheetJS `xlsx@0.18.5`, Browserslist, source-map-js and sharp. No release claim is made until patched versions or a documented risk decision exist.

## Feature and persistence evidence

- Migration runner tests — PASS: fresh SQLite database, repeat-safe execution and legacy table preservation; current migration list contains 59 additive DDL/index statements.
- Repository tests — PASS: owner isolation, profile versioning, approved evidence, application events/packs, interviews, contacts, signals, permits and backfill paths.
- Job Radar fixtures — PASS: JSON-LD, anchors, Greenhouse/Lever feeds, safe redirect limits, 403/429/error statuses, SSRF rejection and two-miss removal hysteresis.
- Ranking fixtures — PASS: deterministic bounded score, hard constraints, evidence explanations and snapshot requirement text.
- Outreach fixtures/routes — PASS: no guessed email, do-not-contact, draft→approve→send boundaries, provider-confirmed message state and idempotency.
- Interview fixtures/routes — PASS: Europe/Dublin validation, UTC storage, source date validation, editable practice Q&A revision, outcome/follow-up approval and printable export.
- Agent fixtures/routes — PASS: 20 registered tools, argument validation, prompt-injection markers, token/search/cost/step budgets, checkpointing, cancellation, resume, retry and blocked external tools.

## External and browser evidence still required

- Desktop/mobile browser QA at 320, 375, 390, 768, 1024, 1440 and 1920 px — **BLOCKED** by unavailable authenticated staging/live browser access.
- At least 20 permitted official careers pages and 10 high-ranked live roles — **BLOCKED** until a reachable authenticated staging run can be performed and sampled.
- Controlled Gmail OAuth/draft/test-inbox send/revocation — **BLOCKED** pending connected Gmail credentials and explicit test-message authorization; no real recruiter was contacted.
- Staging migration/backfill, backup manifest and count verification — **BLOCKED** pending deployment access.
- Production deployment and smoke test — **BLOCKED** pending explicit authorization; the branch has not been promoted.
- Local Wrangler built-preview smoke — **BLOCKED** by environment error `uv_interface_addresses returned Unknown system error 1`; the automated route/unit evidence above remains valid, but this is not a browser smoke result.

## Completion pass — 16 October 2026

This section supersedes earlier missing-capability and dependency statuses above.

- Fresh integrated run: 95 files, 376 passed, one skipped.
- `pnpm exec tsc --noEmit --pretty false`: PASS after schedule fixture typing correction.
- `pnpm build`: PASS, all V4 and new saved-search/notification/schedule routes present.
- Focused document tests: real PDF and DOCX extraction/export round-trips, pagination, invalid signature and owner-scoped upload.
- Release self-test: actual SQLite-backed D1 service flow and cleanup after injected database failure; foreign-owner company remains intact.
- Metrics regression: multiple profiles matching the same job count as one high-fit live job.
- Source scope: rejects unsaved callers, domain sale and partner pages; bounded detail fetch promotes only verified JobPosting/explicit trusted ATS feed results.
- Agent: atomic claims, stale-lease recovery, persistent cancellation, internal CRM record changes, real private export URLs, estimated-vs-actual cost labeling.
- Production dependency audit: no high/critical findings; one moderate unused Mammoth CLI `sprintf-js` finding remains disclosed.
- Before migration, production backup HTTP 200 and R2 size readback confirmed; 769 companies and all 991 memberships preserved at baseline.

Browser widths and controlled Gmail send remain unverified; production receipt will be appended only after observed checks.

### Production evidence — version 20

11/11 isolated workflow steps PASS on hosted D1. Synthetic cleanup PASS, remainingRows 0. PDF/DOCX bytes generated on Worker. Cross-owner application lookup denied. Actual low-reasoning OpenAI connectivity PASS (18 tokens, synthetic prompt only). Exact production row preservation PASS for all 769 companies, 991 category mappings and one import. All V4 migrations observed through new-table readback. Gmail provider configuration present but connected accounts=0; OAuth/send test BLOCKED pending user connection and one individually approved test message.
