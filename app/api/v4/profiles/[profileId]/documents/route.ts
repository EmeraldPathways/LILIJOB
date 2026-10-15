import { env } from "cloudflare:workers";
import { userFromRequest, unauthorizedResponse } from "../../../../../../lib/auth/require-user";
import { createCandidateDocument, getCandidateProfile, listCandidateDocuments } from "../../../../../../lib/v4/repository";

export const dynamic = "force-dynamic";

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([".pdf", ".docx", ".txt"]);

export async function GET(request: Request, context: { params: Promise<{ profileId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { profileId } = await context.params;
  if (!await getCandidateProfile(user.userId, profileId)) return Response.json({ error: { code: "NOT_FOUND", message: "Candidate profile not found." } }, { status: 404 });
  return Response.json({ documents: await listCandidateDocuments(user.userId, profileId) });
}

export async function POST(request: Request, context: { params: Promise<{ profileId: string }> }) {
  const user = userFromRequest(request);
  if (!user) return unauthorizedResponse();
  const { profileId } = await context.params;
  if (!await getCandidateProfile(user.userId, profileId)) return Response.json({ error: { code: "NOT_FOUND", message: "Candidate profile not found." } }, { status: 404 });
  if (!env.BUCKET) return Response.json({ error: { code: "STORAGE_UNAVAILABLE", message: "Private document storage is not configured." } }, { status: 503 });

  const form = await request.formData().catch(() => null);
  const value = form?.get("file");
  if (!(value instanceof File)) return Response.json({ error: { code: "FILE_REQUIRED", message: "Upload a PDF, DOCX or TXT CV/document." } }, { status: 400 });
  const extension = value.name.slice(value.name.lastIndexOf(".")).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) return Response.json({ error: { code: "UNSUPPORTED_FILE", message: "Only PDF, DOCX and TXT documents are supported." } }, { status: 415 });
  if (value.size > MAX_DOCUMENT_BYTES) return Response.json({ error: { code: "FILE_TOO_LARGE", message: "Documents must be 10 MB or smaller." } }, { status: 413 });

  const bytes = await value.arrayBuffer();
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) return Response.json({ error: { code: "FILE_TOO_LARGE", message: "Documents must be 10 MB or smaller." } }, { status: 413 });
  const objectKey = `private/${user.userId}/candidate-documents/${crypto.randomUUID()}${extension}`;
  const type = typeof form?.get("type") === "string" ? String(form?.get("type")) : "master-cv";
  const parsedText = value.type === "text/plain" || extension === ".txt" ? new TextDecoder().decode(bytes).slice(0, 200_000) : undefined;
  try {
    await env.BUCKET.put(objectKey, bytes, { httpMetadata: { contentType: value.type || "application/octet-stream" } });
    const document = await createCandidateDocument(user.userId, {
      profileId,
      type,
      originalFilename: value.name,
      objectKey,
      parsedText,
      derived: { parseStatus: parsedText ? "ready" : "pending-review", contentType: value.type || "application/octet-stream" },
      consentStatus: "pending",
    });
    if (!document) {
      await env.BUCKET.delete(objectKey);
      return Response.json({ error: { code: "NOT_FOUND", message: "Candidate profile not found." } }, { status: 404 });
    }
    return Response.json({ document }, { status: 201 });
  } catch (error) {
    await env.BUCKET.delete(objectKey).catch(() => undefined);
    return Response.json({ error: { code: "DOCUMENT_UPLOAD_FAILED", message: error instanceof Error ? error.message : "Unable to store document." } }, { status: 500 });
  }
}
