import { describe, expect, it } from "vitest";
import { canSendOutreach, makeOutreachDedupKey, validateOutreachDraft } from "../../lib/v4/outreach";

describe("Version 4 outreach approval", () => {
  it("requires a valid published recipient and explicit approval", () => {
    const draft = { subject: "Hello", body: "A message", email: "talent@acme.test", doNotContact: false, approvalState: "draft" as const };
    expect(validateOutreachDraft(draft)).toEqual([]);
    expect(canSendOutreach(draft)).toBe(false);
    expect(canSendOutreach({ ...draft, approvalState: "approved" })).toBe(true);
  });

  it("blocks opt-outs, missing email and malformed headers", () => {
    expect(validateOutreachDraft({ subject: "Hello\nBcc", body: "A message", email: "guess@acme.test", doNotContact: false, approvalState: "approved" })).toContain("Subject contains an invalid line break.");
    expect(canSendOutreach({ subject: "Hello", body: "A message", email: null, doNotContact: false, approvalState: "approved" })).toBe(false);
    expect(canSendOutreach({ subject: "Hello", body: "A message", email: "talent@acme.test", doNotContact: true, approvalState: "approved" })).toBe(false);
  });

  it("returns a stable idempotency key for the same approved draft", () => {
    expect(makeOutreachDedupKey("owner-a", "draft-1", "contact-1")).toBe(makeOutreachDedupKey("owner-a", "draft-1", "contact-1"));
    expect(makeOutreachDedupKey("owner-a", "draft-1", "contact-2")).not.toBe(makeOutreachDedupKey("owner-a", "draft-1", "contact-1"));
  });
});
