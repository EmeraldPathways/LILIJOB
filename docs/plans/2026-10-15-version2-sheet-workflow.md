# Version 2: Excel-first sector workspace

Approved requirements: GPT-5.6 Luna low for enrichment and medium for assistant. Imports never trigger research. Preserve every Excel field in editable sheet view, support arbitrary sector column values. Each sector has Sheet and Detailed views. Research selected acts on selected existing companies; Research all snapshots all company IDs in current sector, independently of search/filter. Enrichment fills gaps, retaining existing/imported values and source evidence. Discovery remains manual. No paid research on page load or imports.

Integration contract:
- CompanyListItem gains optional `sector: string | null` and `importedData: Record<string,string>`; detail uses same fields. Sector lives in metadata, original Excel cells under metadata.original. Original upload stays in R2.
- PATCH /api/companies/:id accepts `{ cells: Record<string,string> }`; updates raw spreadsheet cells and corresponding mapped profile fields, including sector/domain/categories, owner scoped. Returns `{ company }`.
- Sheet component props: companies, selectedIds: string[], onSelectionChange(ids), onSaveCell(id,column,value): Promise<void>, onOpenDetail(id). Component supplies sort/filter/search of all imported columns and dynamic horizontal table on mobile.
- Parent loads all owner companies once (and after mutations), filters sectors locally, no initial category race. Sector selection includes All companies + actual imported sector values, Unassigned as needed. Original four labels may remain default empty sector choices.
- Research selection sends bounded one-company requests, no automatic new-company discovery, progress + cancel stops future requests. New cheap research combines relevant gaps into one low-reasoning query. Assistant remains medium.
- Preserve public Sites audience and authenticated owner-scoped data writes. Push GitHub version2 and deploy via Sites.

Tasks: (1) sheet component and pure helpers, (2) imports/sector/cell persistence, (3) cost/search/enrichment correctness, (4) parent integration and scheduled-spend guard, (5) verify, review, deploy.

Progress: requirements approved; version2 clean baseline 92a4ac0 (GitHub same tree 9f33d6d). Prior imported data cleared. No browser control skill available; report any visual verification limit accurately.

Completed: parent sector views, queue CAS lock and resume, source field export, opt-in automatic-spend guard. Sheet and import workers complete. SQLite-backed 316-row import, owner isolation, competing cell edits, queue progression and exports verified. Research pipeline complete. Review added lease heartbeats, exact history links, explicit failed-company retries, safe CSV values, and atomic gap-only writes that preserve edits made during search. Full suite: 39 files / 123 tests; TypeScript and lint pass. Final guarded-write regression passes. Browser viewport QA unavailable in the managed environment.
