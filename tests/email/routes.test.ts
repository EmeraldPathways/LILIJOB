import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import { decryptToken, encryptToken } from "../../lib/email/core";

const state = vi.hoisted(() => ({
  db: null as unknown,
  env: {
    GOOGLE_CLIENT_ID: "client-id",
    GOOGLE_CLIENT_SECRET: "client-secret",
    GMAIL_TOKEN_ENCRYPTION_KEY: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
  },
}));

vi.mock("../../db", () => ({ getDb: () => state.db }));
vi.mock("cloudflare:workers", () => ({ env: state.env }));

import { GET } from "../../app/api/email/route";
import { GET as connect } from "../../app/api/email/connect/route";
import { GET as callback } from "../../app/api/email/callback/route";
import { POST as send } from "../../app/api/email/send/route";
import { POST as disconnect } from "../../app/api/email/disconnect/route";

let sqlite: DatabaseSync;
const future = new Date(Date.now() + 60 * 60_000).toISOString();

function adapter() {
  return {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...input: unknown[]) { values = input; return statement; },
        async all() {
          const rows = sqlite.prepare(sql).all(...values as never[]);
          return { results: rows, success: true, meta: {} };
        },
        async raw() {
          return sqlite.prepare(sql).all(...values as never[]).map((row) => Object.values(row));
        },
        async run() { return sqlite.prepare(sql).run(...values as never[]); },
      };
      return statement;
    },
  };
}

function appRequest(path: string, ownerId = "owner-a", init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("oai-authenticated-user-id", ownerId);
  headers.set("oai-authenticated-user-email", `${ownerId}@example.test`);
  return new Request(`https://site.example${path}`, { ...init, headers });
}

function sendRequest(companyIds: string[], requestId = "request-1") {
  return appRequest("/api/email/send", "owner-a", {
    method: "POST",
    headers: { origin: "https://site.example", "content-type": "application/json" },
    body: JSON.stringify({ companyIds, subject: "Hello", body: "Kia ora", requestId }),
  });
}

async function addConnection(ownerId = "owner-a") {
  sqlite.prepare(`INSERT INTO gmail_connections
    (id,owner_id,google_email,encrypted_access_token,encrypted_refresh_token,access_token_expires_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    `gmail-${ownerId}`,
    ownerId,
    "sender@example.test",
    await encryptToken("access-secret", state.env.GMAIL_TOKEN_ENCRYPTION_KEY),
    null,
    future,
    new Date().toISOString(),
    new Date().toISOString(),
  );
}

beforeEach(async () => {
  Object.assign(state.env, {
    GOOGLE_CLIENT_ID: "client-id",
    GOOGLE_CLIENT_SECRET: "client-secret",
    GMAIL_TOKEN_ENCRYPTION_KEY: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
  });
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE companies (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, metadata_json TEXT NOT NULL);
    CREATE TABLE contacts (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, company_id TEXT NOT NULL, email TEXT, created_at TEXT);
    CREATE TABLE gmail_connections (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL UNIQUE, google_email TEXT NOT NULL, encrypted_access_token TEXT NOT NULL, encrypted_refresh_token TEXT, access_token_expires_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE gmail_oauth_states (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, state_hash TEXT NOT NULL UNIQUE, pkce_verifier TEXT NOT NULL, redirect_uri TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE email_deliveries (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, request_id TEXT NOT NULL, company_id TEXT NOT NULL, company_name TEXT NOT NULL, "to" TEXT NOT NULL, subject TEXT NOT NULL, status TEXT NOT NULL, error TEXT, provider_message_id TEXT, created_at TEXT, updated_at TEXT, UNIQUE(owner_id,request_id,company_id));
  `);
  state.db = drizzle(adapter() as never, { schema });
  sqlite.prepare("INSERT INTO companies VALUES (?,?,?,?)").run(
    "co-a", "owner-a", "Acme", JSON.stringify({ sector: "Fintech", original: { "Company Email": "talent@acme.example" } }),
  );
  sqlite.prepare("INSERT INTO companies VALUES (?,?,?,?)").run(
    "co-b", "owner-a", "Beta", JSON.stringify({ sector: "Health", original: {} }),
  );
  sqlite.prepare("INSERT INTO companies VALUES (?,?,?,?)").run(
    "co-private", "owner-b", "Private Co", JSON.stringify({ original: { "Company Email": "private@example.test" } }),
  );
  sqlite.prepare("INSERT INTO contacts VALUES (?,?,?,?,?)").run(
    "ct-b", "owner-a", "co-b", "recruiter@beta.example", new Date().toISOString(),
  );
  await addConnection();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "gmail-message" })));
});

describe("email API", () => {
  it("returns configured state, owner recipients, and exact history fields", async () => {
    sqlite.prepare(`INSERT INTO email_deliveries
      (id,owner_id,request_id,company_id,company_name,"to",subject,status,error,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      "delivery-1", "owner-a", "request-old", "co-a", "Acme", "talent@acme.example", "Hello", "sent", null, future, future,
    );
    const response = await GET(appRequest("/api/email"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      configured: true,
      connected: true,
      email: "sender@example.test",
      recipients: [
        { companyId: "co-a", companyName: "Acme", sector: "Fintech", email: "talent@acme.example" },
        { companyId: "co-b", companyName: "Beta", sector: "Health", email: "recruiter@beta.example" },
      ],
      history: [{ id: "delivery-1", companyName: "Acme", to: "talent@acme.example", subject: "Hello", status: "sent" }],
    });
    const unauthorized = await GET(new Request("https://site.example/api/email"));
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("cache-control")).toBe("private, no-store");
  });

  it("reports an unconfigured account honestly and gives connect an actionable 503", async () => {
    Object.assign(state.env, { GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", GMAIL_TOKEN_ENCRYPTION_KEY: "" });
    const overview = await GET(appRequest("/api/email", "owner-b"));
    await expect(overview.json()).resolves.toMatchObject({ configured: false, connected: false });
    const response = await connect(appRequest("/api/email/connect", "owner-b"));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "GMAIL_NOT_CONFIGURED", message: expect.stringContaining("encryption key") },
    });
    expect(sqlite.prepare("SELECT count(*) AS count FROM gmail_connections WHERE owner_id='owner-b'").get()).toMatchObject({ count: 0 });
  });

  it("sends separate messages and never replays a stored request recipient", async () => {
    const first = await send(sendRequest(["co-a", "co-b"]));
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    await expect(first.json()).resolves.toMatchObject({ sent: 2, failed: 0, unknown: 0 });
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const messages = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as { raw: string });
    const mimeMessages = messages.map(({ raw }) => Buffer.from(raw, "base64url").toString("utf8"));
    expect(mimeMessages.map((message) => message.match(/^To: (.+)$/m)?.[1])).toEqual([
      "talent@acme.example",
      "recruiter@beta.example",
    ]);
    expect(mimeMessages.every((message) => !message.includes("talent@acme.example, recruiter@beta.example"))).toBe(true);

    const repeated = await send(sendRequest(["co-a", "co-b"]));
    await expect(repeated.json()).resolves.toMatchObject({ sent: 2, failed: 0, unknown: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("validates every recipient before making any provider request", async () => {
    sqlite.prepare("UPDATE companies SET metadata_json=? WHERE id=?").run(
      JSON.stringify({ original: { Notes: "no exact email header" } }), "co-a",
    );
    sqlite.prepare("DELETE FROM contacts WHERE company_id='co-a'").run();
    const response = await send(sendRequest(["co-a", "co-b"], "preflight"));
    expect(response.status).toBe(422);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(sqlite.prepare("SELECT count(*) AS count FROM email_deliveries").get()).toMatchObject({ count: 0 });
  });

  it("keeps sends owner scoped and requires a same-origin POST", async () => {
    const otherOwner = await send(sendRequest(["co-private"], "other-owner"));
    expect(otherOwner.status).toBe(404);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();

    const missingOrigin = appRequest("/api/email/send", "owner-a", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyIds: ["co-a"], subject: "Hello", body: "Hi", requestId: "no-origin" }),
    });
    expect((await send(missingOrigin)).status).toBe(403);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("records an uncertain provider result and does not automatically retry it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream timeout", { status: 504 })));
    const first = await send(sendRequest(["co-a"], "uncertain"));
    await expect(first.json()).resolves.toMatchObject({ sent: 0, failed: 0, unknown: 1 });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    const second = await send(sendRequest(["co-a"], "uncertain"));
    await expect(second.json()).resolves.toMatchObject({ sent: 0, failed: 0, unknown: 1 });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("marks a successful HTTP response without a Gmail message ID as unknown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
    const response = await send(sendRequest(["co-a"], "missing-provider-id"));
    await expect(response.json()).resolves.toMatchObject({ sent: 0, failed: 0, unknown: 1 });
    expect(sqlite.prepare("SELECT status FROM email_deliveries WHERE request_id='missing-provider-id'").get()).toMatchObject({ status: "unknown" });
  });

  it("refreshes an expired access token and retains the existing refresh token", async () => {
    sqlite.prepare(`UPDATE gmail_connections SET encrypted_access_token=?,encrypted_refresh_token=?,access_token_expires_at=? WHERE owner_id='owner-a'`).run(
      await encryptToken("old-access", state.env.GMAIL_TOKEN_ENCRYPTION_KEY),
      await encryptToken("refresh-secret", state.env.GMAIL_TOKEN_ENCRYPTION_KEY),
      new Date(Date.now() - 60_000).toISOString(),
    );
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({ access_token: "new-access", expires_in: 3600 }))
      .mockResolvedValueOnce(Response.json({ id: "confirmed-message" })));
    const response = await send(sendRequest(["co-a"], "refresh-token"));
    await expect(response.json()).resolves.toMatchObject({ sent: 1, failed: 0, unknown: 0 });
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls).toHaveLength(2);
    expect(String(calls[0]?.[0])).toBe("https://oauth2.googleapis.com/token");
    const connection = sqlite.prepare("SELECT * FROM gmail_connections WHERE owner_id='owner-a'").get() as Record<string, unknown>;
    await expect(decryptToken(String(connection.encrypted_access_token), state.env.GMAIL_TOKEN_ENCRYPTION_KEY)).resolves.toBe("new-access");
    await expect(decryptToken(String(connection.encrypted_refresh_token), state.env.GMAIL_TOKEN_ENCRYPTION_KEY)).resolves.toBe("refresh-secret");
  });

  it("starts OAuth with offline send-only consent and completes a one-use owner-bound callback", async () => {
    const started = await connect(appRequest("/api/email/connect"));
    expect(started.status).toBe(302);
    expect(started.headers.get("cache-control")).toBe("private, no-store");
    const authUrl = new URL(started.headers.get("location")!);
    expect(authUrl.searchParams.get("access_type")).toBe("offline");
    expect(authUrl.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email",
    );
    const cookie = started.headers.get("set-cookie")!;
    const stateValue = authUrl.searchParams.get("state")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");

    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({
        access_token: "access-new",
        refresh_token: "refresh-new",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email",
      }))
      .mockResolvedValueOnce(Response.json({ email: "researcher@gmail.test", verified_email: true })));
    const callbackRequest = appRequest(`/api/email/callback?code=code-value&state=${encodeURIComponent(stateValue)}`);
    const cookiePair = cookie.split(";")[0];
    callbackRequest.headers.set("cookie", cookiePair);
    const completed = await callback(callbackRequest);
    expect(completed.status).toBe(303);
    expect(completed.headers.get("cache-control")).toBe("private, no-store");
    expect(completed.headers.get("location")).toBe("https://site.example/email?connected=true");
    const saved = sqlite.prepare("SELECT * FROM gmail_connections WHERE owner_id='owner-a'").get() as Record<string, unknown>;
    expect(saved.google_email).toBe("researcher@gmail.test");
    await expect(decryptToken(String(saved.encrypted_refresh_token), state.env.GMAIL_TOKEN_ENCRYPTION_KEY)).resolves.toBe("refresh-new");

    const replay = appRequest(`/api/email/callback?code=code-value&state=${encodeURIComponent(stateValue)}`);
    replay.headers.set("cookie", cookiePair);
    expect((await callback(replay)).headers.get("location")).toContain("/email?error=");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("refuses to consume another owner's OAuth state", async () => {
    const started = await connect(appRequest("/api/email/connect"));
    const stateValue = new URL(started.headers.get("location")!).searchParams.get("state")!;
    const callbackRequest = appRequest(`/api/email/callback?code=code-value&state=${encodeURIComponent(stateValue)}`, "owner-b");
    callbackRequest.headers.set("cookie", started.headers.get("set-cookie")!.split(";")[0]);
    expect((await callback(callbackRequest)).headers.get("location")).toContain("/email?error=");
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("does not save a connection when Google withholds the Gmail send scope", async () => {
    const started = await connect(appRequest("/api/email/connect"));
    const stateValue = new URL(started.headers.get("location")!).searchParams.get("state")!;
    const callbackRequest = appRequest(`/api/email/callback?code=code-value&state=${encodeURIComponent(stateValue)}`);
    callbackRequest.headers.set("cookie", started.headers.get("set-cookie")!.split(";")[0]);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      access_token: "access-new",
      refresh_token: "refresh-new",
      scope: "https://www.googleapis.com/auth/userinfo.email",
    })));
    const response = await callback(callbackRequest);
    expect(response.headers.get("location")).toContain("Gmail+send+permission");
    expect(sqlite.prepare("SELECT count(*) AS count FROM gmail_connections WHERE owner_id='owner-a'").get()).toMatchObject({ count: 1 });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("clears local credentials on same-origin disconnect", async () => {
    const response = await disconnect(appRequest("/api/email/disconnect", "owner-a", {
      method: "POST",
      headers: { origin: "https://site.example" },
    }));
    expect(response.status).toBe(200);
    expect(sqlite.prepare("SELECT count(*) AS count FROM gmail_connections WHERE owner_id='owner-a'").get()).toMatchObject({ count: 0 });
  });
});
