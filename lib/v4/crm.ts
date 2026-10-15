export const APPLICATION_STAGES = ["Target", "Contacted", "Applied", "Follow-up", "Recruiter Call", "Interview", "Final Interview", "Offer", "Rejected", "Withdrawn"] as const;
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

export const ACTION_ITEM_STATUSES = ["open", "completed", "snoozed", "dismissed"] as const;
export type ActionItemStatus = (typeof ACTION_ITEM_STATUSES)[number];

export function isActionItemStatus(value: string): value is ActionItemStatus {
  return (ACTION_ITEM_STATUSES as readonly string[]).includes(value);
}

const terminalStages = new Set<ApplicationStage>(["Rejected", "Withdrawn"]);

export function isApplicationStage(value: string): value is ApplicationStage {
  return (APPLICATION_STAGES as readonly string[]).includes(value);
}

export function stageLabel(value: string): string {
  return isApplicationStage(value) ? value : "Unknown stage";
}

export function canMoveApplication(from: string, to: string): boolean {
  if (!isApplicationStage(from) || !isApplicationStage(to)) return false;
  if (from === to) return true;
  if (terminalStages.has(from)) return false;
  return true;
}

export function safeCsvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const formulaCandidate = /^[\u0000-\u0020]*[=+\-@]/.test(text);
  const safe = formulaCandidate ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
