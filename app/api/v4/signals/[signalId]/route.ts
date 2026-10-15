import { userFromRequest, unauthorizedResponse } from "../../../../../lib/auth/require-user";
import { updateHiringSignal } from "../../../../../lib/v4/intelligence-repository";
import { isValidSignalDate, isValidSignalSourceUrl } from "../../../../../lib/v4/signals";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ signalId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { signalId } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: { code: "INVALID_SIGNAL_UPDATE", message: "Signal changes must be an object." } }, { status: 400 });

  let correction: { summary?: string; eventDate?: string | null; sourceUrl?: string } | undefined;
  if (body.correction !== undefined) {
    if (!body.correction || typeof body.correction !== "object" || Array.isArray(body.correction)) {
      return Response.json({ error: { code: "INVALID_SIGNAL_UPDATE", message: "Correction must contain a summary, event date, or source URL." } }, { status: 400 });
    }
    const raw = body.correction as Record<string, unknown>;
    const keys = Object.keys(raw);
    if (!keys.length || keys.some((key) => !["summary", "eventDate", "sourceUrl"].includes(key))) {
      return Response.json({ error: { code: "INVALID_SIGNAL_UPDATE", message: "Correction only accepts summary, eventDate, and sourceUrl." } }, { status: 400 });
    }
    if (raw.summary !== undefined && (typeof raw.summary !== "string" || !raw.summary.trim())) {
      return Response.json({ error: { code: "INVALID_SIGNAL_UPDATE", message: "Corrected summary cannot be empty." } }, { status: 400 });
    }
    if (raw.eventDate !== undefined && raw.eventDate !== null && !isValidSignalDate(raw.eventDate)) {
      return Response.json({ error: { code: "INVALID_SIGNAL_UPDATE", message: "Corrected event date must be a valid YYYY-MM-DD date or null." } }, { status: 400 });
    }
    if (raw.sourceUrl !== undefined && !isValidSignalSourceUrl(raw.sourceUrl)) {
      return Response.json({ error: { code: "INVALID_SIGNAL_UPDATE", message: "Corrected source URL must be HTTPS." } }, { status: 400 });
    }
    correction = {
      ...(typeof raw.summary === "string" ? { summary: raw.summary.trim() } : {}),
      ...(raw.eventDate === null || typeof raw.eventDate === "string" ? { eventDate: raw.eventDate } : {}),
      ...(typeof raw.sourceUrl === "string" ? { sourceUrl: raw.sourceUrl } : {}),
    };
  }
  if (body.suppressed !== undefined && typeof body.suppressed !== "boolean") {
    return Response.json({ error: { code: "INVALID_SIGNAL_UPDATE", message: "Suppression must be true or false." } }, { status: 400 });
  }
  if (!correction && typeof body.suppressed !== "boolean") {
    return Response.json({ error: { code: "INVALID_SIGNAL_UPDATE", message: "Provide a correction or a suppression change." } }, { status: 400 });
  }

  try {
    const signal = await updateHiringSignal(user.userId, signalId, {
      ...(correction ? { correction } : {}),
      ...(typeof body.suppressed === "boolean" ? { suppressed: body.suppressed } : {}),
    });
    return signal ? Response.json({ signal }) : Response.json({ error: { code: "NOT_FOUND", message: "Signal not found." } }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Signal change could not be validated.";
    if (/source/i.test(message)) return Response.json({ error: { code: "INVALID_SOURCE", message: "The corrected source must belong to this owner and company." } }, { status: 400 });
    throw error;
  }
}
