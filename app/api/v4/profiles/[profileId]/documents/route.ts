import { env } from "cloudflare:workers";
import { userFromRequest, unauthorizedResponse } from "../../../../../../lib/auth/require-user";
import { createCandidateDocument, getCandidateProfile, listCandidateDocuments } from "../../../../../../lib/v4/repository";
import { detectCandidateDocumentFormat, extractCandidateDocumentText } from "../../../../../../lib/v4/documents";

export const dynamic = "force-dynamic";

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const CONTENT_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain; charset=utf-8",
} as const;

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
  if (value.size > MAX_DOCUMENT_BYTES) return Response.json({ error: { code: "FILE_TOO_LARGE", message: "Documents must be 10 MB or smaller." } }, { status: 413 });

  const bytes = await value.arrayBuffer();
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) return Response.json({ error: { code: "FILE_TOO_LARGE", message: "Documents must be 10 MB or smaller." } }, { status: 413 });
  let format: ReturnType<typeof detectCandidateDocumentFormat>;
  try {
    format = detectCandidateDocumentFormat(value.name, bytes);
  } catch (error) {
    const message = error instanceof Error && error.message.includes("supported")
      ? "Only PDF, DOCX and TXT documents are supported."
      : "The file contents do not match the selected document type.";
    return Response.json({ error: { code: "INVALID_DOCUMENT_FILE", message } }, { status: 415 });
  }
  const extension = `.${format}`;
  const objectKey = `private/${user.userId}/candidate-documents/${crypto.randomUUID()}${extension}`;
  const type = typeof form?.get("type") === "string" ? String(form?.get("type")) : "master-cv";
  let extraction: Awaited<ReturnType<typeof extractCandidateDocumentText>>;
  try {
    extraction = await extractCandidateDocumentText(bytes, value.name);
  } catch {
    extraction = { format, text: "", parseStatus: "needs-review" };
  }
  try {
    await env.BUCKET.put(objectKey, bytes, { httpMetadata: { contentType: CONTENT_TYPES[format] } });
    const document = await createCandidateDocument(user.userId, {
      profileId,
      type,
      originalFilename: value.name,
      objectKey,
      parsedText: extraction.text || undefined,
      derived: { parseStatus: extraction.parseStatus, contentType: CONTENT_TYPES[format], ...(extraction.pageCount ? { pageCount: extraction.pageCount } : {}) },
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
