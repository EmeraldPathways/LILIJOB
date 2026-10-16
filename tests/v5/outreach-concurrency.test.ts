import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../db/schema";
import { v4MigrationStatements } from "../../lib/v4/migration";

const state: { db: ReturnType<typeof drizzle> } = { db: undefined as never };
vi.mock("../../db", () => ({ getDb: () => state.db }));

function adapter(sqlite: DatabaseSync) {
  return {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...input: unknown[]) { values = input; return statement; },
        async all() { return { results: sqlite.prepare(sql).all(...values as never[]), success: true, meta: {} }; },
        async raw() { return sqlite.prepare(sql).all(...values as never[]).map((row) => Object.values(row)); },
        async run() { return sqlite.prepare(sql).run(...values as never[]); },
      };
      return statement;
    },
  };
}

let sqlite: DatabaseSync;

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  for (const statement of v4MigrationStatements) sqlite.exec(statement);
  state.db = drizzle(adapter(sqlite) as never, { schema });
});

afterEach(() => sqlite.close());

describe("atomic outreach send reservation", () => {
  it("allows only one provider attempt for concurrent claims", async () => {
    const { claimOutreachSend, settleOutreachEvent } = await import("../../lib/v4/outreach-repository");
    const input = { draftId: "draft-1", applicationId: null, dedupKey: "owner-a:draft-1:contact-1", payloadFingerprint: "fingerprint-1", approvedBy: "owner-a", approvedAt: "2026-10-16T08:00:00.000Z" };
    const claims = await Promise.all([
      claimOutreachSend("owner-a", input),
      claimOutreachSend("owner-a", input),
    ]);
    expect(claims.filter((claim) => claim.claimed)).toHaveLength(1);
    expect(claims.filter((claim) => !claim.claimed)).toHaveLength(1);
    expect(claims[0].event.sendState).toBe("sending");
    const claimed = claims.find((claim) => claim.claimed);
    expect(claimed).toBeDefined();
    const settled = await settleOutreachEvent("owner-a", claimed!.event.id, { sendState: "sent", providerMessageId: "gmail-message-1", threadId: "thread-1" });
    expect(settled?.sendState).toBe("sent");
    const retry = await claimOutreachSend("owner-a", input);
    expect(retry.claimed).toBe(false);
    expect(retry.event.providerMessageId).toBe("gmail-message-1");
  });
});
