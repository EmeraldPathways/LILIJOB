# Version 4 Interview Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Extend the private Dublin Tech Compass into a source-backed interview-generation workbench while preserving existing companies, imports, enrichment, AI research and Gmail workflows.

**Architecture:** Add owner-scoped D1 entities and repositories around the current companies/jobs/contacts/sources tables. Expose server-validated APIs and a single sidebar app shell; all generated content is editable and every external send/apply action requires explicit approval. Use additive migration and one-time migration control for production.

**Tech Stack:** Vinext/React/TypeScript, Cloudflare Worker, D1/Drizzle, R2, Vitest, XLSX, existing OpenAI/search/Gmail adapters.

**Spec:** `upload/Dublin_Tech_Compass_V4_Full_Build_Plan(1).md` (supplied implementation brief), with architecture captured in `docs/v4-architecture.md`.

## Global Constraints

- Preserve current company data, source provenance, four sector sections, enrichment, AI assistant, Gmail and private authentication.
- Every new record is owner-scoped and every factual external claim stores source URL and observed timestamp.
- Unknown eligibility, salary, dates and sponsorship remain unknown; models never create facts.
- Generated documents and messages require user review; sending/applying requires explicit approval.
- No guessed recruiter emails, LinkedIn scraping, portal bypass, bulk outbound messaging or secret in client code.
- Test before implementation for each behavior, then run focused and full suites.

## Review Focus

- Existing imported source rows must survive new projections — covered by migration/import regression tests.
- Shared company/domain and duplicate jobs must remain distinct — covered by identity/dedup tests.
- Unknown permit data must not become a legal conclusion — covered by rule evaluation tests.
- AI output must not invent metrics or trigger external actions — covered by evidence/approval/agent tests.
- Mobile navigation and stage changes must work without drag-and-drop — covered by responsive UI tests.

### Task 1: Phase 0 artefacts and baseline

- [x] Create branch and baseline documents.
- [x] Record baseline tests and live import evidence.
- [ ] Record live navigation/API observations and source/deployment comparison.

### Task 2: Phase 1 persistence

**Files:** `db/schema.ts`, `drizzle/0003_v4_interview_engine.sql`, `lib/v4/*`, migration route and tests.

- [ ] Add schema/types for profile, evidence, snapshots, discovery runs, matches, signals, recruitment contacts, applications/events, outreach, interviews/packs, action items, metrics, notifications, audit, agent runs/steps and settings versions.
- [ ] Write migration SQL and a protected migration handler; test fresh/partial/repeat cases.
- [ ] Add owner-scoped repositories and backfill links without modifying existing source fields.

### Task 3: Phase 2 candidate profile and ranking

**Files:** profile/match services, `/api/profile`, `/api/opportunities`, profile/opportunity UI and tests.

- [ ] Implement versioned profile/evidence intake, editable constraints and deterministic scoring.
- [ ] Persist explanations and match versions; add shortlist/dismiss/override/export.
- [ ] Test 0–100 bounds, hard constraints, evidence links, no invented skills and reload persistence.

### Task 4: Phase 3 job radar

**Files:** `lib/jobs/*`, job APIs/UI, schedule integration, fixtures/tests.

- [ ] Add official career/ATS adapters, discovery runs, snapshots, hashes/diffs and source statuses.
- [ ] Add deduplication, stale/removal hysteresis, filters, refresh and budget/checkpoint controls.
- [ ] Test repeated runs, 403/429, broken source, date ambiguity and real permitted career samples.

### Task 5: Phase 4 contacts and signals

**Files:** contact/signal services, routes/UI and tests.

- [ ] Classify imported contacts and add public-source evidence fields, review/suppress actions and signal entities.
- [ ] Deduplicate syndicated events, expire stale signals and calculate transparent relevance.
- [ ] Test generic inboxes, no guessed emails, opt-out and source fidelity.

### Task 6: Phase 5 Dublin and permit rules

**Files:** official rule registry, location/permit services/routes/UI/tests.

- [ ] Add effective-dated official rules and separate evidence labels.
- [ ] Evaluate location, remote/hybrid, salary/SOC/employment-date uncertainty with official source links.
- [ ] Test Dublin counties, non-Dublin, unknown salary, contracts and rule date changes.

### Task 7: Phase 6 application CRM

**Files:** application repositories/routes/UI/export and tests.

- [ ] Implement canonical stages, applications, immutable events, duplicate prevention and tasks.
- [ ] Add desktop Kanban, mobile accessible table/select controls, reminders and metrics events.
- [ ] Test transitions, refresh persistence, race cases, exports and accessibility.

### Task 8: Phases 7–8 application packs, pitches and Gmail

**Files:** pack/pitch services, outreach routes/UI, existing Gmail adapter and tests.

- [ ] Generate evidence-constrained editable packs and four sector playbooks.
- [ ] Reuse Gmail connection for preview, explicit per-send approval, idempotent confirmed event and disconnect.
- [ ] Test no invention, approval boundary, opt-out, duplicate send and controlled inbox status.

### Task 9: Phase 9 interviews

**Files:** interview services/routes/UI/export and tests.

- [ ] Implement timezone-safe interviews, source-backed brief, STAR matching, practice notes and pack export.
- [ ] Test source dates, no fake interviewer, offline fallback, privacy and Europe/Dublin timezone.

### Task 10: Phase 10 Command Centre and AI agent

**Files:** dashboard/action/metrics/agent services/routes/UI, tools and tests.

- [ ] Build actual-count dashboard, action priorities, funnel and data-quality states.
- [ ] Add server-validated read/draft/internal tool registry with checkpoints, budgets and audit.
- [ ] Deny unapproved send/apply/delete/profile disclosure; test injected input and owner isolation.

### Task 11: Phase 11 hardening

- [ ] Run complete test matrix, source samples, security audit, accessibility and responsive checks.
- [ ] Repair every discovered release blocker and repeat affected/full suites.
- [ ] Record all evidence and genuine blockers.

### Task 12: Phase 12 release

- [ ] Back up/export and compare counts.
- [ ] Package, stage and smoke test.
- [ ] Request/record production authorization if required, migrate, deploy and smoke test.
- [ ] Complete release report and user/operations documentation.
