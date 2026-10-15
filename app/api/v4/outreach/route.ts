import { userFromRequest, unauthorizedResponse } from "../../../../lib/auth/require-user";
import { createOutreachDraft, listOutreachDrafts } from "../../../../lib/v4/outreach-repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  return Response.json({ drafts: await listOutreachDrafts(user.userId) });
}

export async function POST(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.companyId !== "string" || typeof body.contactId !== "string" || typeof body.subject !== "string" || typeof body.body !== "string") {
    return Response.json({ error: { code: "INVALID_DRAFT", message: "Company, public contact, subject and body are required." } }, { status: 400 });
  }
  if (!body.subject.trim() || body.subject.length > 200 || /[\r\n]/.test(body.subject) || !body.body.trim() || body.body.length > 20_000) {
    return Response.json({ error: { code: "INVALID_DRAFT", message: "Check the subject and message length." } }, { status: 400 });
  }
  const draft = await createOutreachDraft(user.userId, {
    companyId: body.companyId,
    contactId: body.contactId,
    applicationId: typeof body.applicationId === "string" ? body.applicationId : undefined,
    subject: body.subject,
    body: body.body,
    generation: body.generation,
    attachmentDocumentId: typeof body.attachmentDocumentId === "string" ? body.attachmentDocumentId : undefined,
  });
  return draft ? Response.json({ draft }, { status: 201 }) : Response.json({ error: { code: "RECIPIENT_NOT_FOUND", message: "The company or public contact is unavailable." } }, { status: 404 });
}
