# Dublin Tech Compass Reliability Audit and Repair Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the private Dublin Tech Compass workbench reliable across imports, enrichment, navigation, AI, settings, history, export, and responsive desktop/mobile use before handover.

**Architecture:** Preserve the existing Sites/Vinext, D1, R2, and owner-scoped repository architecture. Repair the import lifecycle first, then validate each API/page boundary against the approved workbench specification and add only the missing behavior required for a complete first release.

**Tech Stack:** TypeScript, React 19, Vinext/Next 16, Cloudflare Workers, D1, R2, Drizzle ORM, Vitest, Tailwind CSS, and Sites deployment tooling.

**Spec:** `docs/superpowers/specs/2026-10-14-dublin-tech-company-research-workbench-design.md`

## Global Constraints

- Preserve the existing owner-private Site and project ID.
- Keep all structured records owner-scoped by the authenticated Sites user ID.
- Keep original uploads private in R2 and keep API keys server-side.
- County Dublin remains the only accepted geography.
- Upload acknowledgement must not wait for all enrichment work.
- Confirmed sponsorship and potentially qualifying roles remain separate evidence types.
- Enrichment remains non-destructive and retryable.
- Desktop and mobile must expose the same core operations with usable responsive layouts.

## Review Focus

- A server page must not pass event handlers into client components; every protected page must render successfully for an authenticated user.
- A successful upload must be visible in the Imports page with its stored status, row counts, errors, and linked run.
- Large imports must not exceed D1 parameter limits, exhaust request time, or launch unbounded provider concurrency.
- Discovery must persist real company IDs and start enrichment rather than only reporting names.
- Every navigation tab and operational control must have a working route, loading state, error state, and owner boundary.
- Responsive layouts must avoid nested scroll traps, clipped controls, and inaccessible dialogs.

### Task 1: Reproduce and repair the import page/lifecycle

**Files:**
- Modify: `app/imports/page.tsx`, `components/workbench/import-dialog.tsx`
- Create: `components/workbench/imports-panel.tsx`
- Modify: `lib/import/import-service.ts`, `app/api/imports/route.ts`, `app/api/imports/[importId]/route.ts`
- Test: `tests/imports/import-ui.test.tsx`, `tests/imports/import-service.test.ts`

- [x] Write failing tests for authenticated Imports-page rendering, import history visibility, unique queued company IDs, and partial/error status display.
- [x] Run the focused tests and confirm they fail for the current page boundary and lifecycle behavior.
- [x] Make the dialog callback optional, add a client Imports panel that reads `/api/imports`, and render persisted import summaries with refresh/status information.
- [x] Make company queueing idempotent and ensure failed persistence cleans up the uploaded object or reports a durable failure state.
- [x] Run focused import tests and the full test suite.

### Task 2: Make background enrichment bounded and resumable

**Files:**
- Modify: `lib/import/auto-enrich.ts`, `app/api/imports/[importId]/enrich/route.ts`, `components/workbench/import-dialog.tsx`
- Modify: `db/schema.ts` and migrations only if the queue state requires it.
- Test: `tests/imports/auto-enrich.test.ts`, `tests/imports/enrichment-queue.test.ts`

- [x] Add a failing test proving enrichment uses bounded batches/concurrency and returns a resumable summary.
- [x] Implement bounded processing and client-visible continuation without launching one provider request fan-out for the entire file.
- [x] Persist import and run progress after each batch, preserve partial failures, and allow retrying incomplete work.
- [x] Verify a 318-row fixture stays within request/database limits.

### Task 3: Repair research, discovery, refresh, and provider behavior

**Files:**
- Modify: `lib/research/run-worker.ts`, `lib/research/enrichment-service.ts`, `lib/research/openai-search-provider.ts`, `lib/research/claim-extractor.ts`
- Modify: `app/api/discovery/route.ts`, `app/api/refresh/route.ts`, `app/api/enrichment/route.ts`
- Test: `tests/research/run-worker.test.ts`, `tests/research/enrichment-service.test.ts`, `tests/research/openai-search-provider.test.ts`

- [x] Add failing tests for real discovered IDs, automatic discovery enrichment, bounded manual refresh, provider configuration errors, and job/role claim persistence.
- [x] Make discovery return and queue actual company IDs, count only newly inserted companies, and continue after duplicate results.
- [x] Make refreshes bounded, retryable, and visibly accounted for rather than running an unbounded synchronous request.
- [x] Ensure extracted careers, roles, contacts, permit evidence, sources, and change history are written with idempotent keys.
- [x] Verify hybrid routing: routine research uses OpenAI web search and bespoke AI requests use Tavily.

### Task 4: Complete operational pages and API contracts

**Files:**
- Modify: `app/history/page.tsx`, `components/history/run-table.tsx`, `app/settings/page.tsx`, `components/settings/usage-limits.tsx`
- Modify: `app/api/history/route.ts`, `app/api/settings/route.ts`, `app/api/weekly-refresh/route.ts`, `app/api/exports/route.ts`
- Create/modify: `tests/ui/operational-pages.test.tsx`, `tests/api/route-contracts.test.ts`

- [x] Add failing tests for status/error states, settings validation, history retry visibility, export fields, and unauthenticated responses.
- [x] Surface persisted imports and run failures with retry actions and clear empty/loading/error states.
- [x] Validate settings payloads server-side and display provider usage, estimated cost, and pause state where available.
- [x] Ensure export output includes the agreed company fields and remains owner-scoped.

### Task 5: Complete dashboard tabs, profile data, and responsive interactions

**Files:**
- Modify: `components/workbench/app-shell.tsx`, `components/workbench/company-list.tsx`, `components/workbench/company-detail.tsx`, `components/workbench/filter-sheet.tsx`, `app/globals.css`
- Create: `app/company/[companyId]/page.tsx` if the dedicated profile route remains absent.
- Test: `tests/ui/workbench-layout.test.tsx`, `tests/ui/responsive-contract.test.tsx`

- [x] Add failing tests for all four research lenses, list filters, profile tabs, refresh controls, mobile navigation, focusable dialogs, and long/empty states.
- [x] Wire missing role/contact/careers/profile fields and stable company selection/navigation.
- [x] Preserve the single mobile page scroll while retaining desktop split-pane scrolling.
- [x] Verify controls remain reachable at narrow widths and tab contents do not disappear during scroll.

### Task 6: Verify the complete product against the approved plan

**Files:**
- Modify: `tests/integration/private-flow.test.ts`
- Create: `docs/superpowers/reports/2026-10-14-dublin-tech-compass-audit.md`

- [x] Run deterministic end-to-end fixtures for upload, database reads, enrichment continuation, discovery, refresh, AI, settings, history, and export.
- [x] Run route/auth checks and inspect the client bundle for secret leakage.
- [x] Run production-equivalent build, lint, TypeScript, and migration checks.
- [x] Perform available desktop/mobile visual verification and document any browser-access limitation.
- [x] Publish the verified private Site, check worker logs, and hand over the deployed URL and tested feature matrix.
