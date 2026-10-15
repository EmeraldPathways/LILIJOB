export type OutreachDraftForSend = {
  subject: string;
  body: string;
  email: string | null;
  doNotContact: boolean;
  approvalState: "draft" | "approved" | "sent" | "blocked";
};

function validEmail(value: string | null): boolean {
  return Boolean(value && value.length <= 254 && !/[\s\r\n]/.test(value) && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value));
}

export function validateOutreachDraft(draft: OutreachDraftForSend): string[] {
  const errors: string[] = [];
  if (!draft.subject.trim()) errors.push("Subject is required.");
  if (draft.subject.length > 200) errors.push("Subject is too long.");
  if (/[\r\n]/.test(draft.subject)) errors.push("Subject contains an invalid line break.");
  if (!draft.body.trim()) errors.push("Message body is required.");
  if (draft.body.length > 20_000) errors.push("Message body is too long.");
  if (draft.email !== null && !validEmail(draft.email)) errors.push("Recipient email is invalid.");
  if (draft.doNotContact) errors.push("This contact is marked do-not-contact.");
  return errors;
}

export function canSendOutreach(draft: OutreachDraftForSend): boolean {
  return draft.approvalState === "approved" && !draft.doNotContact && validEmail(draft.email) && validateOutreachDraft(draft).length === 0;
}

export function makeOutreachDedupKey(ownerId: string, draftId: string, contactId: string | null): string {
  return [ownerId.trim(), draftId.trim(), contactId?.trim() ?? "no-contact"].join(":");
}
