export type InterviewStory = { id: string; statement: string; metric?: string | null };
export type InterviewOutcome = "awaiting" | "progressed" | "offer" | "rejected" | "withdrawn";

export type PracticeSelfEvaluation = {
  relevance: number | null;
  specificity: number | null;
  impact: number | null;
  reflection: string;
};

export type PracticeQa = {
  topic: string;
  question: string;
  answerDraft: string;
  evidenceIds: string[];
  selfEvaluation: PracticeSelfEvaluation;
};

export type PracticeQaUpdate = {
  topic: string;
  answerDraft: string;
  selfEvaluation: PracticeSelfEvaluation;
};

export type InterviewPack = {
  brief: string;
  sourceMeta: string[];
  predictions: Array<{ topic: string; label: "prediction"; reason: string }>;
  starStories: Array<{ evidenceId: string; statement: string; metric: string | null; matchedRequirement: string | null }>;
  recruiterScreenAnswers: string[];
  practiceQuestions: string[];
  practiceQas: PracticeQa[];
  questionsToAsk: string[];
  introduction30s: string;
  introduction2m: string;
  checklist24h: string[];
  gaps: string[];
  generatedAt: string;
};

function matches(requirement: string, story: InterviewStory): boolean {
  const tokens = requirement.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2);
  const text = `${story.statement} ${story.metric ?? ""}`.toLowerCase();
  return tokens.some((token) => text.includes(token));
}

export function isDublinTimezone(timezone: string | undefined): boolean {
  return timezone === undefined || timezone.trim() === "" || timezone.trim() === "Europe/Dublin";
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function dublinDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Dublin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function validateInterviewSource(jobSourceUrl: string | null, checkedAt: string | null, now = new Date()): string | null {
  if (jobSourceUrl === null && checkedAt === null) return null;
  if (typeof jobSourceUrl !== "string" || !jobSourceUrl.trim() || typeof checkedAt !== "string" || !checkedAt.trim()) {
    return "A source URL and checked date must be provided together.";
  }
  try {
    const url = new URL(jobSourceUrl);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) {
      return "The job source must be an absolute HTTP or HTTPS URL without credentials.";
    }
  } catch {
    return "The job source URL is invalid.";
  }
  if (!isCalendarDate(checkedAt)) return "The source checked date must be a valid YYYY-MM-DD calendar date.";
  if (checkedAt > dublinDate(now)) return "The source checked date cannot be in the future in Europe/Dublin.";
  return null;
}

export function validateInterviewSchedule(scheduledAt: string | undefined, timezone: string | undefined): string | null {
  if (!isDublinTimezone(timezone)) return "Interview times must use the Europe/Dublin timezone.";
  if (scheduledAt === undefined) return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-](\d{2}):(\d{2}))$/.exec(scheduledAt);
  if (!match || !isCalendarDate(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4] ?? 0) > 59 || (match[7] !== "Z" && (Number(match[8]) > 23 || Number(match[9]) > 59)) || !Number.isFinite(Date.parse(scheduledAt))) {
    return "Interview time must be a valid ISO timestamp with an explicit timezone offset.";
  }
  const localParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Dublin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(scheduledAt));
  const local = Object.fromEntries(localParts.map((part) => [part.type, part.value]));
  if (`${local.year}-${local.month}-${local.day}` !== match[1] || `${local.hour}:${local.minute}:${local.second}` !== `${match[2]}:${match[3]}:${match[4] ?? "00"}`) {
    return "Interview timestamp offset must match the Europe/Dublin local time, including daylight-saving changes.";
  }
  return null;
}

export function applyPracticeQaUpdates(pack: InterviewPack, updates: PracticeQaUpdate[]): InterviewPack {
  const questions = pack.practiceQas;
  if (!Array.isArray(questions)) throw new Error("This interview pack has no editable practice questions.");
  const byTopic = new Map(questions.map((question) => [question.topic, question]));
  const seen = new Set<string>();
  const next = new Map(questions.map((question) => [question.topic, question]));
  for (const update of updates) {
    const current = byTopic.get(update.topic);
    if (!current || seen.has(update.topic)) throw new Error("Practice response references an unknown or repeated question.");
    if (typeof update.answerDraft !== "string" || update.answerDraft.length > 10_000) throw new Error("Practice answers must be text no longer than 10,000 characters.");
    const evaluation = update.selfEvaluation;
    if (!evaluation || ![evaluation.relevance, evaluation.specificity, evaluation.impact].every((score) => score === null || (Number.isInteger(score) && score >= 1 && score <= 5)) || typeof evaluation.reflection !== "string" || evaluation.reflection.length > 2_000) {
      throw new Error("Self-evaluation scores must be null or between 1 and 5, with a reflection no longer than 2,000 characters.");
    }
    seen.add(update.topic);
    next.set(update.topic, { ...current, answerDraft: update.answerDraft, selfEvaluation: { ...evaluation } });
  }
  return { ...pack, practiceQas: questions.map((question) => next.get(question.topic)!) };
}

export function buildInterviewPack(input: {
  companyName: string;
  roleTitle: string;
  jobSourceUrl: string | null;
  checkedAt: string | null;
  companyFacts: string[];
  requirements: string[];
  approvedStories: InterviewStory[];
}): InterviewPack {
  const sourceError = validateInterviewSource(input.jobSourceUrl, input.checkedAt);
  if (sourceError) throw new Error(sourceError);
  const sourceMeta = [input.jobSourceUrl, input.checkedAt ? `checked ${input.checkedAt}` : null].filter((value): value is string => Boolean(value));
  const brief = input.companyFacts.length
    ? `${input.companyName}: ${input.companyFacts.slice(0, 4).join(" ")}`
    : `${input.companyName} source detail is unavailable. Confirm the company's product, Dublin team, business model and recent developments before relying on this brief.`;
  const predictions = (input.requirements.length ? input.requirements : ["role scope", "stakeholder collaboration", "measurable outcomes"]).slice(0, 6).map((topic) => ({ topic, label: "prediction" as const, reason: `This topic is suggested by the published role information; it is not a claim about the interviewer's actual questions.` }));
  const starStories = input.approvedStories.slice(0, 5).map((story) => ({ evidenceId: story.id, statement: story.statement, metric: story.metric ?? null, matchedRequirement: input.requirements.find((requirement) => matches(requirement, story)) ?? null }));
  const gaps = input.requirements.filter((requirement) => !starStories.some((story) => story.matchedRequirement === requirement));
  const role = input.roleTitle;
  return {
    brief,
    sourceMeta,
    predictions,
    starStories,
    recruiterScreenAnswers: [
      `Why this role: connect your interest in ${role} to an approved example and a question about the team.`,
      "Work authorisation: state only the current status and dates you have confirmed; do not make a legal or sponsorship guarantee.",
    ],
    practiceQuestions: predictions.map((item) => `Practice a concise example for ${item.topic}.`),
    practiceQas: predictions.map((item) => ({
      topic: item.topic,
      question: `Tell me about a specific example of ${item.topic} and the result you achieved.`,
      answerDraft: "",
      evidenceIds: starStories.filter((story) => story.matchedRequirement === item.topic).map((story) => story.evidenceId),
      selfEvaluation: { relevance: null, specificity: null, impact: null, reflection: "" },
    })),
    questionsToAsk: ["What would success look like in the first 90 days?", "Which customer or business problem is most important right now?", "How does the team make trade-offs when evidence is incomplete?"],
    introduction30s: `I am a product professional interested in the ${role} opportunity at ${input.companyName}. I will focus on the role's published outcomes and use approved experience examples to show how I work.`,
    introduction2m: `I am preparing for the ${role} conversation at ${input.companyName}. My strongest relevant examples are listed in the approved evidence section, and I would like to understand the team's priorities, decision process and measures of success.`,
    checklist24h: ["Re-read the current role source.", "Confirm date, time and Europe/Dublin timezone.", "Review approved STAR stories and gaps.", "Prepare two role-specific questions.", "Check meeting link or location manually."],
    gaps,
    generatedAt: new Date().toISOString(),
  };
}
