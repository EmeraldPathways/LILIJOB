# Version5 execution ledger

Plan: `Dublin_Tech_Compass_Version5_Completion_Agent_Plan(1).md`
Spec: `Dublin_Tech_Compass_V4_Full_Build_Plan(3).md`
Branch: `version5-completion`
Base local commit: `6670d583cd684c4530a4ee3ae90f0fff4894b2c9`
Verified Version5 GitHub snapshot: `ccb9562c0051c7658b21a99272cbfa55fd1088c4` / tree `fe7dee0e5a63c339b032bc55396a12ba0e4cefb1`

This ledger is append-only. Each task records the test command, observed output, repairs and any ruling. A task is complete only when its focused and regression tests pass and the corresponding checklist rows are updated with evidence.

## Preflight evidence

- `2026-10-16`: GitHub API readback confirmed branch `Version5` at `ccb9562c0051c7658b21a99272cbfa55fd1088c4`, tree `fe7dee0e5a63c339b032bc55396a12ba0e4cefb1`.
- `2026-10-16`: local `HEAD^{tree}` equals `fe7dee0e5a63c339b032bc55396a12ba0e4cefb1`; no working-tree edits existed before this ledger/checklist.
- `2026-10-16`: isolated worktree created at `/workspace/scratch/1e27f5cbe308/LILIJOB-version5-completion` on branch `version5-completion`.
- `2026-10-16`: package installation completed with `pnpm install --frozen-lockfile`; lockfile supply-chain policy passed.
- `2026-10-16`: no local Git remote is configured. GitHub source operations must use the supported GitHub connector and exact tree/commit readback.
- `2026-10-16`: prior evidence records 769 companies, 991 memberships, four sectors and one import; production synthetic workflow 11/11 passed and left no synthetic rows. These are baseline claims to recheck, not new V5 proof.
- `2026-10-16`: prior external-source sampling and browser/Gmail checks remain blocked under the recorded access/approval conditions. Do not retry through an alternate tool or relabel fixtures as live evidence.
- `2026-10-16`: baseline `pnpm test` passed: 95 files, 376 tests passed, 1 skipped.
- `2026-10-16`: baseline `pnpm exec tsc --noEmit` passed with exit 0.
- `2026-10-16`: baseline `pnpm lint` passed with exit 0.
- `2026-10-16`: baseline `pnpm build` passed with the full API/page route inventory and retained-asset message.
- `2026-10-16`: focused V5 scheduler/CV/analytics/migration/provider/email tests passed; all new writes are owner-scoped and the external-action boundaries remain explicit.
- `2026-10-16`: full regression after the V5 completion additions passed: 102 files, 399 tests passed, 1 skipped; TypeScript, ESLint and `git diff --check` pass.
- `2026-10-16`: production build passed after the completion additions and emitted the new analytics, application-task, CV, notification, pitch-usage and usage routes.
- `2026-10-16`: provider paths now reserve durable monthly budgets before OpenAI/Tavily calls and settle token/search observations after success or failure; cost fields distinguish configurable estimates from measured provider billing.
- `2026-10-16`: Job Radar dispatch now claims a durable scheduled-task run per due slot and creates one in-app notification event per completed/partial slot; no outbound notification sender was added.
- `2026-10-16`: server-side Job Radar list supports bounded cursor pagination and sector/title-family/fit/locality/work-model/salary/new-window filters while preserving the backward-compatible array API.
- `2026-10-16`: tailored CV proposal/artifact routes, multipart Gmail attachment handling, CRM analytics/task APIs, pitch usage tracking and conservative permit condition statuses were added; focused tests passed.

## Rulings

- `Ruling`: Use the local commit `6670d583cd684c4530a4ee3ae90f0fff4894b2c9` as the worktree base because its complete tree is proven identical to the GitHub Version5 tree while the authenticated local repository does not contain the GitHub commit object. This preserves the verified source state; final publication must use a GitHub commit whose tree is read back as the deployed tree. Cost if wrong: ancestry differs even though source parity is maintained, so the final report must disclose both SHAs.
- `Ruling`: Treat the existing V4 acceptance documents as historical evidence and re-grade each row in `v5-traceability-checklist.md`. This avoids overstating old PASS labels after the completion scope expanded. Cost if wrong: repeated checks consume time, but false release confidence is worse.

## Task status

- Task 0.1: complete — install, 95-file/376-pass/1-skip test suite, TypeScript, ESLint and production build all passed on the clean Version5 tree.
- Task 0.2: complete — traceability checklist and V5 evidence ledger created; historical rows were regraded and the verified Version5 tree parity was recorded.
- Task 1: complete — ranking inputs are D1-safe, salary periods remain explicit, approved evidence is the only profile scoring input, scoring/profile/config versions persist, manual match state survives rescoring, and Gmail send claims are atomically reserved/settled.
- Task 2: complete — additive V5 schema/migration covers usage, scheduler, notification, CV, attachment, task, permission and pitch-usage records; migration and focused SQLite tests pass.
- Task 3: complete local — provider reservations, fixed-point usage, token/search observations, low enrichment and medium assistant reasoning are connected to provider paths; measured billing remains unavailable until a provider response supplies it.
- Task 4: complete local — Job Radar durable run claims/checkpoints and in-app notification deduplication are wired; actual unattended execution remains blocked without an authorized external scheduler credential/run.
- Task 5: complete local — Job Radar adds server-side sector/title-family/fit/locality/work-model/salary/new-window filters and cursor pagination with bounded queries.
- Task 6: complete local — evidence-constrained tailored CV proposals, review/edit/version state, ATS/numeric checks, private artifact approval and PDF/DOCX/HTML export routes are implemented; browser/R2 readback remains pending.
- Task 7: complete local — Gmail multipart attachment formatting, owner-scoped R2 reads, attachment hash/approval checks and no-automatic-retry failure states are implemented; connected Gmail send remains blocked.
- Task 8: complete local — CRM analytics uses authoritative events/denominators/sample thresholds, persists daily metrics, and application follow-up tasks are durable.
- Task 9: complete local — pitch variant/outcome usage tracking is persisted without causal claims.
- Task 10: complete local — permit evaluations expose conservative condition-level statuses and explicit annual-salary uncertainty; live official-source interpretation remains blocked/review-required.
- Task 11: complete local — interview packs retain bounded source metadata, stale-source warnings, editable versioned practice answers and readable exports.
- Task 12: complete local — existing server-owned agent tools remain approval-gated and owner-scoped; provider usage observations are now available to the run/dashboard data.
- Task 13: blocked external — browser/desktop/mobile and connected Gmail/live-source acceptance require the previously blocked supported integrations and individual approval for any send.
- Task 14: complete local — full regression, TypeScript, lint, diff check and production build pass; release backup/readback and security/performance evidence are still open.
- Task 15: pending — push `version5-completion` through the supported GitHub/Site workflow, preserve audience/data, verify deployment, remove temporary controls and publish the evidence-based handoff.

- `2026-10-16`: final source review found that reviewed tailored CV proposals could not be edited; `updateCvProposal` now permits owner-scoped edits while status is draft or review and leaves approved proposals immutable. TypeScript, full regression (102 files, 399 passed, 1 skipped), ESLint, diff check and production build pass after the repair.
