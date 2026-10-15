import { describe, expect, it, vi } from "vitest";

const { state, runV4Migration } = vi.hoisted(() => ({
  state: { env: { V4_MIGRATION_TOKEN: undefined as string | undefined, DB: undefined as unknown } },
  runV4Migration: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: state.env }));
vi.mock("../../lib/v4/migration-runner", () => ({ runV4Migration }));

import { POST } from "../../app/api/v4/migrate/route";

describe("Version 4 migration route", () => {
  it("is disabled when no server token is configured", async () => {
    state.env.V4_MIGRATION_TOKEN = undefined;
    expect((await POST(new Request("https://example.test/api/v4/migrate", { method: "POST" }))).status).toBe(404);
  });

  it("rejects missing or incorrect authorization", async () => {
    state.env.V4_MIGRATION_TOKEN = "secret";
    expect((await POST(new Request("https://example.test/api/v4/migrate", { method: "POST" }))).status).toBe(401);
    expect((await POST(new Request("https://example.test/api/v4/migrate", { method: "POST", headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
  });

  it("runs only with the configured bearer token", async () => {
    state.env.V4_MIGRATION_TOKEN = "secret";
    state.env.DB = {};
    runV4Migration.mockResolvedValue({ version: 1, statements: 53 });
    const response = await POST(new Request("https://example.test/api/v4/migrate", { method: "POST", headers: { authorization: "Bearer secret" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ version: 1, statements: 53 });
    expect(runV4Migration).toHaveBeenCalledWith(state.env.DB);
  });
});
