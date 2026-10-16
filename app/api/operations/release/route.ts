import { env } from 'cloudflare:workers';
export const dynamic = 'force-dynamic';
const dataTables = ['companies','company_categories','imports','jobs','contacts','sources','company_claims','permit_evidence','refresh_runs','change_history','ai_conversations','ai_messages','candidate_profiles','candidate_documents','experience_evidence','job_snapshots','job_discovery_runs','job_matches','company_signals','recruitment_contacts','applications','application_events','outreach_drafts','outreach_events','application_packs','sector_pitches','interviews','interview_packs','daily_action_items','job_search_metrics_daily','notification_preferences','user_activity_audit','agent_runs','agent_steps','settings_versions','permit_evaluations','job_radar_schedules','provider_usage_events','usage_budgets','usage_reservations','scheduled_task_runs','notification_events','cv_edit_proposals','outreach_attachments','application_tasks','candidate_work_permissions','pitch_usages'];
export async function POST(request: Request) {
  const token = env.RELEASE_OPERATIONS_TOKEN; const ownerId = env.RELEASE_OPERATIONS_OWNER_ID;
  const expiry = Date.parse(env.RELEASE_OPERATIONS_EXPIRES_AT ?? '');
  if (!token || !ownerId || !Number.isFinite(expiry) || Date.now() >= expiry) return new Response(null, { status: 404 });
  if (request.headers.get('authorization') !== `Bearer ${token}`) return new Response(null, { status: 401 });
  if (!env.DB || !env.BUCKET) return new Response(null, { status: 503 });
  const body = await request.json().catch(() => null) as { action?: string; backupKey?: string } | null;
  if (!body || !['backup','status','verify-backup','ai-smoke','selftest'].includes(body.action ?? '')) return new Response(null, { status: 400 });
  if (body.action === 'selftest') {
    const { runReleaseSelfTest } = await import('../../../../lib/v4/release-selftest');
    const result = await runReleaseSelfTest();
    return Response.json(result, { status: result.passed ? 200 : 500, headers: { 'cache-control': 'private, no-store' } });
  }
  if (body.action === 'ai-smoke') {
    const { askOpenAI, configuredModel } = await import('../../../../lib/ai/client');
    const result = await askOpenAI('Reply with the single word OK.', { reasoningEffort: 'low', maxOutputTokens: 256 });
    return Response.json({ model: configuredModel(), reasoningEffort: 'low', successful: result.text.trim().toUpperCase().includes('OK'), usage: (result.raw as Record<string,unknown>).usage ?? null }, { headers: { 'cache-control': 'private, no-store' } });
  }
  const existing = await env.DB.prepare("SELECT name, sql FROM sqlite_master WHERE type='table'").all<{ name: string; sql: string }>();
  const available = new Map(existing.results.map(row => [row.name, row.sql]));
  const tables: Record<string, unknown[]> = {}; const counts: Record<string, number> = {};
  for (const name of dataTables) {
    if (!available.has(name)) continue;
    const query = env.DB.prepare(`SELECT * FROM "${name}"${ownerId === "all-site-data" ? "" : " WHERE owner_id = ?"} LIMIT 25001`);
    const result = await (ownerId === "all-site-data" ? query : query.bind(ownerId)).all<Record<string, unknown>>();
    if (result.results.length > 25000) return Response.json({ error: 'Backup size requires a paginated export.', table: name }, { status: 413 });
    counts[name] = result.results.length; tables[name] = result.results;
  }
  const companyRows = tables.companies ?? []; const collections: Record<string, number> = {};
  for (const raw of companyRows) {
    const row = raw as Record<string, unknown>;
    try { const metadata = JSON.parse(String(row.metadata_json ?? '{}')); for (const label of metadata.collections ?? []) if (typeof label === 'string') collections[label] = (collections[label] ?? 0) + 1; } catch { /* malformed legacy metadata stays in backup */ }
  }
  const gmailCount = available.has('gmail_connections') ? await env.DB.prepare('SELECT COUNT(*) AS count FROM gmail_connections').first<{ count: number }>() : null;
  const manifest = { counts, collections, integrations: { gmailConfigured: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GMAIL_TOKEN_ENCRYPTION_KEY), gmailConnectedAccounts: gmailCount?.count ?? 0 }, checkedAt: new Date().toISOString() };
  if (body.action === 'verify-backup') {
    const key = body.backupKey;
    if (!key || !key.startsWith(`private-release-backups/${ownerId}/`) || key.includes('..')) return new Response(null, { status: 400 });
    const object = await env.BUCKET.get(key);
    if (!object) return new Response(null, { status: 404 });
    const previous = await object.json<{ tables: Record<string, Record<string, unknown>[]> }>();
    const canonical = (rows: unknown[]) => JSON.stringify([...rows].sort((a,b) => String((a as Record<string,unknown>).id).localeCompare(String((b as Record<string,unknown>).id))));
    const preserved = ['companies','company_categories','imports'].map(table => ({ table, preserved: canonical(previous.tables[table] ?? []) === canonical(tables[table] ?? []), before: previous.tables[table]?.length ?? 0, after: tables[table]?.length ?? 0 }));
    return Response.json({ ...manifest, preservation: preserved }, { headers: { 'cache-control': 'private, no-store' } });
  }
  if (body.action === 'status') return Response.json(manifest, { headers: { 'cache-control': 'private, no-store' } });
  const payload = JSON.stringify({ version: 1, ownerId, manifest, schema: Object.fromEntries(dataTables.filter(name => available.has(name)).map(name => [name, available.get(name)])), tables });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  const sha256 = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,'0')).join('');
  const key = `private-release-backups/${ownerId}/${Date.now()}-${sha256}.json`;
  await env.BUCKET.put(key, payload, { httpMetadata: { contentType: 'application/json' }, customMetadata: { sha256 } });
  const saved = await env.BUCKET.head(key);
  if (!saved || saved.size !== new TextEncoder().encode(payload).byteLength) return Response.json({ error: 'Backup readback failed.' }, { status: 500 });
  return Response.json({ ...manifest, backup: { key, bytes: saved.size, sha256, credentialsExcluded: true, originalUploadsPreserved: true } }, { headers: { 'cache-control': 'private, no-store' } });
}
