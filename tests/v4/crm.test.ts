import { describe, expect, it } from "vitest";
import { ACTION_ITEM_STATUSES, APPLICATION_STAGES, canMoveApplication, isActionItemStatus, isApplicationStage, safeCsvCell, stageLabel } from "../../lib/v4/crm";

describe("Version 4 application CRM", () => {
  it("exposes the canonical stages and accessible labels", () => {
    expect(APPLICATION_STAGES).toEqual(["Target", "Contacted", "Applied", "Follow-up", "Recruiter Call", "Interview", "Final Interview", "Offer", "Rejected", "Withdrawn"]);
    expect(stageLabel("Follow-up")).toBe("Follow-up");
  });

  it("recognizes every canonical stage and permits transitions until a terminal stage", () => {
    for (const stage of APPLICATION_STAGES) {
      expect(isApplicationStage(stage)).toBe(true);
      expect(canMoveApplication(stage, stage)).toBe(true);
    }
    for (const terminal of ["Rejected", "Withdrawn"]) {
      for (const next of APPLICATION_STAGES) expect(canMoveApplication(terminal, next)).toBe(next === terminal);
    }
    expect(canMoveApplication("Target", "Contacted")).toBe(true);
    expect(canMoveApplication("Interview", "Offer")).toBe(true);
    expect(canMoveApplication("Target", "made-up-stage")).toBe(false);
    expect(canMoveApplication("made-up-stage", "Target")).toBe(false);
  });

  it("validates action item statuses from the canonical set", () => {
    expect(ACTION_ITEM_STATUSES).toEqual(["open", "completed", "snoozed", "dismissed"]);
    for (const status of ACTION_ITEM_STATUSES) expect(isActionItemStatus(status)).toBe(true);
    expect(isActionItemStatus("pending")).toBe(false);
  });

  it("quotes CSV cells and neutralizes formula prefixes, including leading whitespace", () => {
    expect(safeCsvCell("=1+1")).toBe('"\'=1+1"');
    expect(safeCsvCell("  @SUM(A1:A2)")).toBe('"\'  @SUM(A1:A2)"');
    expect(safeCsvCell('a,"b"')).toBe('"a,""b"""');
  });
});
