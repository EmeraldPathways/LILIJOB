import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  env: { V4_JOB_RADAR_SCHEDULE_TOKEN: undefined as string | undefined },
  getSchedule: vi.fn(),
  saveSchedule: vi.fn(),
  dispatch: vi.fn(),
  runOwnerNow: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: state.env }));
vi.mock("../../lib/v4/schedule/job-radar-schedule", () => ({
  getJobRadarSchedule: state.getSchedule,
  saveJobRadarSchedule: state.saveSchedule,
  dispatchDueJobRadarSchedules: state.dispatch,
  runOwnerJobRadarScheduleNow: state.runOwnerNow,
}));

import { GET, PUT } from "../../app/api/v4/schedules/job-radar/route";
import { POST as dispatch } from "../../app/api/v4/schedules/job-radar/dispatch/route";
import { POST as runDue } from "../../app/api/v4/schedules/job-radar/run-due/route";

function userRequest(url: string, init: RequestInit = {}, authenticated = true) {
  const headers = new Headers(init.headers);
  if (authenticated) {
    headers.set("oai-authenticated-user-id", "owner-a");
    headers.set("oai-authenticated-user-email", "owner@example.test");
  }
  return new Request(`https://site.test${url}`, { ...init, headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.env.V4_JOB_RADAR_SCHEDULE_TOKEN = undefined;
  state.getSchedule.mockResolvedValue(null);
  state.saveSchedule.mockResolvedValue({ id: "schedule-a", ownerId: "owner-a", companyIds: ["company-a"], cadence: "daily", enabled: true });
  state.dispatch.mockResolvedValue({ schedulesClaimed: 1, companiesProcessed: 2, continuations: 1, completedSchedules: 0, partialSchedules: 0 });
  state.runOwnerNow.mockResolvedValue({ schedulesClaimed: 1, companiesProcessed: 2, continuations: 1, completedSchedules: 0, partialSchedules: 0 });
});

describe("Job Radar schedule routes", () => {
  it("requires user identity and scopes saved schedules to the signed-in owner", async () => {
    expect((await GET(userRequest("/api/v4/schedules/job-radar", {}, false))).status).toBe(401);
    expect((await GET(userRequest("/api/v4/schedules/job-radar"))).status).toBe(200);
    expect(state.getSchedule).toHaveBeenCalledWith("owner-a");
  });

  it("validates the opt-in company scope and daily or weekly cadence before saving", async () => {
    const badScope = await PUT(userRequest("/api/v4/schedules/job-radar", { method: "PUT", body: JSON.stringify({ companyIds: [], cadence: "daily", enabled: true }) }));
    const badCadence = await PUT(userRequest("/api/v4/schedules/job-radar", { method: "PUT", body: JSON.stringify({ companyIds: ["company-a"], cadence: "monthly", enabled: true }) }));
    expect(badScope.status).toBe(400);
    expect(badCadence.status).toBe(400);
    expect(state.saveSchedule).not.toHaveBeenCalled();

    const response = await PUT(userRequest("/api/v4/schedules/job-radar", { method: "PUT", body: JSON.stringify({ companyIds: ["company-a"], cadence: "daily", enabled: true }) }));
    expect(response.status).toBe(200);
    expect(state.saveSchedule).toHaveBeenCalledWith("owner-a", { companyIds: ["company-a"], cadence: "daily", enabled: true });
  });

  it("keeps the dispatcher disabled without a service token and rejects bad bearer credentials", async () => {
    expect((await dispatch(userRequest("/api/v4/schedules/job-radar/dispatch", { method: "POST" }, false))).status).toBe(404);
    state.env.V4_JOB_RADAR_SCHEDULE_TOKEN = "job-radar-secret";
    expect((await dispatch(userRequest("/api/v4/schedules/job-radar/dispatch", { method: "POST" }, false))).status).toBe(401);
    expect((await dispatch(new Request("https://site.test/api/v4/schedules/job-radar/dispatch", { method: "POST", headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
    expect(state.dispatch).not.toHaveBeenCalled();
  });

  it("runs only the fixed server-side work budget after service authentication", async () => {
    state.env.V4_JOB_RADAR_SCHEDULE_TOKEN = "job-radar-secret";
    const response = await dispatch(new Request("https://site.test/api/v4/schedules/job-radar/dispatch", { method: "POST", headers: { authorization: "Bearer job-radar-secret" } }));
    expect(response.status).toBe(200);
    expect(state.dispatch).toHaveBeenCalledWith({ maxSchedules: 3, companiesPerSchedule: 2 });
    expect(await response.json()).toMatchObject({ companiesProcessed: 2, continuations: 1 });
  });

  it("lets an authenticated owner run only their own enabled schedule", async () => {
    expect((await runDue(userRequest("/api/v4/schedules/job-radar/run-due", { method: "POST" }, false))).status).toBe(401);
    const response = await runDue(userRequest("/api/v4/schedules/job-radar/run-due", { method: "POST", body: JSON.stringify({ ownerId: "owner-b" }) }));
    expect(response.status).toBe(200);
    expect(state.runOwnerNow).toHaveBeenCalledWith("owner-a");
    expect(await response.json()).toMatchObject({ result: { companiesProcessed: 2, continuations: 1 } });
  });
});
