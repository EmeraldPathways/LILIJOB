import { isSafePublicUrl } from "./job-radar";

export type AgentToolMode = "read" | "draft" | "internal" | "external";
export type AgentToolName =
  | "search_companies"
  | "search_jobs"
  | "refresh_jobs"
  | "get_candidate_profile"
  | "rank_jobs"
  | "get_job_sources"
  | "find_public_contacts"
  | "inspect_permit_evidence"
  | "get_hiring_signals"
  | "list_followups"
  | "get_usage_budget"
  | "prepare_application_pack"
  | "draft_outreach"
  | "create_action_items"
  | "create_interview_pack"
  | "export_documents"
  | "create_application"
  | "update_application_stage"
  | "submit_application"
  | "send_outreach"
  | "schedule_communication";

export type AgentTool = {
  name: AgentToolName;
  mode: AgentToolMode;
  requiresApproval: boolean;
  description: string;
  searchUnits: number;
  estimatedCostCents: number;
  maxOutputTokens: number;
};

const toolDefinitions: Array<Omit<AgentTool, "requiresApproval">> = [
  { name: "search_companies", mode: "read", description: "Find owner-scoped companies.", searchUnits: 1, estimatedCostCents: 0, maxOutputTokens: 700 },
  { name: "search_jobs", mode: "read", description: "Find verified and discovered jobs.", searchUnits: 1, estimatedCostCents: 0, maxOutputTokens: 1200 },
  { name: "refresh_jobs", mode: "read", description: "Refresh an approved source with a budget.", searchUnits: 1, estimatedCostCents: 2, maxOutputTokens: 1600 },
  { name: "get_candidate_profile", mode: "read", description: "Read the active candidate profile.", searchUnits: 0, estimatedCostCents: 0, maxOutputTokens: 900 },
  { name: "rank_jobs", mode: "read", description: "Compute deterministic fit scores.", searchUnits: 0, estimatedCostCents: 0, maxOutputTokens: 1200 },
  { name: "get_job_sources", mode: "read", description: "Read source provenance and snapshots.", searchUnits: 0, estimatedCostCents: 0, maxOutputTokens: 1000 },
  { name: "find_public_contacts", mode: "read", description: "Find and classify public contacts.", searchUnits: 1, estimatedCostCents: 0, maxOutputTokens: 1000 },
  { name: "inspect_permit_evidence", mode: "read", description: "Read effective-dated permit evidence.", searchUnits: 0, estimatedCostCents: 0, maxOutputTokens: 700 },
  { name: "get_hiring_signals", mode: "read", description: "Read dated company signals.", searchUnits: 1, estimatedCostCents: 0, maxOutputTokens: 1200 },
  { name: "list_followups", mode: "read", description: "Read due application actions.", searchUnits: 0, estimatedCostCents: 0, maxOutputTokens: 1000 },
  { name: "get_usage_budget", mode: "read", description: "Read configured usage limits.", searchUnits: 0, estimatedCostCents: 0, maxOutputTokens: 300 },
  { name: "prepare_application_pack", mode: "draft", description: "Prepare an editable pack from approved evidence.", searchUnits: 0, estimatedCostCents: 0, maxOutputTokens: 1800 },
  { name: "draft_outreach", mode: "draft", description: "Create an editable outreach draft.", searchUnits: 0, estimatedCostCents: 0, maxOutputTokens: 900 },
  { name: "create_action_items", mode: "draft", description: "Create internal action items.", searchUnits: 0, estimatedCostCents: 0, maxOutputTokens: 900 },
  { name: "create_interview_pack", mode: "draft", description: "Create an editable interview pack.", searchUnits: 0, estimatedCostCents: 0, maxOutputTokens: 1800 },
  { name: "export_documents", mode: "draft", description: "Create private export links for saved application and interview packs.", searchUnits: 0, estimatedCostCents: 0, maxOutputTokens: 900 },
  { name: "create_application", mode: "internal", description: "Create an internal tracking record for an owner-scoped job; this does not submit an application.", searchUnits: 0, estimatedCostCents: 0, maxOutputTokens: 500 },
  { name: "update_application_stage", mode: "internal", description: "Update an owner-scoped application tracking stage.", searchUnits: 0, estimatedCostCents: 0, maxOutputTokens: 400 },
  { name: "submit_application", mode: "external", description: "Submit an application externally; this always requires the dedicated explicit approval workflow.", searchUnits: 0, estimatedCostCents: 0, maxOutputTokens: 300 },
  { name: "send_outreach", mode: "external", description: "Send a message through Gmail.", searchUnits: 0, estimatedCostCents: 0, maxOutputTokens: 300 },
  { name: "schedule_communication", mode: "external", description: "Schedule an outbound communication.", searchUnits: 0, estimatedCostCents: 0, maxOutputTokens: 300 },
];

export const AGENT_TOOLS: AgentTool[] = toolDefinitions.map((tool) => ({
  ...tool,
  requiresApproval: tool.mode === "external",
}));

export type AgentPlanStep = { tool: AgentToolName; input: Record<string, unknown> };
export type AgentBudget = { maxSearches: number; maxTokens: number; maxCostCents: number; maxSteps: number };

export const DEFAULT_AGENT_BUDGET: AgentBudget = {
  maxSearches: 10,
  maxTokens: 20_000,
  maxCostCents: 100,
  maxSteps: 20,
};

export const MAX_AGENT_PLAN_STEPS = 20;

type FieldRule =
  | { type: "string"; required?: boolean; maxLength?: number; format?: "url" | "date" | "stage" | "exportFormat" }
  | { type: "integer"; required?: boolean; min?: number; max?: number }
  | { type: "stringArray"; required?: boolean; maxItems?: number; maxLength?: number };

const argumentRules: Record<AgentToolName, Record<string, FieldRule>> = {
  search_companies: { query: { type: "string", maxLength: 200 }, limit: { type: "integer", min: 1, max: 20 } },
  search_jobs: {
    query: { type: "string", maxLength: 200 }, title: { type: "string", maxLength: 120 }, location: { type: "string", maxLength: 120 },
    status: { type: "string", maxLength: 20 }, limit: { type: "integer", min: 1, max: 20 },
  },
  refresh_jobs: { companyId: { type: "string", required: true, maxLength: 180 }, sourceUrl: { type: "string", required: true, maxLength: 2000, format: "url" }, maxResults: { type: "integer", min: 1, max: 20 } },
  get_candidate_profile: { profileId: { type: "string", maxLength: 180 } },
  rank_jobs: { profileId: { type: "string", maxLength: 180 }, limit: { type: "integer", min: 1, max: 20 } },
  get_job_sources: { jobId: { type: "string", required: true, maxLength: 180 } },
  find_public_contacts: { companyId: { type: "string", maxLength: 180 }, query: { type: "string", maxLength: 200 }, limit: { type: "integer", min: 1, max: 20 } },
  inspect_permit_evidence: { companyId: { type: "string", maxLength: 180 }, jobId: { type: "string", maxLength: 180 }, asOfDate: { type: "string", maxLength: 30, format: "date" } },
  get_hiring_signals: { companyId: { type: "string", maxLength: 180 }, limit: { type: "integer", min: 1, max: 20 } },
  list_followups: { dueBefore: { type: "string", maxLength: 30, format: "date" }, limit: { type: "integer", min: 1, max: 20 } },
  get_usage_budget: {},
  prepare_application_pack: { jobId: { type: "string", required: true, maxLength: 180 }, profileId: { type: "string", maxLength: 180 } },
  draft_outreach: { companyId: { type: "string", required: true, maxLength: 180 }, jobId: { type: "string", maxLength: 180 }, contactId: { type: "string", maxLength: 180 } },
  create_action_items: { dueBefore: { type: "string", maxLength: 30, format: "date" }, limit: { type: "integer", min: 1, max: 20 } },
  create_interview_pack: { applicationId: { type: "string", maxLength: 180 }, interviewId: { type: "string", maxLength: 180 } },
  export_documents: {
    applicationPackIds: { type: "stringArray", maxItems: 20, maxLength: 180 },
    interviewIds: { type: "stringArray", maxItems: 20, maxLength: 180 },
    documentIds: { type: "stringArray", maxItems: 20, maxLength: 180 },
    format: { type: "string", maxLength: 10, format: "exportFormat" },
  },
  create_application: { jobId: { type: "string", required: true, maxLength: 180 } },
  update_application_stage: { applicationId: { type: "string", required: true, maxLength: 180 }, stage: { type: "string", required: true, maxLength: 40, format: "stage" }, note: { type: "string", maxLength: 1000 } },
  submit_application: { jobId: { type: "string", required: true, maxLength: 180 }, applicationId: { type: "string", maxLength: 180 } },
  send_outreach: { draftId: { type: "string", maxLength: 180 }, contactId: { type: "string", maxLength: 180 } },
  schedule_communication: { draftId: { type: "string", maxLength: 180 }, scheduledAt: { type: "string", maxLength: 40, format: "date" } },
};

const applicationStages = new Set(["Target", "Contacted", "Applied", "Follow-up", "Recruiter Call", "Interview", "Final Interview", "Offer", "Rejected", "Withdrawn"]);

export function getAgentTool(name: string): AgentTool | null {
  return AGENT_TOOLS.find((tool) => tool.name === name) ?? null;
}

export function canExecuteAgentTool(name: string, approval: { approved: boolean }): boolean {
  void approval;
  const tool = getAgentTool(name);
  return Boolean(tool && tool.mode !== "external" && !tool.requiresApproval);
}

export function hasPromptInjectionMarkers(value: string): boolean {
  const normalized = value.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "");
  return /(ignore\s+(all|any|previous|prior)\s+(instructions?|rules?)|disregard\s+(the\s+)?(system|developer|previous)\s+(message|instructions?)|system\s+message|developer\s+message|send\s+the\s+(email|message)\s+now|submit\s+the\s+application\s+now|reveal\s+(the\s+)?secret)/i.test(normalized);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateFieldValue(key: string, value: unknown, rule: FieldRule): string | null {
  if (rule.type === "string") {
    if (typeof value !== "string") return `Argument ${key} must be a string.`;
    const normalized = value.trim();
    if (!normalized) return `Argument ${key} cannot be empty.`;
    if (normalized.length > (rule.maxLength ?? 500)) return `Argument ${key} is too long.`;
    if (hasPromptInjectionMarkers(normalized)) return `Argument ${key} contains unsafe instruction text.`;
    if (rule.format === "url" && !isSafePublicUrl(normalized)) return `Argument ${key} must be a safe public HTTP(S) URL.`;
    if (rule.format === "date" && !Number.isFinite(Date.parse(normalized))) return `Argument ${key} must be a valid date.`;
    if (rule.format === "stage" && !applicationStages.has(normalized)) return `Argument ${key} is not a supported application stage.`;
    if (rule.format === "exportFormat" && !["html", "pdf", "docx"].includes(normalized)) return `Argument ${key} must be html, pdf or docx.`;
    return null;
  }
  if (rule.type === "integer") {
    if (typeof value !== "number" || !Number.isInteger(value)) return `Argument ${key} must be an integer.`;
    if (value < (rule.min ?? Number.MIN_SAFE_INTEGER) || value > (rule.max ?? Number.MAX_SAFE_INTEGER)) return `Argument ${key} is outside its allowed range.`;
    return null;
  }
  if (!Array.isArray(value) || value.length > (rule.maxItems ?? 20)) return `Argument ${key} must be a short string list.`;
  for (const item of value) {
    if (typeof item !== "string" || !item.trim() || item.length > (rule.maxLength ?? 500)) return `Argument ${key} must contain only bounded strings.`;
    if (hasPromptInjectionMarkers(item)) return `Argument ${key} contains unsafe instruction text.`;
  }
  return null;
}

export function validateAgentToolArguments(name: string, value: unknown): { input: Record<string, unknown>; error: string | null } {
  const tool = getAgentTool(name);
  if (!tool) return { input: {}, error: "Unknown agent tool." };
  const rules = argumentRules[tool.name];
  const source = value === undefined ? {} : value;
  if (!isPlainRecord(source)) return { input: {}, error: "Tool arguments must be a JSON object." };
  for (const key of Object.keys(source)) {
    if (!Object.hasOwn(rules, key)) return { input: {}, error: `Unsupported argument: ${key}.` };
  }
  for (const [key, rule] of Object.entries(rules)) {
    if (rule.required && !Object.hasOwn(source, key)) return { input: {}, error: `Argument ${key} is required.` };
    if (Object.hasOwn(source, key)) {
      const error = validateFieldValue(key, source[key], rule);
      if (error) return { input: {}, error };
    }
  }
  if (tool.name === "export_documents" && !["applicationPackIds", "interviewIds", "documentIds"].some((key) => Array.isArray(source[key]) && (source[key] as unknown[]).length > 0)) {
    return { input: {}, error: "At least one saved application pack or interview ID is required for export." };
  }
  const input: Record<string, unknown> = {};
  for (const [key, valueAtKey] of Object.entries(source)) {
    input[key] = typeof valueAtKey === "string" ? valueAtKey.trim() : Array.isArray(valueAtKey) ? valueAtKey.map((item) => (item as string).trim()) : valueAtKey;
  }
  return { input, error: null };
}

export function validateAgentPlan(value: unknown): { steps: AgentPlanStep[]; error: string | null } {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_AGENT_PLAN_STEPS) {
    return { steps: [], error: `Agent plan must contain between 1 and ${MAX_AGENT_PLAN_STEPS} steps.` };
  }
  const steps: AgentPlanStep[] = [];
  for (const step of value) {
    if (!isPlainRecord(step) || Object.keys(step).some((key) => key !== "tool" && key !== "input") || typeof step.tool !== "string") {
      return { steps: [], error: "Every plan step must contain only a registered tool and its input object." };
    }
    const validated = validateAgentToolArguments(step.tool, step.input);
    if (validated.error) return { steps: [], error: `${step.tool}: ${validated.error}` };
    steps.push({ tool: step.tool as AgentToolName, input: validated.input });
  }
  return { steps, error: null };
}

export function validateAgentToolAllowlist(value: unknown): { tools: AgentToolName[]; error: string | null } {
  if (!Array.isArray(value) || value.length > AGENT_TOOLS.length) return { tools: [], error: "Authorized tools must be a list of registered tool names." };
  const tools: AgentToolName[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !getAgentTool(item)) return { tools: [], error: "Authorized tools contain an unknown tool." };
    if (!tools.includes(item as AgentToolName)) tools.push(item as AgentToolName);
  }
  return { tools, error: null };
}

export function createDefaultAgentPlan(request: string): AgentPlanStep[] {
  const value = request.toLowerCase();
  let tool: AgentToolName = "get_candidate_profile";
  let input: Record<string, unknown> = {};
  if (/(send|email|message|contact).*(recruiter|hiring|outreach)|draft outreach/.test(value) && !/draft outreach/.test(value)) tool = "send_outreach";
  else if (/(submit|apply for|apply to|application)/.test(value)) tool = "submit_application";
  else if (/(schedule|book).*(communication|message|email|call)/.test(value)) tool = "schedule_communication";
  else if (/(change|update).*(application )?stage/.test(value)) tool = "update_application_stage";
  else if (/(interview|prepare me)/.test(value)) tool = "create_interview_pack";
  else if (/(follow.?up|overdue)/.test(value)) tool = "list_followups";
  else if (/permit|work authori[sz]ation/.test(value)) tool = "inspect_permit_evidence";
  else if (/signal|hiring/.test(value)) tool = "get_hiring_signals";
  else if (/contact|recruiter/.test(value)) tool = "find_public_contacts";
  else if (/company|companies/.test(value)) tool = "search_companies";
  else if (/(job|role|opportunit|best|fit)/.test(value)) {
    tool = "search_jobs";
    const query = request.replace(/^\s*(find|search|show|list)\s+/i, "").trim();
    if (query && query.length <= 200) input = { query };
  }
  return [{ tool, input }];
}

export function normalizeAgentBudget(value: unknown): AgentBudget {
  if (value === undefined || value === null) return { ...DEFAULT_AGENT_BUDGET };
  if (!isPlainRecord(value)) throw new Error("Agent budget must be an object.");
  const allowed = new Set(Object.keys(DEFAULT_AGENT_BUDGET));
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error("Agent budget contains an unsupported limit.");
  const budget = { ...DEFAULT_AGENT_BUDGET };
  for (const key of Object.keys(value) as Array<keyof AgentBudget>) {
    const item = value[key];
    const maximum = key === "maxTokens" ? 100_000 : key === "maxSearches" ? 50 : key === "maxCostCents" ? 10_000 : MAX_AGENT_PLAN_STEPS;
    if (typeof item !== "number" || !Number.isInteger(item) || item < 0 || item > maximum) throw new Error(`Agent budget ${key} must be an integer from 0 to ${maximum}.`);
    budget[key] = item;
  }
  return budget;
}

export function estimateAgentTokens(value: unknown): number {
  let serialized: string;
  try {
    serialized = typeof value === "string" ? value : JSON.stringify(value) ?? "";
  } catch {
    serialized = String(value);
  }
  return Math.ceil(serialized.length / 4);
}

export class AgentExecutionLimiter {
  private readonly activeByOwner = new Map<string, Set<string>>();
  private readonly startsByOwner = new Map<string, number[]>();

  constructor(private readonly options: { maxConcurrentPerOwner: number; maxStartsPerMinute: number; windowMs?: number }) {}

  acquire(ownerId: string, runId: string, now = Date.now()): { allowed: true } | { allowed: false; reason: "concurrency" | "rate" } {
    const active = this.activeByOwner.get(ownerId) ?? new Set<string>();
    if (active.has(runId) || active.size >= this.options.maxConcurrentPerOwner) return { allowed: false, reason: "concurrency" };
    const windowMs = this.options.windowMs ?? 60_000;
    const starts = (this.startsByOwner.get(ownerId) ?? []).filter((timestamp) => now - timestamp < windowMs);
    if (starts.length >= this.options.maxStartsPerMinute) {
      this.startsByOwner.set(ownerId, starts);
      return { allowed: false, reason: "rate" };
    }
    starts.push(now);
    active.add(runId);
    this.activeByOwner.set(ownerId, active);
    this.startsByOwner.set(ownerId, starts);
    return { allowed: true };
  }

  release(ownerId: string, runId: string): void {
    const active = this.activeByOwner.get(ownerId);
    active?.delete(runId);
    if (!active?.size) this.activeByOwner.delete(ownerId);
  }
}

export type AgentStep = {
  stepIndex: number;
  tool: string;
  status: "queued" | "running" | "completed" | "partial" | "blocked" | "failed";
  input: unknown;
  output: unknown;
  evidence: string[];
  costCents: number;
  estimatedCostCents: number;
  actualCostCents: number | null;
  createdAt: string;
};

export const AGENT_STEP_STATUSES: AgentStep["status"][] = ["queued", "running", "completed", "partial", "blocked", "failed"];

export function validateAgentStepInput(input: { tool: unknown; stepIndex: unknown; status: unknown; approved?: unknown }): string | null {
  if (typeof input.tool !== "string" || !getAgentTool(input.tool)) return "Unknown agent tool.";
  if (typeof input.stepIndex !== "number" || !Number.isInteger(input.stepIndex) || input.stepIndex < 0 || input.stepIndex > 1000) return "Step index must be an integer from 0 to 1000.";
  if (typeof input.status !== "string" || !AGENT_STEP_STATUSES.includes(input.status as AgentStep["status"])) return "Unsupported agent step status.";
  const tool = getAgentTool(input.tool);
  if (tool?.mode === "external") return "External agent actions are blocked and must use their dedicated approval workflow.";
  return null;
}

export function createAgentStep(stepIndex: number, tool: string, input: unknown, output: unknown, evidence: string[], status: AgentStep["status"] = "completed", costCents = 0): AgentStep {
  return {
    stepIndex,
    tool,
    status,
    input,
    output,
    evidence: evidence.filter((value) => /^https?:\/\//.test(value)),
    costCents: Number.isFinite(costCents) ? Math.max(0, Math.trunc(costCents)) : 0,
    estimatedCostCents: Number.isFinite(costCents) ? Math.max(0, Math.trunc(costCents)) : 0,
    actualCostCents: null,
    createdAt: new Date().toISOString(),
  };
}
