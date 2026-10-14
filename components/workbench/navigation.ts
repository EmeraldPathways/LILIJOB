import type { CompanyCategory } from "../../lib/domain/types";
import { CATEGORY_LABELS } from "../../lib/domain/constants";

export const WORKBENCH_NAV: Array<{ category: CompanyCategory; label: string; shortLabel: string; description: string }> = [
  { category: "work-permit", label: CATEGORY_LABELS["work-permit"], shortLabel: "Work permits", description: "Employers with evidence worth checking for sponsorship." },
  { category: "startups", label: CATEGORY_LABELS.startups, shortLabel: "Startups", description: "High-growth technology teams in the county." },
  { category: "fintech", label: CATEGORY_LABELS.fintech, shortLabel: "Fintech", description: "Financial technology companies and roles." },
  { category: "e-commerce", label: CATEGORY_LABELS["e-commerce"], shortLabel: "E-commerce", description: "Digital commerce and marketplace companies." },
];
