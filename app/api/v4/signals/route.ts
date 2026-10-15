import { userFromRequest, unauthorizedResponse } from "../../../../lib/auth/require-user";
import { createHiringSignal, listHiringSignals } from "../../../../lib/v4/intelligence-repository";
import { isHiringSignalType, isValidSignalDate, isValidSignalSourceUrl, signalDatePart, type SignalReliability } from "../../../../lib/v4/signals";

export const dynamic = "force-dynamic";

const reliabilities: readonly SignalReliability[] = ["primary", "secondary", "directory", "unknown"];

function parseReliability(value: unknown): SignalReliability | null {
  if (value === undefined || value === null) return "unknown";
  return typeof value === "string" && (reliabilities as readonly string[]).includes(value) ? value as SignalReliability : null;
}

function validScore(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const companyId = new URL(request.url).searchParams.get("companyId")?.trim() || undefined;
  return Response.json({ signals: await listHiringSignals(user.userId, companyId) });
}

export async function POST(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.companyId !== "string" || !body.companyId.trim() || !isHiringSignalType(body.type) || typeof body.summary !== "string" || !body.summary.trim() || typeof body.discoveredAt !== "string" || !signalDatePart(body.discoveredAt) || !isValidSignalSourceUrl(body.sourceUrl)) {
    return Response.json({ error: { code: "INVALID_SIGNAL", message: "Provide a company, supported signal type, summary, valid discovery date, and HTTPS source URL." } }, { status: 400 });
  }
  if (body.eventDate !== undefined && body.eventDate !== null && !isValidSignalDate(body.eventDate)) {
    return Response.json({ error: { code: "INVALID_SIGNAL", message: "Event date must be a valid YYYY-MM-DD date or null." } }, { status: 400 });
  }
  const sourceReliability = parseReliability(body.sourceReliability);
  if (!sourceReliability) return Response.json({ error: { code: "INVALID_SIGNAL", message: "Source reliability must be primary, secondary, directory, or unknown." } }, { status: 400 });
  const functionRelevance = body.functionRelevance === undefined ? 0 : body.functionRelevance;
  const companyInterest = body.companyInterest === undefined ? 0 : body.companyInterest;
  if (!validScore(functionRelevance) || !validScore(companyInterest)) {
    return Response.json({ error: { code: "INVALID_SIGNAL", message: "Function relevance and company interest must be numbers from 0 to 100." } }, { status: 400 });
  }
  if (body.sourceId !== undefined && body.sourceId !== null && typeof body.sourceId !== "string") {
    return Response.json({ error: { code: "INVALID_SIGNAL", message: "Source ID must be a string or null." } }, { status: 400 });
  }
  try {
    const signal = await createHiringSignal(user.userId, {
      companyId: body.companyId.trim(),
      type: body.type,
      summary: body.summary.trim(),
      eventDate: body.eventDate === null ? null : typeof body.eventDate === "string" ? body.eventDate : null,
      discoveredAt: body.discoveredAt,
      sourceUrl: body.sourceUrl,
      sourceReliability,
      dublinConnection: typeof body.dublinConnection === "boolean" ? body.dublinConnection : null,
      functionRelevance,
      companyInterest,
      sourceId: typeof body.sourceId === "string" ? body.sourceId : null,
    });
    return signal ? Response.json({ signal }, { status: 201 }) : Response.json({ error: { code: "COMPANY_NOT_FOUND", message: "Company not found." } }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Signal source could not be validated.";
    if (/source/i.test(message)) return Response.json({ error: { code: "INVALID_SOURCE", message: "The supplied source must belong to this owner and company and match the source URL." } }, { status: 400 });
    throw error;
  }
}
