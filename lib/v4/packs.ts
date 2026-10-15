export type ApprovedEvidence = { id: string; statement: string; metric?: string | null };

export type PackGeneration = {
  provider: "rules" | "openai" | "fallback";
  model: string;
  reasoningEffort: "none" | "low";
  warning?: string;
};

export type ApplicationPack = {
  jobTitle: string;
  companyName: string;
  sourceUrl: string;
  requirements: string[];
  evidenceReferences: string[];
  requirementGaps: string[];
  recommendedEdits: Array<{ requirement: string; proposal: string; evidenceId: string | null; needsConfirmation: boolean }>;
  tailoredSummary: string;
  coverNote: string;
  recruiterEmail: string;
  linkedinMessage: string;
  talkingPoints: string[];
  generatedAt: string;
  generation: PackGeneration;
};

function words(value: string): string[] {
  return value.trim().split(/\s+/).filter(Boolean);
}

function compact(value: string, limit: number): string {
  return words(value).slice(0, limit).join(" ");
}

function matches(requirement: string, evidence: ApprovedEvidence): boolean {
  const wanted = requirement.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2);
  const statement = `${evidence.statement} ${evidence.metric ?? ""}`.toLowerCase();
  return wanted.length > 0 && wanted.some((token) => statement.includes(token));
}

function numericTokens(value: string): string[] {
  return value.match(/\b\d+(?:\.\d+)?%?\b/g) ?? [];
}

function bounded(value: unknown, fallback: string, limit: number): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return words(value).slice(0, limit).join(" ");
}

function parseModelObject(value: string): Record<string, unknown> | null {
  const cleaned = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(cleaned) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
}

function evidenceAnchor(proposal: string, evidence: ApprovedEvidence): boolean {
  const tokens = evidence.statement.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 3);
  const lower = proposal.toLowerCase();
  return tokens.some((token) => lower.includes(token));
}

export function buildApplicationPack(input: {
  jobTitle: string;
  companyName: string;
  requirements: string[];
  jobSourceUrl: string;
  approvedEvidence: ApprovedEvidence[];
  candidateSummary: string;
}): ApplicationPack {
  const evidence = input.approvedEvidence.filter((item) => item.id.trim() && item.statement.trim());
  const recommendedEdits = input.requirements.map((requirement) => {
    const item = evidence.find((candidate) => matches(requirement, candidate));
    if (!item) return { requirement, proposal: `Review the gap for “${requirement}” and add a truthful example if you have one.`, evidenceId: null, needsConfirmation: true };
    const metric = item.metric?.trim();
    return { requirement, proposal: `${item.statement.trim()}${metric ? ` (${metric})` : " [add a confirmed metric if one exists]"}`, evidenceId: item.id, needsConfirmation: !metric };
  });
  const used = evidence.filter((item) => recommendedEdits.some((edit) => edit.evidenceId === item.id));
  const evidenceReferences = evidence.map((item) => item.id);
  const proof = used.map((item) => `${item.statement.trim()}${item.metric ? ` (${item.metric.trim()})` : ""}`);
  const requirementGaps = recommendedEdits.filter((edit) => !edit.evidenceId).map((edit) => edit.requirement);
  const tailoredSummary = compact(`${input.candidateSummary.trim()} Relevant approved evidence: ${proof.join(" ")}`, 70);
  const coverNote = compact(`I am applying for the ${input.jobTitle} role at ${input.companyName}. My background includes ${proof.join(" ") || "approved experience relevant to the role"}. I would welcome a conversation about the published requirements and the areas where I would need to learn more.`, 180);
  const recruiterEmail = compact(`Subject: ${input.jobTitle} at ${input.companyName}\n\nHello, I am interested in the ${input.jobTitle} opportunity. My approved experience includes ${proof.join(" ") || "relevant product experience"}. I have included the role source for review and would be glad to discuss the requirements and any open questions.`, 120);
  const linkedinMessage = compact(`Hello, I am exploring the ${input.jobTitle} role at ${input.companyName}. My relevant approved experience includes ${proof[0] ?? "product delivery and cross-functional work"}. I would value a brief conversation if appropriate.`, 60);
  return {
    jobTitle: input.jobTitle,
    companyName: input.companyName,
    sourceUrl: input.jobSourceUrl,
    requirements: input.requirements,
    evidenceReferences,
    requirementGaps,
    recommendedEdits,
    tailoredSummary,
    coverNote,
    recruiterEmail,
    linkedinMessage,
    talkingPoints: proof.slice(0, 5),
    generatedAt: new Date().toISOString(),
    generation: { provider: "rules", model: "deterministic", reasoningEffort: "none" },
  };
}

/**
 * Generate optional model-assisted copy while keeping the source URL, evidence
 * IDs, requirements and numeric claims under server-side control. A provider
 * failure is deliberately allowed to reach the caller so the API can return a
 * deterministic pack instead of hiding an external dependency failure.
 */
export async function buildApplicationPackWithAI(input: {
  jobTitle: string;
  companyName: string;
  requirements: string[];
  jobSourceUrl: string;
  approvedEvidence: ApprovedEvidence[];
  candidateSummary: string;
}): Promise<ApplicationPack> {
  const fallback = buildApplicationPack(input);
  const { askOpenAI, configuredModel } = await import("../ai/client");
  const evidence = input.approvedEvidence.filter((item) => item.id.trim() && item.statement.trim());
  const prompt = [
    "Create an evidence-constrained application draft as JSON only.",
    "Use only the approved evidence IDs and statements below. Never invent employers, dates, credentials, metrics, sponsorship, salary or outcomes.",
    "If a requirement has no evidence, use evidenceId null and needsConfirmation true.",
    "Return keys: tailoredSummary, coverNote, recruiterEmail, linkedinMessage, talkingPoints, recommendedEdits.",
    `Role: ${input.jobTitle}\nCompany: ${input.companyName}\nRequirements: ${JSON.stringify(input.requirements)}`,
    `Candidate summary: ${input.candidateSummary}`,
    `Approved evidence: ${JSON.stringify(evidence)}`,
  ].join("\n\n");
  const result = await askOpenAI(prompt, { reasoningEffort: "low", maxOutputTokens: 2200 });
  const model = parseModelObject(result.text);
  if (!model) return { ...fallback, generation: { provider: "fallback", model: configuredModel(), reasoningEffort: "low", warning: "The model response was not valid JSON; deterministic copy was retained." } };

  const allowedNumbers = new Set(numericTokens(`${input.candidateSummary} ${evidence.map((item) => `${item.statement} ${item.metric ?? ""}`).join(" ")}`));
  const hasUnsafeNumber = (value: string) => numericTokens(value).some((number) => !allowedNumbers.has(number));
  const approvedById = new Map(evidence.map((item) => [item.id, item]));
  const modelEdits = Array.isArray(model.recommendedEdits) ? model.recommendedEdits : [];
  const recommendedEdits = input.requirements.map((requirement, index) => {
    const fallbackEdit = fallback.recommendedEdits[index] ?? { requirement, proposal: `Review the gap for “${requirement}” and add a truthful example if you have one.`, evidenceId: null, needsConfirmation: true };
    const candidate = modelEdits.find((item) => item && typeof item === "object" && String((item as Record<string, unknown>).requirement ?? "") === requirement);
    if (!candidate || typeof candidate !== "object") return fallbackEdit;
    const raw = candidate as Record<string, unknown>;
    const evidenceId = typeof raw.evidenceId === "string" && approvedById.has(raw.evidenceId) ? raw.evidenceId : null;
    const approved = evidenceId ? approvedById.get(evidenceId) ?? null : null;
    const proposal = typeof raw.proposal === "string" ? raw.proposal.trim() : "";
    if (!evidenceId || !approved || !proposal || hasUnsafeNumber(proposal) || !evidenceAnchor(proposal, approved)) return fallbackEdit;
    return { requirement, proposal: bounded(proposal, fallbackEdit.proposal, 60), evidenceId, needsConfirmation: Boolean(raw.needsConfirmation) || !approved.metric };
  });
  const modelText = (field: keyof Pick<ApplicationPack, "tailoredSummary" | "coverNote" | "recruiterEmail" | "linkedinMessage">, limit: number) => {
    const value = typeof model[field] === "string" ? model[field] as string : "";
    return value && !hasUnsafeNumber(value) ? bounded(value, fallback[field], limit) : fallback[field];
  };
  const talkingPoints = Array.isArray(model.talkingPoints)
    ? model.talkingPoints.filter((item): item is string => typeof item === "string" && item.trim().length > 0 && !hasUnsafeNumber(item)).slice(0, 5).map((item, index) => bounded(item, fallback.talkingPoints[index] ?? "Review the approved evidence before use.", 40))
    : fallback.talkingPoints;
  const pack: ApplicationPack = {
    ...fallback,
    tailoredSummary: modelText("tailoredSummary", 70),
    coverNote: modelText("coverNote", 180),
    recruiterEmail: modelText("recruiterEmail", 120),
    linkedinMessage: modelText("linkedinMessage", 60),
    talkingPoints: talkingPoints.length ? talkingPoints : fallback.talkingPoints,
    recommendedEdits,
    requirementGaps: recommendedEdits.filter((edit) => !edit.evidenceId).map((edit) => edit.requirement),
    generation: { provider: "openai", model: configuredModel(), reasoningEffort: "low" },
  };
  const validationErrors = validatePack(pack);
  return validationErrors.length
    ? { ...fallback, generation: { provider: "fallback", model: configuredModel(), reasoningEffort: "low", warning: validationErrors.join(" ") } }
    : pack;
}

export function validatePack(pack: ApplicationPack): string[] {
  const errors: string[] = [];
  if (!/^https?:\/\//.test(pack.sourceUrl)) errors.push("A source URL is required.");
  if (words(pack.coverNote).length > 180) errors.push("Cover note exceeds 180 words.");
  if (words(pack.recruiterEmail).length > 120) errors.push("Recruiter email exceeds 120 words.");
  if (words(pack.linkedinMessage).length > 60) errors.push("LinkedIn message exceeds 60 words.");
  const evidenceNumbers = pack.recommendedEdits.flatMap((edit) => edit.proposal.match(/\d+(?:\.\d+)?%?/g) ?? []);
  const allowedNumbers = pack.recommendedEdits.filter((edit) => edit.evidenceId && !edit.needsConfirmation).flatMap((edit) => edit.proposal.match(/\d+(?:\.\d+)?%?/g) ?? []);
  if (evidenceNumbers.some((value) => !allowedNumbers.includes(value))) errors.push("A numeric claim is missing approved evidence.");
  return errors;
}

const PLAYBOOKS: Record<string, { focus: string; differentiators: string[]; questions: string[] }> = {
  "e-commerce": { focus: "customer journeys, search, merchandising and measurable conversion experiments", differentiators: ["connects customer insight to experiment design", "links product decisions to commercial outcomes", "keeps learning loops visible"], questions: ["Which customer journey is the highest priority this quarter?", "How do you measure a successful experiment here?"] },
  startups: { focus: "zero-to-one delivery, prioritisation and pragmatic cross-functional ownership", differentiators: ["turns ambiguous problems into testable increments", "balances speed with evidence", "keeps teams aligned around outcomes"], questions: ["What is the riskiest assumption behind the next product bet?", "How does the team decide what not to build?"] },
  fintech: { focus: "measured product experiments, trust, compliance sensitivity and operational efficiency", differentiators: ["makes trade-offs visible in regulated or trust-sensitive journeys", "uses experiments with clear guardrails", "connects customer value to operational outcomes"], questions: ["Where do trust and compliance shape the product roadmap?", "Which operational metric would this role improve first?"] },
  "work-permit": { focus: "role-specific product contribution and clear, evidence-based work-status communication", differentiators: ["keeps role fit separate from legal eligibility", "communicates constraints precisely", "focuses on demonstrable contribution"], questions: ["Which role requirements are most important in the first six months?", "What information should a candidate confirm about work eligibility?"] },
};

export const PITCH_SECTORS = Object.keys(PLAYBOOKS);

export type SectorPitch = {
  sector: string;
  pitch: string;
  intro: string;
  evidenceReferences: string[];
  differentiators: string[];
  questions: string[];
};

export function buildSectorPitch(sector: string, input: { companyName: string; role: string; companyFacts: string[]; approvedEvidence: ApprovedEvidence[]; tone?: string }): SectorPitch {
  const normalizedSector = sector.toLowerCase();
  const playbook = PLAYBOOKS[normalizedSector];
  if (!playbook) throw new Error(`Unsupported sector playbook: ${sector}`);
  const facts = input.companyFacts.filter(Boolean).slice(0, 2);
  const evidence = input.approvedEvidence.filter((item) => item.id.trim() && item.statement.trim()).slice(0, 3);
  const proof = evidence.map((item) => `${item.statement.trim()}${item.metric ? ` (${item.metric.trim()})` : ""}`);
  const factText = facts.join(" ") || "Company details need confirmation from a current source.";
  const pitch = compact(`${input.companyName} is described by its published information as follows: ${factText} For the ${input.role} role, I would bring ${playbook.focus}. Relevant approved evidence: ${proof.join(" ") || "no approved evidence has been attached yet"}.`, 100);
  return { sector: normalizedSector, pitch, intro: compact(`I work on ${playbook.focus}. At ${input.companyName}, I would focus on the ${input.role} challenge and use approved evidence to show where I have done comparable work.`, 80), evidenceReferences: evidence.map((item) => item.id), differentiators: playbook.differentiators, questions: playbook.questions };
}
