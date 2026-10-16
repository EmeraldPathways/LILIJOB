import { userFromRequest, unauthorizedResponse } from "../../../../../lib/auth/require-user";
import { createCvProposal, listCvProposals } from "../../../../../lib/v5/cv";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const profileId = new URL(request.url).searchParams.get("profileId") ?? undefined;
  return Response.json({ proposals: await listCvProposals(user.userId, profileId) }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.profileId !== "string" || typeof body.masterDocumentId !== "string" || typeof body.roleTitle !== "string" || typeof body.companyName !== "string" || typeof body.sourceUrl !== "string") return Response.json({ error: { code: "INVALID_CV_PROPOSAL", message: "Profile, master document, role, company and source URL are required." } }, { status: 400 });
  try {
    const proposal = await createCvProposal(user.userId, {
      profileId: body.profileId,
      masterDocumentId: body.masterDocumentId,
      jobSnapshotId: typeof body.jobSnapshotId === "string" ? body.jobSnapshotId : null,
      applicationId: typeof body.applicationId === "string" ? body.applicationId : null,
      roleTitle: body.roleTitle,
      companyName: body.companyName,
      sourceUrl: body.sourceUrl,
      requirements: Array.isArray(body.requirements) ? body.requirements.filter((item): item is string => typeof item === "string") : undefined,
    });
    return proposal ? Response.json({ proposal }, { status: 201 }) : Response.json({ error: { code: "PROFILE_NOT_FOUND", message: "Candidate profile not found." } }, { status: 404 });
  } catch (error) {
    return Response.json({ error: { code: "INVALID_CV_PROPOSAL", message: error instanceof Error ? error.message : "The tailored CV could not be created." } }, { status: 400 });
  }
}
