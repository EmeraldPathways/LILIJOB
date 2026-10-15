import { userFromRequest, unauthorizedResponse } from "../../../../../lib/auth/require-user";
import { deleteRecruitmentContact, updateRecruitmentContact } from "../../../../../lib/v4/intelligence-repository";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ contactId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { contactId } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: { code: "INVALID_CONTACT", message: "Contact changes must be an object." } }, { status: 400 });
  const contact = await updateRecruitmentContact(user.userId, contactId, {
    doNotContact: typeof body.doNotContact === "boolean" ? body.doNotContact : undefined,
    correctionFlag: typeof body.correctionFlag === "boolean" ? body.correctionFlag : undefined,
    verificationStatus: typeof body.verificationStatus === "string" ? body.verificationStatus : undefined,
  });
  return contact ? Response.json({ contact }) : Response.json({ error: { code: "NOT_FOUND", message: "Contact not found." } }, { status: 404 });
}

export async function DELETE(request: Request, context: { params: Promise<{ contactId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { contactId } = await context.params;
  const deleted = await deleteRecruitmentContact(user.userId, contactId);
  return deleted ? Response.json({ deleted: true }) : Response.json({ error: { code: "NOT_FOUND", message: "Contact not found." } }, { status: 404 });
}
