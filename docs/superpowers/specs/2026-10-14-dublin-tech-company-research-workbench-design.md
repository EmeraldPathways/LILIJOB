# Dublin Tech Company Research Workbench

**Date:** 2026-10-14  
**Status:** Design approved in conversation; awaiting written-spec review before implementation  
**Working title:** Dublin Tech Compass

## 1. Purpose

Build a private Sites web app that helps Andrew collect and research technology employers in County Dublin. The first release is a company intelligence database. It accepts CSV and Excel seed files, enriches company records with fresh public web research, discovers additional companies, and provides an AI assistant for analysis and research.

Role matching and application workflows are deliberately deferred until the company database is useful and reliable.

## 2. Confirmed decisions

- Hosting: Sites full-stack application.
- Access: private to the owner through Sites/ChatGPT authentication.
- Geography: County Dublin only, including Dublin City, Fingal, South Dublin, and Dún Laoghaire–Rathdown.
- Initial categories: Work Permit Companies, Startups, Fintech, and E-commerce.
- A company may belong to more than one category.
- Seed data: CSV and XLSX uploads with company names and optional details.
- Uploads store the source records first; enrichment is explicitly started per company from its profile.
- Discovery searches for additional companies as well as enriching uploaded companies.
- Fresh web searches are used by default when the AI needs current or missing information.
- Fresh findings are saved automatically with sources and checked dates.
- Work Permit Companies includes both sponsorship evidence and roles that may qualify for an Irish employment permit.
- Existing records refresh weekly and have a manual Refresh now action.
- Weekly discovery also adds new County Dublin companies.
- AI model setting defaults to `gpt-5.6-luna` and remains configurable.
- Paid search/API providers are acceptable.
- Dashboard layout: Split Workspace, with a company list beside the selected company profile on desktop.
- Weekly runs have configurable discovery and source limits.

## 3. First-release goals

1. Import a company list without requiring fixed spreadsheet headings.
2. Normalize, deduplicate, and categorise companies.
3. Enrich each company with broad, source-backed public information.
4. Discover additional County Dublin employers in the four categories.
5. Keep open roles, permit evidence, contacts, sources, and changes as queryable records.
6. Let the AI answer questions over the saved database and perform fresh research when needed.
7. Provide weekly refreshes, manual refresh controls, run history, and failure visibility.
8. Keep the database, uploaded files, and AI history private.

## 4. Deferred scope

The first release will not implement:

- personal role matching or ranking against Andrew's CV;
- job application submission or automated outreach;
- public sharing or multi-user workspaces;
- paid job-board accounts or authenticated scraping;
- automatic deletion of records;
- guarantees that every Dublin employer or every vacancy has been found.

These can be added later using the same company, job, and source model.

## 5. User experience

### 5.1 Navigation

The private dashboard uses a compact left navigation on desktop:

- Dashboard
- Work Permit Companies
- Startups
- Fintech
- E-commerce
- Imports
- Refresh history
- AI helper

The header exposes Import file, Find companies, and Refresh now. The weekly run status is always visible.

### 5.2 Split Workspace

The default desktop view has two panes:

- **Company list:** search, filters, category labels, locality, freshness, open-role count, and confidence indicators.
- **Company profile:** overview, Dublin presence, website, careers page, current roles, public recruitment contacts, permit evidence, sources, and change history.

The profile pane updates when a company is selected. A company can be opened as a dedicated route for sharing within the private Site and for reliable mobile navigation.

### 5.3 Mobile behaviour

- Category navigation becomes a dropdown.
- Company records appear as cards.
- Selecting a card opens the full profile view.
- Filters open in a bottom sheet.
- Refresh and AI controls remain prominent.
- The AI helper opens as a full-screen panel so long answers and source links remain readable.

### 5.4 Visual system

Use a professional research-workspace style: clear typography, dark navy text, muted blue or teal status colours, compact but readable tables, and restrained colour for permit and confidence states. Use labels and icons in addition to colour so status remains accessible.

## 6. Information collected

Each company profile should attempt to collect:

- canonical company name and known aliases;
- company website and domain;
- short description and business model;
- sector and category membership;
- company stage and size indicators;
- Irish presence and exact County Dublin locality when available;
- Dublin office address or supported Dublin role location;
- careers page and other official hiring pages;
- current open roles, including title, team, location, work arrangement, URL, and observed date;
- public recruitment contacts and role context when published by the source;
- evidence of current or previous employment-permit sponsorship;
- evidence that a role may qualify under Irish employment-permit rules;
- relevant company status or registration details when publicly available;
- source links, source types, checked dates, excerpts, and confidence;
- refresh and change history.

Public business contact information is permitted. The system should not infer or store private personal contact details that are not published for recruitment or business use.

## 7. Data model

Use D1 for structured records and R2 for uploaded files and generated exports. The following logical tables are required.

### `companies`

Stores the current normalized profile: owner ID, canonical name, aliases, website/domain, description, sector, size/stage, County Dublin locality, address, Irish presence, careers URL, category flags, freshness, confidence, and created/updated timestamps.

### `company_categories`

Many-to-many relationship between companies and the four categories. Store the category, evidence source, confidence, and timestamps.

### `jobs`

Stores a separate role record: company ID, title, department, location text, normalized Dublin locality, remote/hybrid status, employment type, URL, first seen, last seen, status, source ID, and confidence.

### `permit_evidence`

Stores company ID, evidence type (`sponsorship` or `potentially_qualifying_role`), claim, permit type if known, source ID, checked date, confidence, and current status.

### `contacts`

Stores company ID, contact label, published business email or URL when available, role context, source ID, checked date, and confidence.

### `sources`

Stores URL, domain, source type, title, excerpt or extracted evidence, retrieval date, HTTP/result status, and source quality. The same source can support multiple claims.

### `company_claims`

Stores structured claims extracted from sources, including field name, value, source ID, confidence, first seen, last checked, and whether the claim is current, superseded, or conflicting.

### `change_history`

Stores record type, record ID, field, old value, new value, source ID, run ID, and timestamp. It enables weekly comparison without overwriting evidence.

### `imports`

Stores uploaded file metadata, R2 object key, detected format, column mapping, row counts, import status, error summary, and owner ID.

### `refresh_runs`

Stores run type (`upload`, `manual_refresh`, `weekly_refresh`, or `weekly_discovery`), scope, status, counters, API usage, estimated cost, error summary, start/end timestamps, and owner ID.

### `ai_conversations` and `ai_messages`

Stores private AI history, tool calls, citations, saved findings, and timestamps. User-owned records must be authorized by the authenticated Sites user ID.

### `saved_searches`

Stores reusable discovery or analysis queries, category, geography, search depth, enabled state, and last run.

## 8. Import and enrichment lifecycle

1. The user uploads CSV/XLSX from the private dashboard.
2. The server stores the original file in R2 and parses a working copy.
3. Header aliases are mapped to known fields. Unrecognised columns are retained as import metadata.
4. Company names, domains, aliases, and addresses are normalized.
5. Existing companies are matched using canonical domain, normalized name, aliases, and public Irish registration identifiers where available.
6. New or changed records remain available with a not-enriched status until the user presses Enrich company.
7. The enrichment worker plans searches for official company pages, careers pages, job sources, Irish permit sources, and credible sector/company sources.
8. Results are extracted into structured claims and linked to source records.
9. Claims are merged according to source quality and confidence. Conflicts are retained and flagged.
10. Jobs, contacts, permit evidence, company categories, and change history are upserted idempotently.
11. The dashboard updates run progress and makes partial results visible.

An upload never waits for every source before showing the company. It creates the profile promptly and displays a clear not-enriched status until the user starts research.

## 9. Discovery and weekly refresh

The scheduled workflow runs weekly in the Europe/Dublin timezone, with Sunday at 03:00 as the initial schedule. It performs two phases:

1. Refresh existing companies, jobs, permit evidence, contacts, and stale sources.
2. Discover additional County Dublin companies by category, then normalize, deduplicate, and enrich them.

The initial default guardrails are:

- up to 25 new companies per category per weekly discovery run;
- up to 6 meaningful source searches per company;
- up to 500 existing company refreshes per weekly run.

These limits are editable in Settings. A run stops gracefully at its limit and records the continuation point for the next run. Manual Refresh now can target one company, one category, or the whole database, subject to the same visible usage controls.

Discovery must use evidence of a County Dublin office or a role explicitly located in County Dublin. The four local authority areas are treated as County Dublin locations. Companies outside the county are not added merely because they have Irish operations elsewhere.

## 10. AI helper

The AI helper uses GPT‑5.6 Luna through a server-side model adapter. The model name is configured through `OPENAI_MODEL`, defaulting to `gpt-5.6-luna`. Responses API calls also send `reasoning.effort` from `OPENAI_REASONING_EFFORT`; unsupported values fall back to `medium`.

### Tools exposed to the agent

- search saved companies, jobs, claims, sources, and history;
- filter by category, locality, freshness, confidence, and permit evidence;
- compare selected companies;
- run a County Dublin discovery search;
- refresh a company, category, or database scope;
- inspect a refresh run and its failures;
- save sourced findings to the database;
- export selected records when the user requests it.

The agent searches saved data first, then performs fresh web research when the question asks for current information or the local data is incomplete. Its response format includes a concise answer, evidence, checked dates, source links, confidence, and conflicts. Every saved finding includes provenance and a change record.

Quick actions are Find companies, Refresh this category, Find sponsorship evidence, Show stale records, and Compare selected companies.

The agent can perform non-destructive refresh and save operations. Data deletion remains a user-controlled interface action.

## 11. Search and source policy

Use official company and careers pages first, Irish government employment-permit sources next, and credible job boards, sector sources, company directories, and reputable reporting as supporting sources. A search snippet alone is not sufficient evidence for a high-confidence claim when a source page can be retrieved.

The search adapter should support the OpenAI web-search capability as the primary path and a paid search provider as a configurable fallback. Search provider credentials are runtime secrets. The provider adapter records provider, query, result URLs, retrieval status, and estimated usage.

The system must distinguish:

- a company publicly stating that it sponsors or has sponsored permits;
- a role whose occupation, salary, and employer conditions may qualify;
- a general statement that does not establish sponsorship.

The UI should use these distinctions in labels and should not present potential qualification as confirmed sponsorship.

## 12. Reliability and error handling

- Runs use explicit IDs and idempotency keys so retries do not duplicate companies, jobs, or claims.
- Each item has queued, running, completed, partial, or failed status.
- Provider timeouts and rate limits are retried with bounded backoff.
- One failed source does not stop the remaining source searches for a company.
- Failed sources and parse errors appear in Refresh history with a retry action.
- Existing verified claims are not replaced by weaker evidence without retaining the old claim and source.
- Conflicting current claims remain visible with their sources and confidence.
- A paused schedule leaves stored records intact and prevents new scheduled work.
- The AI reports when a source is unavailable, stale, or inconclusive rather than inventing a result.

## 13. Privacy and security

- The Site remains private and requires Sites/ChatGPT authentication.
- Every database query and mutation is authorized against the authenticated owner ID.
- API keys and search credentials are configured as server-side Site secrets and never shipped to the browser.
- Uploaded files are stored in private R2 paths scoped to the owner.
- AI conversations and exports are owner-scoped.
- External research requests include only the company and query information needed for the search.
- No separate OAuth or custom session system is introduced; the Sites identity integration is used.

## 14. Sites implementation boundaries

- D1 is declared through `.openai/hosting.json` for structured data.
- R2 is declared for uploaded spreadsheets and exports.
- The frontend uses the Sites starter and server routes/actions for protected operations.
- Schema changes use the starter's migration workflow and immutable migration files.
- The weekly update uses a Sites-linked schedule and a server-side writer that reuses the same enrichment operations as manual refresh.
- The scheduled task stores no credentials in source, prompts, browser code, or output.
- The deployment workflow applies migrations before publishing the Worker and static client.

## 15. Testing and acceptance criteria

### Import tests

- CSV and XLSX with varied headings map to known fields.
- Unknown columns are retained as metadata.
- Duplicate domains and normalized company names merge correctly.
- Original uploads remain available in R2.

### Enrichment tests

- A new upload creates a company and starts enrichment automatically.
- A known company receives new claims without duplicate jobs or sources.
- Official and permit sources are linked to claims.
- County Dublin filtering excludes unsupported locations.
- Low-confidence and conflicting claims are visible.

### Refresh tests

- Manual refresh works for company, category, and full-database scopes.
- Weekly refresh and discovery runs are idempotent.
- Partial provider failures are retryable and do not erase existing values.
- Limits and usage counters are visible and enforceable.

### AI tests

- The assistant answers from saved data with citations.
- It runs fresh searches for current or missing information.
- It can start a refresh and report the resulting run.
- It saves sourced findings and change history.
- It distinguishes sponsorship evidence from potentially qualifying roles.

### Access and UI tests

- An unauthenticated visitor cannot access private records.
- API keys are absent from client bundles and browser network responses.
- Split Workspace works on desktop.
- Mobile category, list, profile, filters, refresh, and AI flows remain usable.
- Exported CSV/XLSX files open with the expected fields.

## 16. Future extension points

The data model leaves room for role matching, CV/profile inputs, saved job lists, application tracking, notifications, public sharing, and additional categories. These should be added as separate modules rather than changing the enrichment records into a personal job-application system.

