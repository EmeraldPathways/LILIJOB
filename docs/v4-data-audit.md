# Version 4 data audit

Audit date: 2026-10-15

Source workbook: `/workspace/scratch/dfb8bae05a1c/upload/LILI JOB HUNT DATA (1).xlsx`

The workbook was read from the supplied upload in read-only mode. No production import, delete or enrichment was run during this audit.

## Workbook shape

| Sheet | Recognised headers | Data rows |
|---|---|---:|
| Fintech | Company, Sector, Address, Website, Company LinkedIn URL, Company contact email, Company careers page | 316 |
| Tech Permits | Company Name, Sector, Address, Website, Careers Page, LinkedIn, Contact Email, Permit Amount | 270 |
| Ecommerce | Company Name, Sector, Address, Website, Careers, LinkedIn, Email | 155 |
| Startups | Company, Sector, Address, Website, Careers, LinkedIn, Email | 250 |
| **Total** | Header aliases mapped to the canonical import fields | **991** |

The extra worksheet cells containing summary labels or formatting were ignored. The permit amount column is retained as row metadata; it is not treated as proof that a particular vacancy is eligible.

## Normalisation and overlap

- Raw case-insensitive company-name keys: 812.
- Repeated name rows: 179.
- Names appearing under more than one sector value: 174.
- Valid website values: 915; blank website values: 33; malformed or placeholder website values: 43.
- Blank careers values: 185.
- Blank LinkedIn values: 146.
- Email values present: 991. 778 rows match a generic-inbox prefix classification such as `info@`, `sales@`, `contact@`, `press@`, `support@`, `hr@` or `careers@`.

The existing stored import audit is the authoritative reconciliation used for the current private Site: 991 source rows, 769 accepted unique company records, 222 duplicate source rows and 0 import errors. The difference between raw name keys and stored accepted companies is expected because the importer also uses normalised domains and reviewable duplicate handling. A similar name or domain never merges distinct subsidiaries automatically.

Existing sector counts are preserved as source-row counts: Fintech 316, Tech Permits 270, Ecommerce 155 and Startups 250. Sector membership remains many-to-many through the existing category/source-row model.

## Handling rules

1. Every accepted row keeps its import/source-row provenance and original field values.
2. Blank or malformed websites remain visible as unknown/needs review; they are not replaced with guessed URLs.
3. Spreadsheet emails are company-source data. They are classified as generic, sales, recruitment-specific or unknown and are never promoted to a named recruiter without a public source.
4. Careers values such as `[link removed]` remain unavailable rather than being reconstructed.
5. Re-imports use the existing idempotent normalisation path and do not trigger enrichment or paid research.
6. Version 4 backfill is additive: it links existing jobs, sources and public contacts into new owner-scoped records and does not delete or rewrite the imported company data.

## Verification still required before a production import

Run the supplied workbook through the staging import preview, compare row/accepted/duplicate/error counts with this audit, inspect at least ten companies per sector and twenty overlapping companies, then export a before/after count report. Production data must not be mutated until those counts match and a backup is available.
