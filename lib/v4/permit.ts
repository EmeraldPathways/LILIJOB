export type PermitRuleProvenanceInput = {
  authority?: string | null;
  title?: string | null;
  /** A date reported by the administrator. The application does not verify it. */
  sourceCheckedAt?: string | null;
};

export type PermitRuleProvenance = {
  authority: string | null;
  title: string | null;
  sourceCheckedAt: string | null;
  sourceCheckBasis: "admin-reported" | "not-provided";
  verificationStatus: "not-live-verified";
};

export type PermitRuleRefresh = {
  status: "manual-review-required";
  automated: false;
  liveVerificationPerformed: false;
  lastAttemptAt: null;
};

export type PermitRule = {
  id: string;
  ruleSet: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceUrl: string;
  eligibleOccupations: string[];
  salaryThreshold?: number;
  requiredConditions?: string[];
  provenance?: PermitRuleProvenanceInput;
};

export type PermitEvaluationInput = {
  roleTitle: string;
  salary: number | null;
  relevantDate: string;
  dublinEvidence: "office-address" | "specific-job" | "remote-from-Ireland" | "unspecific-Irish-presence" | "none" | "unknown";
  pastSponsorshipEvidence: boolean | null;
  currentSupportEvidence: boolean | null;
  salaryPeriod?: "year" | "month" | "week" | "day" | "hour" | "unknown";
  conditionEvidence?: Record<string, "met" | "not-met" | "unknown" | "requires-review">;
};

export type PermitCondition = { name: string; status: "met" | "not-met" | "unknown" | "requires-review"; detail: string };

export type PermitEvaluation = {
  status: "potential" | "cannot-determine" | "not-evidenced";
  labels: string[];
  explanation: string;
  sourceUrl: string | null;
  ruleId: string | null;
  ruleSet: string | null;
  ruleEffectiveFrom: string | null;
  ruleEffectiveTo: string | null;
  provenance: PermitRuleProvenance | null;
  refresh: PermitRuleRefresh;
  requiresConfirmation: true;
  conditions: PermitCondition[];
};

const manualRefreshState: PermitRuleRefresh = {
  status: "manual-review-required",
  automated: false,
  liveVerificationPerformed: false,
  lastAttemptAt: null,
};

export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function isOfficialPermitSourceUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") && (host === "gov.ie" || host.endsWith(".gov.ie"));
  } catch {
    return false;
  }
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function dateValue(value: string): number {
  if (!isValidIsoDate(value)) return Number.NaN;
  return Date.parse(`${value}T00:00:00.000Z`);
}

export function selectPermitRule(rules: PermitRule[], relevantDate: string): PermitRule | null {
  const target = dateValue(relevantDate);
  if (!Number.isFinite(target)) return null;
  const active = rules.filter((rule) => {
    const from = dateValue(rule.effectiveFrom);
    const to = rule.effectiveTo === null ? Number.POSITIVE_INFINITY : dateValue(rule.effectiveTo);
    return Number.isFinite(from) && (Number.isFinite(to) || to === Number.POSITIVE_INFINITY) && to >= from && from <= target && to >= target;
  });
  // The input does not identify a permit scheme. Any overlap is therefore ambiguous.
  return active.length === 1 ? active[0] : null;
}

function ruleProvenance(rule: PermitRule): PermitRuleProvenance {
  const sourceCheckedAt = isValidIsoDate(rule.provenance?.sourceCheckedAt) ? rule.provenance.sourceCheckedAt : null;
  return {
    authority: rule.provenance?.authority?.trim() || null,
    title: rule.provenance?.title?.trim() || null,
    sourceCheckedAt,
    sourceCheckBasis: sourceCheckedAt ? "admin-reported" : "not-provided",
    verificationStatus: "not-live-verified",
  };
}

function evidenceLabel(value: boolean | null, yes: string, no: string, unknown: string): string {
  return value === true ? yes : value === false ? no : unknown;
}

export function evaluatePermit(input: PermitEvaluationInput, rules: PermitRule[]): PermitEvaluation {
  const rule = selectPermitRule(rules, input.relevantDate);
  const labels = [
    "potential eligibility only; not a legal determination",
    "user/legal confirmation required",
    "rule source not live-verified",
    evidenceLabel(input.pastSponsorshipEvidence, "public evidence of past sponsorship", "past sponsorship not evidenced", "past sponsorship evidence unknown"),
    evidenceLabel(input.currentSupportEvidence, "explicit employer statement of current support", "current employer support not evidenced", "current employer support unknown"),
  ];
  const conditions: PermitCondition[] = [
    { name: "occupation", status: "unknown", detail: "Occupation evidence has not been evaluated." },
    { name: "salary", status: "unknown", detail: "Published annual salary is unknown." },
    { name: "Dublin role/location", status: input.dublinEvidence === "unknown" ? "unknown" : input.dublinEvidence === "none" ? "not-met" : "met", detail: input.dublinEvidence === "none" ? "No Dublin role or location evidence was supplied." : input.dublinEvidence === "unknown" ? "Dublin role/location evidence is unknown." : `${input.dublinEvidence.replaceAll("-", " ")} evidence supplied; verify the role location.` },
    { name: "current employer support", status: input.currentSupportEvidence === true ? "met" : input.currentSupportEvidence === false ? "not-met" : "unknown", detail: input.currentSupportEvidence === true ? "Explicit employer support evidence supplied." : input.currentSupportEvidence === false ? "Current employer support is not evidenced." : "Current employer support is unknown." },
  ];
  if (input.dublinEvidence === "unknown") labels.push("Dublin evidence unknown");
  else if (input.dublinEvidence === "none") labels.push("Dublin connection not evidenced");
  else labels.push(`${input.dublinEvidence.replaceAll("-", " ")} evidence; not independently confirmed`);

  if (!rule) {
    labels.push("applicable rule is unknown for this date", "insufficient information");
    return {
      status: "cannot-determine",
      labels,
      explanation: "No single unambiguous effective rule is available for the supplied role date. Legal eligibility cannot be determined.",
      sourceUrl: null,
      ruleId: null,
      ruleSet: null,
      ruleEffectiveFrom: null,
      ruleEffectiveTo: null,
      provenance: null,
      refresh: manualRefreshState,
      requiresConfirmation: true,
      conditions,
    };
  }

  const role = normalise(input.roleTitle);
  const roleKnown = role.length > 0;
  const occupationMatches = roleKnown && rule.eligibleOccupations.some((occupation) => {
    const normalizedOccupation = normalise(occupation);
    return normalizedOccupation.length > 0 && (role.includes(normalizedOccupation) || normalizedOccupation.includes(role));
  });
  const salaryKnown = typeof input.salary === "number" && Number.isFinite(input.salary) && input.salary >= 0;
  const salaryPeriodKnown = (input.salaryPeriod ?? "year") === "year";
  const salaryMeetsThreshold = salaryKnown && (rule.salaryThreshold === undefined || (Number.isFinite(rule.salaryThreshold) && rule.salaryThreshold >= 0 && input.salary! >= rule.salaryThreshold));
  conditions[0] = { name: "occupation", status: occupationMatches ? "met" : roleKnown ? "not-met" : "unknown", detail: occupationMatches ? "Role duties/title match one of the supplied rule occupations; duties still require review." : roleKnown ? "The role did not match a supplied occupation; title alone is not a legal decision." : "Role title is unknown." };
  conditions[1] = { name: "salary", status: !salaryKnown || !salaryPeriodKnown ? "unknown" : salaryMeetsThreshold ? "met" : "not-met", detail: !salaryKnown ? "No published annual salary was supplied." : !salaryPeriodKnown ? "Salary was not explicitly annual and was not annualised." : salaryMeetsThreshold ? "Published annual salary meets the selected threshold." : "Published annual salary is below the selected threshold." };
  for (const required of rule.requiredConditions ?? []) {
    const status = input.conditionEvidence?.[required] ?? "unknown";
    conditions.push({ name: required, status, detail: status === "met" ? "Condition marked met from supplied evidence." : status === "not-met" ? "Condition marked not met from supplied evidence." : "Condition requires evidence or review." });
  }
  for (const condition of conditions.filter((item) => item.status === "unknown" || item.status === "requires-review")) labels.push(`${condition.name} requires review`);
  const provenance = ruleProvenance(rule);
  const common = {
    sourceUrl: rule.sourceUrl,
    ruleId: rule.id,
    ruleSet: rule.ruleSet,
    ruleEffectiveFrom: rule.effectiveFrom,
    ruleEffectiveTo: rule.effectiveTo,
    provenance,
      refresh: manualRefreshState,
    requiresConfirmation: true as const,
      conditions,
  };

  if (occupationMatches && salaryMeetsThreshold && salaryPeriodKnown && !(conditions.some((condition) => condition.status === "unknown" || condition.status === "requires-review" && condition.name !== "current employer support"))) {
    labels.push("potential occupation/salary eligibility");
    return {
      ...common,
      status: "potential",
      labels,
      explanation: "The role and published annual salary match the selected effective rule inputs. This is only a potential signal; the rule source was not verified live and user/legal confirmation is required.",
    };
  }

  if (!roleKnown || !salaryKnown) {
    if (!roleKnown) labels.push("role unknown");
    if (!salaryKnown) labels.push("salary unknown");
    labels.push("insufficient information");
    const reason = !salaryKnown && !roleKnown ? "Role and salary are unknown." : !salaryKnown ? "Salary is unknown." : "Role is unknown.";
    return { ...common, status: "cannot-determine", labels, explanation: `${reason} Eligibility cannot be determined; this is not a legal conclusion.` };
  }

  labels.push("not evidenced");
  const reason = !occupationMatches
    ? "The role did not match an occupation in the selected rule inputs."
    : "The published salary is below the selected rule threshold.";
  return { ...common, status: "not-evidenced", labels, explanation: `${reason} This is not a legal conclusion.` };
}
