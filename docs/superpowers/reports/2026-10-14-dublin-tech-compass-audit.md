# Dublin Tech Compass Reliability Audit

Date: 2026-10-14

## Result

The import lifecycle and the surrounding research workbench have been repaired locally and are ready for private deployment.

## Repairs verified

- The authenticated Imports page now renders through a client panel and reads persisted import rows from `/api/imports`.
- Uploads are stored in R2 before their D1 record is created; persistence failures leave a durable failed import or clean up the private object.
- Duplicate names and domains are matched owner-scoped, unknown spreadsheet columns remain metadata, and non-Dublin locations are rejected when supplied.
- Enrichment runs in batches of 8 with concurrency 2. Forward continuation and retryable company IDs are recorded in the run cursor.
- Discovery stores real company IDs, resumes partial discovery, and routine research defaults to OpenAI web search. Bespoke AI research routes to Tavily through the default hybrid provider.
- Jobs, careers claims, public recruitment contacts, permit evidence, sources, and change history are written idempotently.
- Dashboard filters, all four research lenses, profile tabs, dedicated mobile profile routes, history retry actions, settings usage controls, and CSV/XLSX exports are covered.
- Mobile CSS removes the nested workspace/profile scroll trap and keeps the filter sheet and category selector available.

## Verification

- Vitest: 26 files, 66 tests passed.
- ESLint: passed.
- TypeScript: passed.
- Vinext production build: passed; all protected pages and API routes included.
- Client bundle scan: no `OPENAI_API_KEY`, `TAVILY_API_KEY`, or Sites service-auth header found.
- Migration inspection: existing immutable D1 migrations are present; no schema change was required for this repair.

## Browser limitation

The managed environment does not expose the browser-control skill, and the available private browser session is signed out. Static desktop/mobile contracts, server rendering tests, route/auth tests, and the production-equivalent build were used instead. A final authenticated click-through of upload, scrolling, tabs, and filters should be repeated after deployment if browser access becomes available.

## Production handoff

- Live URL: https://dublin-tech-compass.emeraldpathways.chatgpt.site
- Published version: `appgprj_6acfe06dcd308191a3961d2355fe6e31~appgver_965a79ec57148191b0f6b9719d4e1703`
- Deployment status: succeeded.
- Post-deploy Worker error log check: no events returned for the preceding 30 minutes.
- Existing owner-only access and the Sunday 03:00 Europe/Dublin schedule were preserved.
