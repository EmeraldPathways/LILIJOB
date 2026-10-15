export const DEFAULT_RANKING_WEIGHTS = {
  skillsExperience: 30,
  roleScope: 20,
  domain: 15,
  constraints: 15,
  impact: 10,
  freshness: 5,
  interest: 5,
} as const;

export type RankingWeights = Partial<Record<keyof typeof DEFAULT_RANKING_WEIGHTS, number>>;

export type RankingProfile = {
  targetFamilies: string[];
  skills: string[];
  domains: string[];
  seniority?: string;
  constraints: {
    locations?: string[];
    workModels?: string[];
    minimumSalary?: number;
    maximumSalary?: number;
    eligibility?: "eligible" | "ineligible" | "unknown";
  };
  interestCompanies?: string[];
  evidence?: string[];
  weights?: RankingWeights;
};

export type RankingJob = {
  id: string;
  companyId?: string;
  companyName?: string;
  title: string;
  description?: string;
  requirements?: string[];
  location?: string;
  workModel?: string;
  seniority?: string;
  salaryMin?: number;
  salaryMax?: number;
  eligibility?: "eligible" | "ineligible" | "unknown";
  freshnessDays?: number;
};

type ConstraintResult = {
  status: "pass" | "fail" | "unknown";
  reason: string;
};

export type RankingResult = {
  score: number;
  confidence: "high" | "medium" | "low";
  weights: Record<keyof typeof DEFAULT_RANKING_WEIGHTS, number>;
  dimensions: {
    skillsExperience: number;
    roleScope: number;
    domain: number;
    constraints: number;
    impact: number;
    freshness: number;
    interest: number;
  };
  hardConstraints: {
    location: ConstraintResult;
    workModel: ConstraintResult;
    seniority: ConstraintResult;
    salary: ConstraintResult;
    eligibility: ConstraintResult;
  };
  hardFailures: string[];
  explanations: {
    matched: string[];
    gaps: string[];
    unknowns: string[];
  };
  evidenceUsed: string[];
  scoringVersion: string;
};

const STOP_WORDS = new Set(["a", "an", "and", "for", "in", "of", "on", "or", "the", "to", "with", "our", "role", "team"]);

function normalise(value: string | undefined | null): string {
  return (value ?? "").toLocaleLowerCase().replace(/[^a-z0-9+.#/ -]/g, " ").replace(/\s+/g, " ").trim();
}

function tokens(value: string | undefined | null): string[] {
  return normalise(value).split(/[\s/,+.#-]+/).filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function containsConcept(haystack: string, concept: string): boolean {
  const phrase = normalise(concept);
  if (!phrase) return false;
  if (haystack.includes(phrase)) return true;
  const wanted = tokens(phrase);
  const available = new Set(tokens(haystack));
  return wanted.length > 0 && wanted.every((token) => available.has(token));
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function oneOf(value: string | undefined, accepted: string[] | undefined): boolean | null {
  if (!value || !accepted?.length) return null;
  const source = normalise(value);
  return accepted.some((item) => containsConcept(source, item));
}

function constraintScore(values: ConstraintResult[]): number {
  return clamp(values.reduce((total, value) => total + (value.status === "pass" ? 100 : value.status === "fail" ? 0 : 55), 0) / values.length);
}

function mergedWeights(input: RankingWeights | undefined): Record<keyof typeof DEFAULT_RANKING_WEIGHTS, number> {
  const output: Record<keyof typeof DEFAULT_RANKING_WEIGHTS, number> = { ...DEFAULT_RANKING_WEIGHTS };
  for (const key of Object.keys(output) as Array<keyof typeof DEFAULT_RANKING_WEIGHTS>) {
    const value = input?.[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) output[key] = value;
  }
  return output;
}

export function rankOpportunity(profile: RankingProfile, job: RankingJob): RankingResult {
  const jobText = normalise([job.title, job.description, ...(job.requirements ?? [])].filter(Boolean).join(" "));
  const requirements = job.requirements?.filter((value) => value.trim()) ?? tokens(job.description).slice(0, 12);
  const matchedRequirements = requirements.filter((requirement) =>
    profile.skills.some((skill) => containsConcept(requirement, skill) || containsConcept(skill, requirement)) ||
    profile.evidence?.some((evidence) => containsConcept(evidence, requirement)),
  );
  const skillsExperience = requirements.length ? clamp((matchedRequirements.length / requirements.length) * 100) : 50;

  const targetMatch = profile.targetFamilies.some((family) => containsConcept(normalise(job.title), family));
  const seniorityKnown = Boolean(job.seniority && profile.seniority);
  const seniorityMatches = seniorityKnown ? containsConcept(job.seniority ?? "", profile.seniority ?? "") : null;
  const roleScope = clamp((targetMatch ? 70 : 25) + (seniorityMatches === true ? 30 : seniorityMatches === false ? 0 : 15));

  const matchedDomains = profile.domains.filter((domain) => containsConcept(jobText, domain));
  const domain = profile.domains.length ? clamp((matchedDomains.length / profile.domains.length) * 100) : 50;

  const locationMatch = oneOf(job.location, profile.constraints.locations);
  const remoteCompatible = normalise(job.workModel).includes("remote") && (profile.constraints.locations ?? []).some((value) => normalise(value).includes("remote"));
  const locationConstraint: ConstraintResult = !job.location
    ? { status: "unknown", reason: "The role location was not published." }
    : locationMatch === true || remoteCompatible
      ? { status: "pass", reason: "The published location or remote arrangement matches the profile." }
      : { status: "fail", reason: "The published location is outside the profile's configured geography." };

  const workModelMatch = oneOf(job.workModel, profile.constraints.workModels);
  const workModelConstraint: ConstraintResult = !job.workModel
    ? { status: "unknown", reason: "The working arrangement was not published." }
    : workModelMatch === true
      ? { status: "pass", reason: "The published working arrangement is accepted by the profile." }
      : { status: "fail", reason: "The published working arrangement is outside the profile's preferences." };

  const seniorityConstraint: ConstraintResult = !job.seniority || !profile.seniority
    ? { status: "unknown", reason: "Seniority is not sufficiently specified." }
    : seniorityMatches
      ? { status: "pass", reason: "The published seniority matches the profile." }
      : { status: "fail", reason: "The published seniority does not match the profile." };

  const salaryConstraint: ConstraintResult = job.salaryMin === undefined && job.salaryMax === undefined
    ? { status: "unknown", reason: "Salary was not published." }
    : profile.constraints.minimumSalary !== undefined && (job.salaryMax ?? job.salaryMin ?? 0) < profile.constraints.minimumSalary
      ? { status: "fail", reason: "The published range is below the profile minimum." }
      : profile.constraints.maximumSalary !== undefined && (job.salaryMin ?? job.salaryMax ?? Number.POSITIVE_INFINITY) > profile.constraints.maximumSalary
        ? { status: "fail", reason: "The published range is above the profile maximum." }
        : { status: "pass", reason: "The published salary range is compatible with the profile." };

  const eligibilityConstraint: ConstraintResult = profile.constraints.eligibility === "ineligible" || job.eligibility === "ineligible"
    ? { status: "fail", reason: "Eligibility is explicitly marked as incompatible." }
    : profile.constraints.eligibility === "eligible" && job.eligibility === "eligible"
      ? { status: "pass", reason: "Eligibility is marked compatible by the supplied inputs." }
      : { status: "unknown", reason: "Legal eligibility requires confirmation from current evidence." };

  const hardConstraints = { location: locationConstraint, workModel: workModelConstraint, seniority: seniorityConstraint, salary: salaryConstraint, eligibility: eligibilityConstraint };
  const hardFailures = (Object.entries(hardConstraints) as Array<[string, ConstraintResult]>).filter(([, value]) => value.status === "fail").map(([key]) => key);
  const constraints = constraintScore(Object.values(hardConstraints));

  const impact = profile.evidence?.length ? clamp(45 + Math.min(55, profile.evidence.filter((item) => /\d|%|improv|increased|reduced|owned|led/i.test(item)).length * 18)) : 35;
  const freshness = job.freshnessDays === undefined ? 50 : job.freshnessDays <= 3 ? 100 : job.freshnessDays <= 7 ? 85 : job.freshnessDays <= 30 ? 65 : 35;
  const interest = profile.interestCompanies?.some((company) => normalise(company) === normalise(job.companyName)) ? 100 : 50;
  const dimensions = { skillsExperience, roleScope, domain, constraints, impact, freshness, interest };
  const weights = mergedWeights(profile.weights);
  const weightTotal = Object.values(weights).reduce((total, value) => total + value, 0) || 1;
  const score = clamp(Object.entries(dimensions).reduce((total, [key, value]) => total + value * (weights[key as keyof typeof weights] / weightTotal), 0));

  const matched: string[] = matchedRequirements.map((requirement) => `Matched requirement: ${requirement}`);
  const gaps: string[] = requirements.filter((requirement) => !matchedRequirements.includes(requirement)).map((requirement) => `Gap or unverified requirement: ${requirement}`);
  if (hardFailures.length) gaps.push(...hardFailures.map((key) => `Constraint failed: ${key}`));
  const unknowns: string[] = Object.entries(hardConstraints).filter(([, value]) => value.status === "unknown").map(([key, value]) => `${key}: ${value.reason}`);
  const evidenceUsed = (profile.evidence ?? []).filter((evidence) => matchedRequirements.some((requirement) => containsConcept(evidence, requirement)));
  const knownSignals = [job.title, job.location, job.workModel, job.seniority, ...(job.requirements ?? [])].filter(Boolean).length;
  const confidence = evidenceUsed.length >= 2 && knownSignals >= 5 ? "high" : evidenceUsed.length || knownSignals >= 3 ? "medium" : "low";

  return {
    score,
    confidence,
    weights,
    dimensions,
    hardConstraints,
    hardFailures,
    explanations: { matched, gaps, unknowns },
    evidenceUsed,
    scoringVersion: "v4-heuristic-1",
  };
}
