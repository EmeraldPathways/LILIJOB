import { CheckCircle2, CircleAlert, Clock3, ShieldCheck } from "lucide-react";

export function EnrichmentBadge({ status }: { status: string }) {
  if (status === "completed") {
    return <span className="badge badge-green"><CheckCircle2 size={13} /> Fresh</span>;
  }
  if (status === "running" || status === "queued") {
    return <span className="badge badge-amber"><Clock3 size={13} /> {status === "running" ? "Researching" : "Queued"}</span>;
  }
  return <span className="badge badge-muted"><CircleAlert size={13} /> Needs review</span>;
}

export function PermitBadge({ signal }: { signal: "confirmed" | "potential" | "unknown" }) {
  if (signal === "confirmed") return <span className="badge badge-purple"><ShieldCheck size={13} /> Confirmed sponsor</span>;
  if (signal === "potential") return <span className="badge badge-amber"><ShieldCheck size={13} /> Potential fit</span>;
  return <span className="badge badge-muted">Permit evidence pending</span>;
}
