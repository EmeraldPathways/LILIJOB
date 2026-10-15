import { userFromRequest, unauthorizedResponse } from "../../../../lib/auth/require-user";
import { createRecruitmentContact, listRecruitmentContacts } from "../../../../lib/v4/intelligence-repository";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  return Response.json({ contacts: await listRecruitmentContacts(user.userId, new URL(request.url).searchParams.get("companyId") ?? undefined) });
}

export async function POST(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.companyId !== "string") return Response.json({ error: { code: "INVALID_CONTACT", message: "A company ID is required." } }, { status: 400 });
  const contact = await createRecruitmentContact(user.userId, {
    companyId: body.companyId,
    name: typeof body.name === "string" ? body.name : undefined,
    role: typeof body.role === "string" ? body.role : undefined,
    department: typeof body.department === "string" ? body.department : undefined,
    email: typeof body.email === "string" ? body.email : undefined,
    linkedinUrl: typeof body.linkedinUrl === "string" ? body.linkedinUrl : undefined,
    sourceUrl: typeof body.sourceUrl === "string" ? body.sourceUrl : undefined,
    observedAt: typeof body.observedAt === "string" ? body.observedAt : undefined,
  });
  return contact ? Response.json({ contact }, { status: 201 }) : Response.json({ error: { code: "COMPANY_NOT_FOUND", message: "Company not found." } }, { status: 404 });
}
