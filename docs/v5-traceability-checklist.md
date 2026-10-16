# Version5 completion traceability checklist

**Starting snapshot:** GitHub `Version5` commit `ccb9562c0051c7658b21a99272cbfa55fd1088c4`, tree `fe7dee0e5a63c339b032bc55396a12ba0e4cefb1`; local/deployed source commit `6670d583cd684c4530a4ee3ae90f0fff4894b2c9` has the same tree. **Working branch:** `version5-completion`.

This checklist reconciles the original `Dublin_Tech_Compass_V4_Full_Build_Plan(3).md` with the Version5 completion plan before implementation. `PASS` means observed evidence exists; `PARTIAL` means code exists but an acceptance slice is missing; `BLOCKED` means an external tool, credential, approval or source-access condition prevents the check; `TODO` means it is still to be implemented. Existing V4 documents are historical evidence and are not promoted to PASS without rechecking the current branch.

## Operating constraints and release rules

- [ ] Preserve the existing 769 companies, 991 source-sector memberships, one import, all four sector workspaces, source provenance, enrichment, research assistant and Gmail section.
- [ ] Use owner-scoped server queries and private R2/document access for every new record and file.
- [ ] Never send email, submit an application, create a calendar event, contact a recruiter, post externally or schedule an outbound message without individual user approval.
- [ ] Treat external pages, job ads, contacts, permit pages and model output as untrusted; never infer a recruiter address, achievement, salary, sponsorship or eligibility.
- [ ] Keep low-reasoning enrichment, medium-reasoning assistant, explicit per-run token/search/time budgets, actual provider observations and cancellation/resume state.
- [ ] Keep blocked checks separate from passed checks. Do not claim full completion while a required row is FAIL, missing or BLOCKED.
- [ ] Use additive, rerunnable migrations, a pre-release backup, exact source parity and a reversible deployment path.

## Baseline and data preservation (V4 sections 0–3)

| ID | Reconciled requirement | Current evidence at Version5 start | Completion evidence/status |
|---|---|---|---|
| B-01 | Identify active repo, branch, Site project, URL, source/deployment commits and build scripts | Repo and Site identifiers recorded; tree parity verified | TODO: re-read before release |
| B-02 | Run install, tests, type-check, lint and production build; separate inherited failures | `pnpm test`: 95 files/376 pass/1 skip; `tsc`, `lint`, `build` exit 0 | PASS (baseline; rerun after changes) |
| B-03 | Audit workbook/source rows, aliases, malformed fields, duplicate names, multi-sector rows and generic inboxes | 769 companies/991 memberships/import preserved; historical audit exists | TODO: rerun/readback |
| B-04 | Keep import idempotent and source-row provenance visible in every sector | Existing import/backfill code and preservation evidence | TODO: regression test |
| B-05 | Preserve dashboard, company profile, imports, enrichment, refresh, assistant, Gmail and sidebar routing | Historical release tests | TODO: current regression |
| B-06 | Maintain employer/job/snapshot/contact/application/outreach/interview/profile separation | V4 schema and repositories exist | PASS/RECHECK |
| B-07 | Every factual claim stores URL, capture time and validation state; AI inference is labelled | Existing source/evidence models | TODO: audit new paths |
| B-08 | New data/API work is authenticated, owner-scoped, indexed, unique and idempotent | Existing V4 tests | TODO: add missing cases |
| B-09 | Backup/export and recovery procedure before production changes | Historical protected release backup | TODO: repeat for V5 |

## Persistence and migration requirements (V4 section 3)

| ID | Entity/requirement | Existing state | Completion |
|---|---|---|---|
| P-01 | Candidate profiles with strategy, geography, eligibility intervals, availability, families, level, arrangement, salary, languages and approved version | Implemented V4 | TODO: extend versioning if needed |
| P-02 | Private versioned candidate documents in R2 with metadata, parsing and retention | Implemented V4; full tailored workflow incomplete | PASS local: tailored CV proposal/artifact routes preserve master documents and write owner-scoped R2 objects; live R2 readback pending deployment |
| P-03 | Approved experience evidence with source spans, metrics and approval flag | Implemented V4 | TODO: validate all generated claims |
| P-04 | Job snapshots with hash, description, salary/currency, requirements, dates, source and diffs | Implemented V4 | TODO: add missing normalized fields |
| P-05 | Discovery runs with scope, sources, counts, cost, changes, throttling, errors, checkpoints and status | Implemented V4 | PASS local: provider observations and durable budget reservations are recorded when provider calls are made |
| P-06 | Owner/profile/versioned job matches with dimensions, weights, evidence, constraints, explanation and confidence | Implemented V4 | PASS local: approved evidence, explicit salary-period parsing, D1-safe identifier chunks, profile/config versions and manual-state preservation are tested |
| P-07 | Company signals with primary dated source, expiry, score and verified state | Implemented V4 | TODO: current-source refresh |
| P-08 | Recruitment contacts with public provenance, type, quality, DNC and correction state | Implemented V4 | TODO: source/contact fidelity regression |
| P-09 | Applications and immutable events with stage, job/company links, CV version, channel, dates, notes and next action | Implemented V4 | PASS local: analytics uses owner-scoped applications and immutable events with explicit denominators; CV proposal and application task links are available |
| P-10 | Outreach drafts/events with approval, attachment version, provider IDs, state, dedup key and reply category | Partial; send reservation incomplete | PASS local: atomic claim/settle, approval fingerprint, owner-scoped R2 attachment read, multipart MIME and safe Gmail error states are tested; connected Gmail send remains blocked |
| P-11 | Interviews and editable versioned preparation packs | Partial; research/content incomplete | PASS local: versioned packs, editable practice answers, stale-source warning, Dublin DST validation and exports are implemented; live research/browser proof remains blocked |
| P-12 | Daily action items, daily metrics and notification preferences with timezone/quiet hours/consent | Implemented V4 | PASS local: analytics denominators, durable notification events, deduplication, quiet hours and application tasks are implemented |
| P-13 | Activity audit, agent runs/steps and settings versions with redaction and budgets | Implemented V4 | TODO: connect all tools/usage |
| P-14 | Forward migrations, foreign keys, owner filters, uniqueness, safe backfill and repeat-migration tests | Migrations 0000–0005 | PASS local: additive V5 migration is repeat-safe and covers all new tables; production rehearsal is pending deployment |

## Feature 1 — Personal opportunity ranking (V4 section 4)

| ID | Requirement | Start status | Completion |
|---|---|---|---|
| R-01 | Candidate page supports target families including PM, Growth, E-commerce, AI, Solutions/Consulting and Product Marketing | Implemented | TODO: browser proof |
| R-02 | Master CV upload/versioning preserves original and exposes parsed facts for correction | Implemented | PASS local: complete evidence-constrained tailored CV proposal/edit/review/approval/export flow added; browser proof blocked |
| R-03 | Multiple strategies share an evidence bank | Implemented | TODO: regression |
| R-04 | Hard constraints expose Dublin/remote, arrangement, seniority, start-date eligibility and salary unknowns | Partial | TODO: normalized inputs/permit evidence |
| R-05 | Deterministic prefilters and explainable weighted scoring | Implemented | PASS local: D1-safe chunking, salary normalization and approved-evidence-only inputs are regression-tested |
| R-06 | Editable default weights: skills 30, scope 20, domain 15, constraints 15, impact 10, freshness 5, interest 5 | Implemented | TODO: verify persisted config |
| R-07 | 0–100 heuristic score, confidence, matched evidence, gaps and unknowns; never interview probability | Implemented | TODO: test bounds/claims |
| R-08 | Recompute on profile/job changes and persist scoring version | Partial | PASS local: approved profile version, scoring config version and manual star/dismiss/override preservation are persisted and tested |
| R-09 | Star, dismiss, override with reason and shortlist export | Implemented | TODO: browser proof |
| R-10 | Top Opportunities Today and compare view | Implemented/partial | TODO: browser proof |
| R-11 | Ranking tests cover parsing, correction, hard constraints, determinism, evidence, dedup, bounds and empty/responsive states | Partial | PASS local: ranking persistence, D1 chunking and salary-period tests pass; browser responsive proof remains blocked |

## Feature 2 — Live Job Radar (V4 section 5)

| ID | Requirement | Start status | Completion |
|---|---|---|---|
| J-01 | Official career pages and permitted ATS/API adapters with access controls | Implemented fixtures | TODO: allowed live sample |
| J-02 | Per-company supported/unsupported/blocked/empty/partial/stale/error status | Implemented | TODO: verify UI |
| J-03 | Dedup by ATS ID, canonical URL and company/role/location with collision safeguards | Implemented | TODO: large-set query safety |
| J-04 | Extract title, source, description, Dublin locality, model, seniority, salary only if published, verified dates and confidence | Partial | TODO: richer filters/normalization |
| J-05 | Daily high-priority and weekly lower-priority incremental checks with editable budgets | Partial; dispatcher not secured | PARTIAL local: owner opt-in schedules, durable run claims/checkpoints, fixed source/role budgets and bearer-protected dispatch are implemented; external unattended scheduler credential/run is blocked |
| J-06 | Hash/snapshot diff states and two-miss removal hysteresis | Implemented | TODO: regression |
| J-07 | Filters for sector, title family, fit, locality, model, salary, last verified and 24h/3d/7d new | Partial | PASS local: server-side sector/title-family/fit/locality/work-model/salary/new-window filters and cursor pagination are implemented; UI/browser proof remains blocked |
| J-08 | Priority alerts/digests with deduplication and quiet hours | Partial | PASS local: durable notification events are deduplicated by schedule slot and exposed through owner-scoped in-app APIs; external delivery is intentionally absent |
| J-09 | User refresh for job/company/sector/shortlist, clearly labelled | Implemented | TODO: browser proof |
| J-10 | Detail page shows source, checked time, apply URL, snapshots and invalid-job action | Implemented | TODO: browser proof |
| J-11 | Tests cover new/changed/unchanged/removed, ID reuse, duplicates, 403/429, stale, date ambiguity, restart/resume and budget exhaustion | Partial | PASS local: existing Job Radar suite plus durable scheduler, provider budget and pagination tests pass; live source sampling remains blocked |

## Feature 3 — Recruiter and hiring-team finder (V4 section 6)

| ID | Requirement | Start status | Completion |
|---|---|---|---|
| C-01 | Classify recruitment-specific, named recruiter, relevant manager, generic HR, business, sales and unknown contacts | Implemented | TODO: regression |
| C-02 | Discover from official recruiting/contact pages and public business information with URL/date | Implemented | TODO: allowed source check |
| C-03 | Permit public LinkedIn profile link as manual path; no login scraping or automated DM | Implemented policy | PASS/RECHECK |
| C-04 | Separate relevance from reliability and recency | Implemented | TODO: UI proof |
| C-05 | Explain relevance, origin, verify date, type, quality and correction action | Implemented | TODO |
| C-06 | Never guess email syntax; profile-only is email unavailable | Implemented | TODO: regression |
| C-07 | Review queue for conflict/stale/generic/personal-data contacts, suppression/removal | Implemented/partial | TODO |
| C-08 | Link contact to roles/company and Gmail preview without automatic send | Implemented | TODO: attachment/send gate |
| C-09 | Manual or consented narrow Gmail thread response tracking | Partial | TODO |
| C-10 | Dedupe company/profile/address and enforce DNC everywhere | Implemented | TODO |

## Feature 4 — Application CRM (V4 section 7)

| ID | Requirement | Start status | Completion |
|---|---|---|---|
| A-01 | Kanban/table with canonical stages Target, Contacted, Applied, Follow-up, calls, interviews, Offer, Rejected, Withdrawn | Implemented | TODO: browser proof |
| A-02 | Create from live job, manual link or speculative company; keep company/job separate | Implemented | TODO |
| A-03 | Store source snapshot, CV, contact, channel, date, follow-up, salary, rounds, notes and documents | Partial | TODO: document linkage |
| A-04 | Explicit transitions, immutable timeline and duplicate-active prevention with deliberate override | Implemented | TODO |
| A-05 | Configurable follow-up reminders and action items | Implemented/partial | TODO: scheduler/analytics |
| A-06 | Gmail/manual response and outcome updates never infer sent/submitted | Partial | TODO |
| A-07 | Owner-scoped export/delete/retention and audit | Implemented | TODO |
| A-08 | Tests cover duplicate, reopen, withdraw/resubmit, rounds, unknown date and DST | Partial | TODO |

## Feature 5 — AI application packs (V4 section 8)

| ID | Requirement | Start status | Completion |
|---|---|---|---|
| K-01 | Evidence-constrained CV, cover letter, outreach and interview prep generation | Partial; preparation packs exist | PASS local: deterministic complete tailored CV plus existing pack/interview/pitch generation use approved evidence and review gaps |
| K-02 | Every numeric/achievement claim cites approved evidence or is review-marked | Implemented validator | TODO: expand artifacts |
| K-03 | Low-reasoning enrichment/model path and deterministic fallback | Implemented | PASS local: low enrichment and medium assistant defaults are preserved; provider calls reserve/settle durable budgets and record token observations |
| K-04 | Editable versioned artifact review with accept/reject/edit controls | Partial | PASS local: CV proposals and packs are versioned with draft/review/approved states and edits; live UI proof is blocked |
| K-05 | Complete factual tailored CV, ATS checks, formatting and readable PDF/DOCX/HTML/TXT export | Partial | PASS local: complete evidence-constrained CV payload, numeric-claim checks and HTML/PDF/DOCX exports are tested; TXT export remains covered by parsed text rather than a separate file route |
| K-06 | Preserve source/master CV, no silent overwrite and private artifact access | Implemented/partial | TODO |
| K-07 | Tests cover no evidence, unsupported claims, edited revisions, parse/render round trips and non-ASCII | Partial | PASS local: CV validation/render tests and existing document/email non-ASCII tests pass |

## Feature 6 — Sector-specific pitch engine (V4 section 9)

| ID | Requirement | Start status | Completion |
|---|---|---|---|
| T-01 | Four substantive playbooks: E-commerce, Startups, Fintech, Work Permit | Implemented | TODO: current company facts |
| T-02 | Persona/tone variants produce meaningfully different output from approved evidence | Partial | TODO |
| T-03 | 30-second intro, <=100-word pitch, cold/introduced recruiter email, projects, differentiators and questions | Partial | TODO |
| T-04 | Source URLs/timestamps, evidence refs, variant/config version and edits stored | Partial | PASS local: pitch payloads retain evidence/source context and pitch usage records persist variant/outcome |
| T-05 | Permit copy separates contribution from dated permission statements and requires confirmation | Partial | TODO |
| T-06 | Track variant used and manual outcome without causal claims | TODO | PASS local: owner-scoped pitch usage endpoint stores variant and optional manual outcome; analytics labels remain descriptive |

## Feature 7 — Hiring-trigger intelligence (V4 section 10)

| ID | Requirement | Start status | Completion |
|---|---|---|---|
| S-01 | Collect funding, product launch, Dublin office, leadership change, vacancy spike and similar signals only from permitted public sources | Implemented fixtures | TODO live/source check |
| S-02 | Primary-source preference, dated fact, capture time, confidence, expiry and relevance | Implemented | TODO |
| S-03 | Deduplicate, suppress/correct and keep unknowns visible | Implemented | TODO |
| S-04 | Surface signals in company/job/ranking/outreach context with provenance | Partial | TODO |
| S-05 | Notify only on opt-in, deduped changes within quiet hours and budget | Partial | TODO |
| S-06 | Tests cover source freshness, duplicate events, insufficient evidence and suppression | Partial | TODO |

## Feature 8 — Dublin and permit reality (V4 section 11)

| ID | Requirement | Start status | Completion |
|---|---|---|---|
| M-01 | Versioned official rule registry with URL, capture hash/date, effective interval and source version | Partial | TODO |
| M-02 | Separate scheme, SOC/occupation, duties, salary/currency/annualisation, hours, duration, degree/experience, employer and candidate permission | Partial | TODO |
| M-03 | Ambiguous extracts require review; no silent rule replacement | Partial | TODO |
| M-04 | Suggested SOC mapping based on duties with conditional review; no title substring decision | Partial | TODO |
| M-05 | Effective-dated permission intervals with hours/conditions and confirmation state | Partial | TODO |
| M-06 | Each condition is met/not-met/unknown/requires-review; overall potential/cannot-determine/not-evidenced | Partial | PASS local: permit evaluations now persist condition-level statuses, annual-salary uncertainty and review labels while preserving conservative overall states |
| M-07 | Dublin City/Fingal/South Dublin/DLR mapping; office vs role/remote location separated | Partial | TODO |
| M-08 | Filters and review queue for verified/unknown/conflict/incomplete/stale evidence | Partial | TODO |
| M-09 | Re-evaluate after source/profile change; reconfirm permission before outreach; never promise sponsorship | Partial | TODO |
| M-10 | Tests cover salary/term, duties, degree, effective dates, future permission, remote location and conflict | Partial | TODO |

## Feature 9 — Interview preparation (V4 section 12)

| ID | Requirement | Start status | Completion |
|---|---|---|---|
| I-01 | Dublin timezone scheduling with UTC storage and DST-safe controls | Implemented | TODO browser proof |
| I-02 | Bounded public research on company/team/products/customers/model/competitors/recent developments with URLs/dates | Partial | TODO |
| I-03 | Optional public business interviewer research only when identity supplied; no private biographies | Partial | TODO |
| I-04 | Exact role snapshot and 3–5 approved STAR examples, with shortage disclosed | Partial | TODO |
| I-05 | Recruiter/product/analytics/AI/leadership practice, introductions, checklist and questions with prediction labels | Partial | TODO |
| I-06 | Versioned editable answers/outcomes; regeneration never overwrites edits | Partial | TODO |
| I-07 | Source freshness refresh/offline fallback and complete readable PDF/DOCX export | Partial | PASS local: stale-source warnings and readable PDF/DOCX/HTML exports are implemented; live refresh proof is blocked |
| I-08 | Calendar remains manual unless separately approved; follow-up approval required | Implemented policy | PASS/RECHECK |
| I-09 | Tests cover no source, stale role, common names, changed role, DST, pagination, non-ASCII and edits | Partial | TODO |

## Feature 10 — Command Centre and AI agent (V4 sections 13–16)

| ID | Requirement | Start status | Completion |
|---|---|---|---|
| G-01 | Today dashboard uses database-backed KPIs, actionable priorities, data quality and empty setup | Implemented/partial | TODO |
| G-02 | Funnel counts/rates use authoritative deduped events, denominators, filters, sample thresholds and no causal claims | Partial | PASS local: analytics endpoint computes owner-scoped denominators, sample threshold and descriptive rate note; regression test passes |
| G-03 | Sector/channel effectiveness, time-to-response/interview and configurable daily targets | Partial | TODO |
| G-04 | Visible opt-in digest, quiet hours, IANA timezone, DST and duplicate suppression | Partial | PASS local: existing opt-in digest plus durable event list/dedup and timezone/quiet-hours validation are implemented |
| G-05 | Agent tools cover company/job search/refresh, profile, ranking, sources, contacts, permits, signals, packs, applications, stages, drafts, followups, actions, interviews, exports and budgets | Partial | TODO inventory |
| G-06 | Server validates tool schemas/owner scope/approval; no model-granted consent or arbitrary SQL | Implemented/partial | TODO |
| G-07 | Run/step states queued/running/completed/partial/blocked/failed, evidence, cost, errors, cancel/resume/retry and reload recovery | Implemented/partial | TODO |
| G-08 | Internal read/draft/tracking work may run within limits; profile edits, deletion, send/apply/disclosure/calendar require explicit approval | Implemented policy | TODO adversarial tests |
| G-09 | No placeholder prepared claims; each tool has genuine read/write artifact/action and source version | Partial | TODO |
| G-10 | Durable concurrency/rate limits, provider observations, retries, checkpoints and budget reservation across isolates | Partial | PASS local: D1-backed usage budgets/reservations, provider observations, atomic outreach claims and scheduler leases/checkpoints are tested |
| G-11 | Full history/export in Settings with redaction/retention and factual-vs-inference distinction | Partial | TODO |
| G-12 | Low enrichment and medium assistant reasoning are configured and actual usage/cost is recorded | Partial | PASS local: reasoning defaults and actual token observations are recorded; provider billing is exposed as configurable estimates until a measured provider bill is returned |

## Security, UX, testing and release gates (V4 sections 15–21)

| ID | Gate | Required proof | Status |
|---|---|---|---|
| Q-01 | Single app-shell/sidebar; no unexpected tabs; all four sectors and existing pages preserved | Authenticated browser matrix | BLOCKED until supported browser |
| Q-02 | Loading/empty/partial/error/success states; mobile stack/detail and accessible controls | Desktop/mobile evidence at 320/375/390/768/1024/1440/1920 | TODO/BLOCKED |
| Q-03 | Keyboard focus, labels, screen-reader semantics, touch targets, table overflow and long-output scroll | Browser/accessibility evidence | TODO/BLOCKED |
| Q-04 | Unit, repository, API, migration, integration, agent and performance suites | Exact commands/results | PASS local: `pnpm test` 102 files/399 passed/1 skipped, TypeScript, lint, diff check and build pass on this branch; live/browser suites remain blocked |
| Q-05 | IDOR/auth, uploads, SSRF/redirects/DNS, XSS/CSRF/CORS, formula injection, prompt injection, secrets/tokens and retention | Security tests/audit | TODO |
| Q-06 | Large data/pagination/query limits, D1 binding limits, Worker steps, timeouts, retries and measured timings | Performance evidence | PARTIAL local: identifier chunking and cursor pagination tests pass; production timing/Worker-limit evidence remains pending |
| Q-07 | Gmail OAuth/attachments/revocation and controlled test inbox | Connected account and individual authorization | BLOCKED until account/approval |
| Q-08 | At least 20 permitted official careers pages and 10 ranked live roles | Approved live source sample | BLOCKED by prior access/approval limit unless reopened through supported tools |
| Q-09 | Real end-to-end company → vacancy → match → reviewed CV → approved test outreach → CRM → interview → analytics | Authenticated staging/production evidence | BLOCKED until browser/Gmail gates |
| Q-10 | Real unattended scheduler execution in a fresh context, alert/dedup/DST behavior and restart/resume | External secure scheduler run ID/log | BLOCKED: bearer-protected dispatcher and durable run logic are implemented, but no authorized external scheduler credential/run is available |
| Q-11 | Backup/count manifest, migration rehearsal, exact source/data parity and cleanup | Release evidence | PARTIAL local: release route includes the V5 tables and self-test cleanup is owner-scoped; production count/backup readback remains pending deployment |
| Q-12 | Production Site deployment, post-deploy logs/smoke, temporary release controls removed | Sites status and readback | TODO: final branch push, authorized Site deployment, post-deploy readback and release-control cleanup remain |

## Acceptance labels

`PASS` is reserved for observed evidence in this branch or an approved live environment. `PARTIAL` means the local implementation exists but the original requirement is broader. `BLOCKED` is a real external limitation and must name the precise required action. A final report must list every non-PASS row and must not call the release fully complete while release-blocking rows remain open.
