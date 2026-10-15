# Version 4 operations guide

## AI and search configuration

- `OPENAI_API_KEY`: server-only OpenAI credential.
- `OPENAI_MODEL`: defaults to `gpt-5.6-luna`.
- `OPENAI_ENRICHMENT_REASONING_EFFORT`: set to `low` for routine enrichment and evidence-constrained application-pack generation.
- `OPENAI_REASONING_EFFORT`: set to `medium` for the research assistant.
- `SEARCH_PROVIDER`: `openai`, `tavily` or the default hybrid adapter.
- `TAVILY_API_KEY`: optional server-only credential used for explicitly bespoke searches; routine enrichment uses OpenAI web search so the 1,000-search Tavily allowance is not consumed by every company.

Imports store source rows and do not start enrichment. Enrichment is a user-controlled secondary action, fills gaps without replacing imported values, and supports selected existing companies or all companies in the current sector. `gpt-5.6-luna` calls used for enrichment are sent with low reasoning; the assistant remains medium.

## Gmail and outreach

The existing OAuth connection is reused. Required server-only names are `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` and `GMAIL_TOKEN_ENCRYPTION_KEY`. A Version 4 send requires a public contact, an editable individual draft, explicit approval and a connected Gmail provider. Provider-confirmed message IDs are the only sent state. Unknown outcomes are recorded and never blindly retried. Do not send a controlled test message to a real recruiter.

## Jobs, signals and permit data

Only public HTTP(S) career sources are accepted. SSRF checks reject local/private URL forms and unsafe redirects. Greenhouse/Lever public feed shapes are parsed when the source permits them. A 403, 429, empty response or fetch error is recorded as a source status and does not by itself close a saved job. Source facts show checked dates and URLs; model analysis is labelled separately. Removal requires two comparable supported-source misses.

Permit evaluations keep effective dates, official URLs, input evidence and explicit unknown states. They are evidence labels, not legal conclusions. Signal records are possible hiring signals and are never treated as proof of an open vacancy.

## Agent budgets and recovery

The server registry contains 20 tools. Every tool name and argument is validated server-side; external tools (`create_application`, `update_application_stage`, `send_outreach`, `schedule_communication`) remain blocked in the agent runner and must use their dedicated approval workflow.

Default per-run limits are 10 search units, 20,000 tokens, 100 cost cents and 20 steps. Run and step usage is persisted in `agent_runs`/`agent_steps` checkpoints. A run can be cancelled, resumed from its checkpoint or retried from a failed step (with a three-attempt retry cap). The in-process concurrency/rate limiter is not shared across separate server isolates; production should add a durable platform rate limit before enabling high-volume execution.

## Protected controls

- `V4_MIGRATION_TOKEN` and optional `V4_MIGRATION_OWNER_ID` protect the additive migration route.
- `V4_PERMIT_RULE_ADMIN_ID` restricts updates to shared effective-dated permit rules.
- No secrets are placed in client bundles, generated documents, source control or general logs.
- Import and candidate-document endpoints reject unsupported types and files over 10 MB; XLSX parsing is bounded to 20 worksheets, 200 columns and 25,000 rows.

## Schedules and release controls

The user-facing refresh actions are bounded and explicit. Daily high-priority/weekly lower-priority scheduled queues, notification digests and live DETE refresh require a staging deployment and should be enabled only after the source/cost budgets are configured. No production migration, enrichment, Gmail test send or deployment was run for this branch.

## Incident handling

For a bad import, stop enrichment, export the affected source rows, compare the import manifest and use the existing import/retry history. For a source outage, retain the last verified snapshot and mark the run partial/stale. For Gmail ambiguity, check Gmail Sent before retrying and keep the unknown event. For suspected ownership leakage, disable the affected route, preserve the audit event and inspect owner-scoped predicates before reopening it.

## Current security blocker

`pnpm audit --prod --audit-level high` reports 16 vulnerabilities, including critical/high advisories in the pinned Next.js, `xlsx`, Browserslist, source-map-js and sharp dependency paths. The branch is not production-ready until those dependencies are patched/replaced or a security owner records a risk decision.
