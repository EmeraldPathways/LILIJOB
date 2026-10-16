# Dublin Tech Compass V4 — release candidate, 16 October 2026

User authorised completion and production deployment. Feature branch: `version4-interview-engine`. Existing public Site audience is preserved; all private records continue to require authenticated owner access.

## Implementation

All ten feature areas have persistence, API and UI implementations. This completion pass added PDF/DOCX/TXT extraction; real PDF/DOCX/HTML exports; saved searches; in-app digest preferences; selected-company opt-in scheduled queues; bounded official-source contact/signal collection; trusted ATS and role-detail verification; internal agent CRM tools; durable step/cancellation recovery; truthful estimated-cost displays; and candidate/mobile workflow repairs.

No imports, ordinary record views or local saved searches trigger paid research. Routine enrichment remains low reasoning; assistant remains medium. Emails require individual review/approval; no release test contacts a recruiter.

## Data safety

Before schema changes, an expiring maintenance operation saved and read back a 1,453,462-byte private R2 backup. Latest pre-migration backup on 16 October: SHA-256 `19b5cb929eb7edf93dc7693903ad7da0fc3bc22b1eb75c2ae62a9bebf1436e41`.

Production baseline: 769 companies, 991 category memberships, one import. Memberships: Fintech 316, Tech Permits 270, Ecommerce 155, Startups 250. Original uploads are preserved. Backup excludes Gmail credential/token tables and API secrets.

V4 migrations are additive: `0003_burly_nick_fury.sql`, `0004_jazzy_warstar.sql`, `0005_v4_research_schedules.sql`. No release request creates application tables.

## Observed local checks

- 95 test files, 376 tests passed, one skipped on the final integrated run to this point.
- TypeScript passed.
- Production build passed.
- ESLint: no errors; schedule mock parameter warnings corrected before packaging.
- Production dependency audit: zero high/critical findings; one moderate `sprintf-js` advisory in Mammoth's unused command-line dependency chain. The Worker uses the browser parser, not that CLI.
- Isolated synthetic-owner integration checks cover company, verified job snapshot, candidate evidence, ranking, owner isolation, application stage, deterministic pack, interview, dashboard, safe agent step and actual PDF/DOCX outputs. Both normal and interrupted-flow cleanup are tested.

## Explicit acceptance limits

- Desktop/mobile browser click-through is BLOCKED: this managed environment exposes no supported control-browser skill. Rendered-markup/responsive tests are not browser evidence.
- Gmail account configuration exists, but connected-account status and a controlled send must be verified separately. Deployment does not authorise sending a test message.
- Additional job source sampling was blocked by automatic approval review because it would fetch private-workbook-derived external destinations. Prior internal evidence is retained outside the source repository. Unverified links remain unverified; domain-marketplace/partner URLs are rejected. A 10-role candidate-specific live ranking review is not claimed.
- Daily/weekly scope and continuation are implemented. An unattended external scheduler still needs to call the protected dispatcher with its secret. The owner can run the selected due queue from Job Radar; saving a cadence does not create a cloud trigger.
- Official permit-source retrieval records availability/hash, not legal approval. Personal eligibility remains evidence-based and reviewable.
- Actual provider spend is not measured; the agent labels budget amounts as estimates.
- CodeRabbit could not authenticate (`environment_unsupported`: browser login unavailable). No CodeRabbit review result is claimed.

## Deployment receipt

Pending exact-source packaging, migration/deployment, isolated production self-test and backup comparison. Record observed responses in the completion ledger; do not infer success from local checks.

### Observed production receipt — 16 October 2026

- Site version 20 deployed successfully from `777a9b19f19b5ce8db7c9bb16e5d15be6bf5c6c4`.
- URL: https://dublin-tech-compass.emeraldpathways.chatgpt.site
- All additive migrations are present in production; readback found all new V4 tables.
- Protected production self-test returned HTTP 200, 11/11 steps passed: D1, synthetic company, verified job snapshot, approved candidate evidence, ranking score 76, application owner isolation/stage, deterministic application pack, interview/pack, dashboard, safe agent run, real PDF/DOCX generation.
- Cleanup confirmed zero remaining synthetic-owner rows.
- Live OpenAI smoke returned HTTP 200 for `gpt-5.6-luna`, low reasoning: 13 input + 5 output = 18 tokens; no personal data was sent.
- Post-migration backup comparison returned HTTP 200: companies 769/769, memberships 991/991, imports 1/1, every complete row preserved byte-for-byte after canonical ordering.
- Gmail configuration present; zero connected accounts. No OAuth sign-in or email send is claimed.
- Browser QA, additional external-source sampling, 10-role candidate review, controlled Gmail send and unattended cron hookup remain outstanding as documented. Deployment succeeded; strict full-plan acceptance remains partial for those checks.

Release-only operational credentials will be removed after verification. The final documentation publication retains the same application code and recorded data.
