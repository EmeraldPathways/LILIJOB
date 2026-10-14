# Dublin Tech Company Research Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private Sites full-stack workbench that imports company spreadsheets, enriches and discovers County Dublin technology employers, and provides a GPT‑5.6 Luna research assistant.

**Architecture:** Use the Sites Vinext starter with a React/Next-style client, Cloudflare Worker server routes, D1 for normalized company intelligence, and R2 for uploads and exports. A server-side research pipeline calls OpenAI for the agent and web research, with an optional paid search-provider adapter, while scheduled Site work reuses the same idempotent refresh functions as manual actions.

**Tech Stack:** TypeScript, React 19, Vinext/Next 16, Cloudflare Workers, D1, R2, Drizzle ORM, Zod, Tailwind CSS, shadcn UI components, OpenAI Responses API, optional Tavily-compatible search API, Vitest, and Sites deployment tooling.

**Spec:** `docs/superpowers/specs/2026-10-14-dublin-tech-company-research-workbench-design.md`

## Global Constraints

- The Site remains private and requires Sites/ChatGPT authentication.
- Geography is County Dublin only: Dublin City, Fingal, South Dublin, and Dún Laoghaire–Rathdown.
- Initial categories are Work Permit Companies, Startups, Fintech, and E-commerce; a company may belong to multiple categories.
- CSV/XLSX uploads automatically begin enrichment.
- Fresh findings are saved automatically with source links, checked dates, confidence, and change history.
- Existing records refresh weekly and expose a manual Refresh now action.
- The initial weekly schedule is Sunday at 03:00 in `Europe/Dublin`.
- Default weekly guardrails are 25 new companies per category, 6 meaningful source searches per company, and 500 existing-company refreshes.
- The model setting `OPENAI_MODEL` defaults to `gpt-5.6-luna` and remains configurable.
- D1 stores structured data; R2 stores private uploads and exports.
- API keys remain server-side Site secrets; no custom OAuth/session stack is introduced.
- Permit evidence must distinguish confirmed sponsorship from potentially qualifying roles.
- The desktop default is Split Workspace; mobile uses a category dropdown, card list, full profile view, bottom-sheet filters, and full-screen AI.
- Deletion is a user-controlled interface action; automatic enrichment is non-destructive.

## Review Focus

- Varied spreadsheet headings, unknown columns, blank rows, duplicate domains, and duplicate company names must map safely or remain as metadata. **Pinned by Task 2 import tests.**
- Conflicting, stale, low-confidence, or weaker replacement claims must remain traceable instead of silently overwriting stronger evidence. **Pinned by Task 3 claim-merge tests.**
- Ambiguous or out-of-county locations must not enter County Dublin discovery simply because a company has an Irish presence. **Pinned by Tasks 1 and 3 location tests.**
- Search-provider timeouts, rate limits, malformed responses, and partial batches must retry safely and leave a visible run state. **Pinned by Task 3 pipeline tests.**
- Unauthenticated requests must be rejected and secrets must never appear in client output or browser responses. **Pinned by Tasks 2 and 7 security checks.**

---

### Task 1: Bootstrap the private Sites application and domain model

**Files:**
- Create: `.openai/hosting.json`
- Modify: `package.json`, `app/layout.tsx`, `app/globals.css`, `app/chatgpt-auth.ts`
- Modify: `db/schema.ts`, `db/index.ts`
- Create: `lib/domain/constants.ts`, `lib/domain/types.ts`, `lib/domain/normalize.ts`
- Create: `tests/domain/normalize.test.ts`
- Create: `tests/domain/location.test.ts`
- Create: generated Drizzle migration files under `drizzle/`

**Interfaces:**
- Produces `normalizeCompanyIdentity(input: RawCompanyIdentity): NormalizedCompanyIdentity`.
- Produces `isCountyDublinLocation(input: string): boolean` and `normalizeDublinLocality(input: string): DublinLocality | null`.
- Produces category constants and permit-evidence enums consumed by import, enrichment, API, and UI tasks.
- Produces Drizzle tables for `companies`, `company_categories`, `jobs`, `permit_evidence`, `contacts`, `sources`, `company_claims`, `change_history`, `imports`, `refresh_runs`, `ai_conversations`, `ai_messages`, and `saved_searches`.

- [ ] **Step 1: Run the Sites project setup and inspect the generated starter.**

  Run the Sites `project-setup.mjs` helper in the workspace, retain the Vinext starter, and confirm the starter's auth, D1, and build files before editing.

- [ ] **Step 2: Add the private Site manifest and application identity copy.**

  Set `.openai/hosting.json` to preserve the starter settings while declaring logical D1 and R2 bindings (`DB` and `BUCKET`). Replace the starter title and description with Dublin Tech Compass copy and preserve the Sites ChatGPT auth helpers.

- [ ] **Step 3: Define domain constants and normalization helpers.**

  Add typed category, permit-evidence, confidence, run-status, and source-type values. Normalize whitespace, punctuation, domains, aliases, company names, locality names, and County Dublin area names without discarding the original input.

- [ ] **Step 4: Write failing normalization and location tests.**

  Test case-insensitive domains, `www` removal, aliases, blank values, Dublin City/Fingal/South Dublin/Dún Laoghaire–Rathdown recognition, and rejection of Cork, Galway, generic Ireland, and ambiguous location text.

- [ ] **Step 5: Implement the D1 schema and owner-scoped indexes.**

  Define Drizzle tables and indexes for owner ID, canonical domain, normalized name, category, locality, freshness, run ID, and source URL. Keep source history and current claims separate as specified.

- [ ] **Step 6: Generate and inspect the first migration.**

  Run `npm run db:generate`, inspect the generated SQL for one-statement-per-prepare compatibility and nullable foreign keys, and commit the schema migration with the source.

- [ ] **Step 7: Run the domain test suite.**

  Run `npm test -- tests/domain/normalize.test.ts tests/domain/location.test.ts`. Expected: all tests pass.

- [ ] **Step 8: Commit the bootstrap and domain model.**

  ```bash
  git add .openai package.json app db lib/domain tests/domain drizzle
  git commit -m "feat: bootstrap Dublin company research domain"
  ```

### Task 2: Add authenticated repositories, spreadsheet imports, and core API routes

**Files:**
- Create: `lib/auth/require-user.ts`
- Create: `lib/repositories/company-repository.ts`, `lib/repositories/source-repository.ts`, `lib/repositories/run-repository.ts`
- Create: `lib/import/types.ts`, `lib/import/map-columns.ts`, `lib/import/parse-workbook.ts`, `lib/import/import-service.ts`
- Create: `app/api/companies/route.ts`, `app/api/companies/[companyId]/route.ts`
- Create: `app/api/imports/route.ts`, `app/api/imports/[importId]/route.ts`
- Create: `app/api/runs/[runId]/route.ts`
- Create: `app/api/exports/route.ts`
- Create: `tests/imports/map-columns.test.ts`, `tests/imports/import-service.test.ts`
- Create: `tests/api/auth-guard.test.ts`

**Interfaces:**
- `requireSiteUser(returnTo?: string): Promise<SiteUser>` rejects missing identity and returns the stable Sites user ID.
- `mapWorkbookColumns(headers: string[]): ColumnMapping` maps known aliases while retaining unknown columns.
- `importWorkbook(file: ArrayBuffer, ownerId: string): Promise<ImportSummary>` stores the original file in R2, upserts companies, and returns row counts and queued IDs.
- `listCompanies(ownerId: string, filters: CompanyFilters): Promise<CompanyListItem[]>` and `getCompanyDetail(ownerId: string, companyId: string): Promise<CompanyDetail>` are the read interfaces used by the dashboard and AI tools.
- All repositories require an owner ID and never return another user's records.

- [ ] **Step 1: Write failing column-mapping and import tests.**

  Cover aliases such as `company`, `company name`, `website`, `url`, `sector`, `location`, and `careers`; blank rows; unknown columns; duplicate domain/name rows; and preservation of original values.

- [ ] **Step 2: Implement `requireSiteUser` with Sites identity helpers.**

  Use the starter's server-only `getChatGPTUser`/`requireChatGPTUser` integration. Reject missing identity with the supported sign-in flow and enforce owner-scoped authorization in every route and repository.

- [ ] **Step 3: Implement workbook parsing and column mapping.**

  Parse CSV and XLSX input, normalize headers, map known fields, preserve unknown values as metadata, and return row-level validation errors without failing the complete import.

- [ ] **Step 4: Implement R2 upload storage and idempotent company upserts.**

  Store each original upload under an owner-scoped key, derive canonical identity using Task 1, merge duplicate rows, create an `imports` row, and create a `refresh_runs` row for queued enrichment.

- [ ] **Step 5: Implement company, import, run, and export routes.**

  Add authenticated GET/POST routes for lists, details, imports, import status, run status, and CSV/XLSX export. Return typed Zod-validated JSON and consistent error codes.

- [ ] **Step 6: Run import and auth tests.**

  Run `npm test -- tests/imports tests/api/auth-guard.test.ts`. Expected: varied headings, unknown columns, duplicate rows, and unauthenticated requests behave as specified.

- [ ] **Step 7: Commit the import and repository layer.**

  ```bash
  git add lib/auth lib/repositories lib/import app/api tests/imports tests/api
  git commit -m "feat: add authenticated imports and company APIs"
  ```

### Task 3: Build the sourced search and enrichment pipeline

**Files:**
- Create: `lib/research/types.ts`, `lib/research/search-provider.ts`
- Create: `lib/research/openai-search-provider.ts`, `lib/research/tavily-search-provider.ts`
- Create: `lib/research/source-policy.ts`, `lib/research/claim-extractor.ts`
- Create: `lib/research/claim-merger.ts`, `lib/research/enrichment-service.ts`
- Create: `lib/research/run-worker.ts`
- Create: `app/api/enrichment/route.ts`, `app/api/discovery/route.ts`, `app/api/refresh/route.ts`
- Create: `tests/research/source-policy.test.ts`, `tests/research/claim-merger.test.ts`
- Create: `tests/research/enrichment-service.test.ts`, `tests/research/run-worker.test.ts`

**Interfaces:**
- `SearchProvider.search(request: SearchRequest): Promise<SearchResult[]>` returns URL, title, snippet/content, provider, and retrieval status.
- `extractClaims(company: CompanySeed, results: SearchResult[]): Promise<ExtractedClaim[]>` returns typed claims with evidence and confidence.
- `mergeClaims(existing: Claim[], incoming: ExtractedClaim[], runId: string): MergeResult` preserves stronger or verified claims, conflicts, and history.
- `enrichCompany(ownerId: string, companyId: string, runId: string): Promise<EnrichmentSummary>` performs bounded, idempotent source searches and writes claims/jobs/contacts/permit evidence.
- `runDiscovery(ownerId: string, category: Category, limits: DiscoveryLimits): Promise<DiscoverySummary>` discovers and queues new County Dublin companies.

- [ ] **Step 1: Write failing source-policy and claim-merge tests.**

  Verify official company/careers and Irish permit sources receive higher priority, search snippets alone do not create high-confidence claims, confirmed sponsorship remains distinct from potential qualification, weaker findings do not overwrite stronger ones, and conflicts become visible history records.

- [ ] **Step 2: Define provider and extracted-claim schemas.**

  Add Zod schemas for search requests/results, source quality, company claims, jobs, permit evidence, contacts, and run counters. Include provider, query, URL, retrieval time, checked date, and confidence.

- [ ] **Step 3: Implement the OpenAI research provider and optional paid fallback.**

  Use server-side `OPENAI_API_KEY` and `OPENAI_MODEL` for the primary research path. Add a provider adapter selected by `SEARCH_PROVIDER`; support a Tavily-compatible HTTP provider when `TAVILY_API_KEY` is configured. Return explicit configuration errors rather than silently using fake data.

- [ ] **Step 4: Implement source prioritisation and claim extraction.**

  Generate bounded searches for official profile, careers, roles, permit evidence, Dublin locality, and category evidence. Parse results into typed claims and retain source excerpts and URLs.

- [ ] **Step 5: Implement idempotent claim merging and change history.**

  Upsert sources by normalized URL, jobs by company/title/location/source identity, and claims by field/source. Preserve old values in `change_history`, retain conflicting current claims, and mark stale/superseded claims explicitly.

- [ ] **Step 6: Implement enrichment, discovery, retries, and run accounting.**

  Process bounded batches with retry/backoff for timeouts and rate limits. Continue after individual source failure, update run counters, enforce the 25/6/500 defaults, and leave failed items retryable.

- [ ] **Step 7: Add authenticated enrichment, discovery, and refresh routes.**

  Add routes for upload-triggered enrichment, manual discovery, and manual refresh by company/category/all. Every route creates or reuses an idempotent run and returns progress information.

- [ ] **Step 8: Run research tests.**

  Run `npm test -- tests/research`. Expected: location filtering, source priority, conflict retention, retry behavior, partial failure accounting, and guardrails pass.

- [ ] **Step 9: Commit the research pipeline.**

  ```bash
  git add lib/research app/api/enrichment app/api/discovery app/api/refresh tests/research
  git commit -m "feat: add sourced company enrichment pipeline"
  ```

### Task 4: Implement the Split Workspace dashboard and responsive navigation

**Files:**
- Modify: `app/page.tsx`, `app/layout.tsx`, `app/globals.css`
- Create: `components/workbench/app-shell.tsx`, `components/workbench/sidebar.tsx`
- Create: `components/workbench/company-list.tsx`, `components/workbench/company-card.tsx`
- Create: `components/workbench/company-detail.tsx`, `components/workbench/company-tabs.tsx`
- Create: `components/workbench/status-badges.tsx`, `components/workbench/refresh-controls.tsx`
- Create: `components/workbench/import-dialog.tsx`, `components/workbench/filter-sheet.tsx`
- Create: `app/company/[companyId]/page.tsx`
- Create: `tests/ui/workbench-layout.test.tsx`

**Interfaces:**
- `AppShell` receives navigation state and renders desktop sidebar/mobile selector.
- `CompanyList` receives `CompanyListItem[]`, filters, selected ID, and selection callback.
- `CompanyDetail` receives `CompanyDetail` and exposes refresh and source-history callbacks.
- `RefreshControls` calls the Task 3 refresh routes and reports run progress.

- [ ] **Step 1: Write the failing layout test.**

  Assert the four category labels, split list/detail regions, Import file, Find companies, Refresh now, freshness labels, and mobile navigation labels render from representative fixtures.

- [ ] **Step 2: Implement the application shell and visual system.**

  Replace the starter placeholder with the navy/teal professional research workspace. Add accessible focus states, status text plus colour, responsive layout tokens, and the private user menu/sign-out link.

- [ ] **Step 3: Implement company list, filters, and selection.**

  Add search, category, locality, permit evidence, freshness, confidence, and open-role filters. Preserve selected company in the URL where practical.

- [ ] **Step 4: Implement the profile pane and source/history sections.**

  Render the agreed fields, job cards, permit evidence distinction, public contacts, source links, checked dates, confidence, and change history. Show partial/failed enrichment states.

- [ ] **Step 5: Implement import, discovery, refresh, and export controls.**

  Connect controls to authenticated routes, show progress/toasts, disable duplicate submissions, and expose run errors with retry actions.

- [ ] **Step 6: Implement mobile list-to-profile navigation and filter sheet.**

  Use the starter's responsive primitives so the list, profile, filters, AI entry point, and refresh controls remain usable on narrow screens.

- [ ] **Step 7: Run UI tests and lint.**

  Run `npm test -- tests/ui/workbench-layout.test.tsx` and `npm run lint`. Expected: layout assertions pass and lint reports no new errors.

- [ ] **Step 8: Commit the dashboard.**

  ```bash
  git add app components tests/ui
  git commit -m "feat: add responsive Split Workspace dashboard"
  ```

### Task 5: Add the GPT‑5.6 Luna AI helper and tool actions

**Files:**
- Create: `lib/ai/types.ts`, `lib/ai/client.ts`, `lib/ai/prompts.ts`
- Create: `lib/ai/tools.ts`, `lib/ai/agent.ts`, `lib/ai/citations.ts`
- Create: `app/api/ai/chat/route.ts`
- Create: `components/ai/ai-launcher.tsx`, `components/ai/ai-panel.tsx`, `components/ai/source-citation.tsx`
- Create: `app/ai/page.tsx`
- Create: `tests/ai/tools.test.ts`, `tests/ai/agent.test.ts`

**Interfaces:**
- `runResearchAgent(input: AgentInput, ownerId: string): Promise<AgentResponse>` uses saved-data tools first and fresh search tools when needed.
- `createAgentTools(ownerId: string): AgentToolSet` exposes search, compare, discover, refresh, inspect-run, save-finding, and export operations.
- `formatCitations(sources: Source[]): Citation[]` produces visible source links and checked dates.

- [ ] **Step 1: Write failing AI tool and citation tests.**

  Verify owner scoping, saved-data-first lookup, County Dublin filters, source citation formatting, sponsorship/potential qualification wording, and non-destructive refresh tool calls.

- [ ] **Step 2: Implement the server-side OpenAI client and model configuration.**

  Read `OPENAI_API_KEY` and `OPENAI_MODEL` only on the server, default the model to `gpt-5.6-luna`, validate response shape, and return actionable configuration/rate-limit errors.

- [ ] **Step 3: Implement agent tools against repository and research interfaces.**

  Add typed tools for saved search, company comparison, discovery, refresh, run inspection, sourced finding save, and export. Enforce owner ID and non-destructive action boundaries.

- [ ] **Step 4: Implement the research-agent loop and conversation persistence.**

  Persist user/assistant messages, tool calls, citations, and saved finding IDs. Start with D1 retrieval, then call fresh research only for current/missing questions, and state uncertainty explicitly.

- [ ] **Step 5: Implement the AI panel and quick actions.**

  Add the full-screen mobile panel, desktop panel/route, streaming or progressive status states, source cards, and quick actions: Find companies, Refresh this category, Find sponsorship evidence, Show stale records, and Compare selected companies.

- [ ] **Step 6: Run AI tests.**

  Run `npm test -- tests/ai`. Expected: tools remain owner-scoped, citations are present, fresh-search fallback is used only when required, and saved findings are persisted.

- [ ] **Step 7: Commit the AI helper.**

  ```bash
  git add lib/ai app/api/ai app/ai components/ai tests/ai
  git commit -m "feat: add sourced GPT Luna research assistant"
  ```

### Task 6: Add settings, run history, usage controls, exports, and weekly scheduling

**Files:**
- Create: `lib/jobs/weekly-refresh.ts`, `lib/jobs/run-config.ts`
- Create: `app/settings/page.tsx`, `app/history/page.tsx`, `app/imports/page.tsx`
- Create: `components/settings/usage-limits.tsx`, `components/history/run-table.tsx`
- Create: `app/api/settings/route.ts`, `app/api/history/route.ts`
- Modify: `.openai/hosting.json` if schedule/capability declarations are required
- Create: `tests/jobs/weekly-refresh.test.ts`, `tests/settings/usage-limits.test.ts`

**Interfaces:**
- `runWeeklyRefresh(ownerId: string, config: RunConfig): Promise<RunSummary>` refreshes existing records then discovers new companies using Task 3 services.
- `getRunConfig(ownerId: string): Promise<RunConfig>` and `saveRunConfig(ownerId: string, config: RunConfig): Promise<void>` manage editable limits and paused state.
- `listRefreshRuns(ownerId: string, filters: RunFilters): Promise<RefreshRun[]>` powers history and retry controls.

- [ ] **Step 1: Write failing weekly-run and limit tests.**

  Verify refresh-before-discovery ordering, 25/6/500 defaults, editable limits, paused schedules, continuation after a cap, and idempotent reruns.

- [ ] **Step 2: Implement owner-scoped run configuration and usage accounting.**

  Persist limits, pause state, provider usage, estimated cost, continuation cursor, and last successful run without exposing secrets.

- [ ] **Step 3: Implement the weekly writer.**

  Reuse Task 3 enrichment/discovery functions, process existing refreshes before discovery, and return a complete run summary to the Sites scheduler.

- [ ] **Step 4: Implement Settings, Imports, and Refresh history pages.**

  Show limits, pause/resume, API usage, estimated cost, import status, run counters, errors, and retry actions. Keep the pages owner-scoped.

- [ ] **Step 5: Configure the weekly Sites schedule.**

  After the Site exists and its private owner/schedule metadata is available, create or link the Sunday 03:00 `Europe/Dublin` recurring task. Preserve paused state and verify that a fresh scheduled invocation can read/write the Site.

- [ ] **Step 6: Run job and settings tests.**

  Run `npm test -- tests/jobs tests/settings`. Expected: limits, pause state, order, continuation, and run history pass.

- [ ] **Step 7: Commit operational controls.**

  ```bash
  git add lib/jobs app/settings app/history app/imports app/api/settings app/api/history components/settings components/history tests/jobs tests/settings .openai/hosting.json
  git commit -m "feat: add refresh controls and weekly operations"
  ```

### Task 7: Integrate, verify, package, and publish the private Site

**Files:**
- Modify: `package.json`, `.env.example`, `README.md`
- Modify: `app/error.tsx`, `app/loading.tsx` if required by observed states
- Create: `tests/integration/private-flow.test.ts`

**Interfaces:**
- The published Site exposes the authenticated dashboard, import, enrichment, AI, history, export, and settings flows defined in Tasks 1–6.

- [ ] **Step 1: Add a local end-to-end fixture flow.**

  Use a deterministic fixture provider to import a small CSV, enrich two County Dublin companies, reject an out-of-county company, refresh one record, and query the AI tool boundary without external calls.

- [ ] **Step 2: Run the full verification suite.**

  Run `npm test`, `npm run lint`, and `npm run build`. Expected: all tests pass, lint has no new errors, and the Sites build completes.

- [ ] **Step 3: Verify private-route and secret boundaries.**

  Inspect the built client and route responses to confirm no API key or private record is exposed to unauthenticated requests. Run the owner-scoping integration test.

- [ ] **Step 4: Install or confirm dependencies and package the Site.**

  Use the Sites dependency installer and source workflow, preserving the registered project ID, applying D1 migrations before the Worker upload, and creating an immutable deployment archive.

- [ ] **Step 5: Configure runtime secrets.**

  Configure key names through native Sites tools: `OPENAI_API_KEY`, `OPENAI_MODEL`, `SEARCH_PROVIDER`, and the fallback provider key when enabled. Keep values out of source and output.

- [ ] **Step 6: Publish as owner-private and verify deployment.**

  Save and deploy the private Site, poll only until a terminal status, open the deployed URL in the Site tab, and verify the dashboard shell, sign-in boundary, empty state, and refresh controls.

- [ ] **Step 7: Exercise one unattended writer and read back its run.**

  Invoke the scheduled writer through its supported Site access path, confirm a persisted `refresh_runs` record, and avoid waiting for the first scheduled occurrence.

- [ ] **Step 8: Commit release metadata.**

  ```bash
  git add package.json .env.example README.md app tests/integration
  git commit -m "chore: verify and publish private research workbench"
  ```

