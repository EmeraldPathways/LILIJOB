export type ContactClassificationInput = {
  name?: string;
  role?: string;
  department?: string;
  email?: string | null;
  linkedinUrl?: string | null;
  sourceUrl?: string | null;
  observedAt?: string | null;
};

export type ContactClassification = {
  type: "recruitment-specific" | "public-named-recruiter" | "public-relevant-hiring-manager" | "generic-hr" | "general-business-inbox" | "sales" | "unknown";
  email: string | null;
  emailStatus: "published" | "email-unavailable";
  inferredEmail: false;
  qualityScore: number;
  rationale: string;
  sourceUrl: string | null;
};

const GENERIC_INBOXES = new Set(["info", "contact", "hello", "office", "admin", "support", "team", "general", "enquiries", "inquiries"]);
const SALES_INBOXES = new Set(["sales", "business", "partnerships", "growth"]);
const HR_INBOXES = new Set(["hr", "people", "careers", "jobs", "recruitment"]);

export function isGenericInbox(email: string | null | undefined): boolean {
  const local = email?.split("@", 1)[0]?.trim().toLowerCase();
  return Boolean(local && GENERIC_INBOXES.has(local));
}

function localPart(email: string | null | undefined): string {
  return email?.split("@", 1)[0]?.trim().toLowerCase() ?? "";
}

function cleanEmail(email: string | null | undefined): string | null {
  if (!email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return null;
  return email.trim().toLowerCase();
}

export function classifyContact(input: ContactClassificationInput): ContactClassification {
  const email = cleanEmail(input.email);
  const local = localPart(email);
  const role = `${input.role ?? ""} ${input.department ?? ""}`.toLowerCase();
  const named = Boolean(input.name?.trim());
  let type: ContactClassification["type"] = "unknown";
  let rationale = "The public record does not establish a contact category.";

  if (local && SALES_INBOXES.has(local)) {
    type = "sales";
    rationale = "The published inbox is a sales or partnerships address.";
  } else if (local && GENERIC_INBOXES.has(local)) {
    type = "general-business-inbox";
    rationale = "The published address is a shared business inbox and is not elevated to an individual recruiter.";
  } else if (local && (HR_INBOXES.has(local) || /talent acquisition|recruitment|recruiter|people partner|human resources/.test(role))) {
    type = "recruitment-specific";
    rationale = "The published address or public role is specific to recruitment or talent.";
  } else if (named && /recruiter|talent acquisition|recruitment|people partner|ta partner/.test(role)) {
    type = "public-named-recruiter";
    rationale = "The named recruiter is publicly identified, but no published email address is available.";
  } else if (named && /head of product|product director|product lead|hiring manager|engineering manager|growth lead|talent lead/.test(role)) {
    type = "public-relevant-hiring-manager";
    rationale = "The public role may be relevant to a hiring conversation; relevance is separate from email reliability.";
  } else if (local && HR_INBOXES.has(local)) {
    type = "generic-hr";
    rationale = "The published address is a generic HR or careers inbox.";
  } else if (local) {
    type = "unknown";
    rationale = "A published address exists, but the public record does not establish its recruiting relevance.";
  }

  const qualityScore = Math.min(100, (email ? 35 : 0) + (input.sourceUrl ? 30 : 0) + (named ? 20 : 0) + (input.linkedinUrl ? 15 : 0));
  return {
    type,
    email,
    emailStatus: email ? "published" : "email-unavailable",
    inferredEmail: false,
    qualityScore,
    rationale,
    sourceUrl: input.sourceUrl?.trim() || null,
  };
}
