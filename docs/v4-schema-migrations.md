# Version 4 schema and recovery

## Additive migrations

- `drizzle/0003_burly_nick_fury.sql` creates the core Version 4 entities and indexes.
- `drizzle/0004_jazzy_warstar.sql` adds versioned `application_packs` and `sector_pitches`.
- `lib/v4/migration.ts` exposes the repeat-safe 59-statement list for Sites/D1 environments that use the controlled migration route.
- `lib/v4/migration-runner.ts` executes the statements in order and returns the schema version and applied statement count.
- `app/api/v4/migrate/route.ts` is server-only and requires `Authorization: Bearer $V4_MIGRATION_TOKEN`; the owner is taken from `V4_MIGRATION_OWNER_ID` or an explicitly supplied owner ID.

All DDL uses `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`. The migrations do not drop or alter legacy company, import, source, job, contact, permit or Gmail tables. The backfill is separately re-runnable and preserves legacy rows.

## New persistence units

Candidate profiles/documents/evidence, job snapshots/discovery runs/matches, company signals, recruitment contacts, applications/events, outreach drafts/events, application packs, sector pitches, interviews/packs, action items, daily metrics, notification preferences, audit events, agent runs/steps, settings versions and effective-dated permit rules/evaluations are owner-scoped in application queries and indexed by owner.

## Backfill behaviour

`lib/v4/backfill.ts` links existing owner-scoped jobs to a stable snapshot hash, links legacy contacts into the public-contact table, and is idempotent on repeat execution. Generic inboxes are not automatically promoted to named recruiter contacts. Missing facts remain null/unknown.

## Backup and rollback procedure

Before applying a runtime migration:

1. Export legacy companies, categories, sources, jobs, contacts, permit evidence, imports, refresh runs and Gmail connection metadata using the authenticated export path. Do not export OAuth token material.
2. Record table counts and a timestamped checksum/count manifest.
3. Apply the additive statements in staging, run the migration and backfill twice, and compare counts and owner IDs.
4. If rollback is required, disable Version 4 routes with the feature flag, restore the legacy export into a clean database or drop only the newly created V4 tables in a controlled maintenance operation. Never delete the legacy tables as a rollback shortcut.
5. Re-run the count manifest and owner-isolation checks before reopening the Site.

Automated evidence covers a fresh SQLite database, repeat execution, existing legacy tables and owner-scoped repositories. No staging or production migration/backfill was executed for this branch. That is a release gate, not evidence of failure.
