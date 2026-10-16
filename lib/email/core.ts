const encoder = new TextEncoder();

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.email",
] as const;

export type GmailEnvironment = {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  GMAIL_TOKEN_ENCRYPTION_KEY?: string;
};

export function isGmailConfigured(env: GmailEnvironment): boolean {
  return Boolean(
    env.GOOGLE_CLIENT_ID?.trim() &&
      env.GOOGLE_CLIENT_SECRET?.trim() &&
      env.GMAIL_TOKEN_ENCRYPTION_KEY?.trim(),
  );
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url value.");
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function randomToken(byteLength = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256Base64Url(value: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(encoder.encode(value)))));
}

function encryptionKey(encodedKey: string): Promise<CryptoKey> {
  const bytes = fromBase64Url(encodedKey);
  if (bytes.byteLength !== 32) throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY must decode to 32 bytes.");
  return crypto.subtle.importKey("raw", toArrayBuffer(bytes), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptToken(value: string, encodedKey: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(encodedKey);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(encoder.encode(value)),
  );
  return `v1.${base64Url(iv)}.${base64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptToken(envelope: string, encodedKey: string): Promise<string> {
  const [version, encodedIv, encodedCiphertext, ...extra] = envelope.split(".");
  if (version !== "v1" || !encodedIv || !encodedCiphertext || extra.length) {
    throw new Error("Invalid encrypted Gmail token.");
  }
  const key = await encryptionKey(encodedKey);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(fromBase64Url(encodedIv)) },
    key,
    toArrayBuffer(fromBase64Url(encodedCiphertext)),
  );
  return new TextDecoder().decode(plaintext);
}

function normalizedEmailHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

export function validEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim();
  if (
    email.length > 254 ||
    /[\r\n\s]/.test(email) ||
    !/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+$/i.test(email)
  ) return null;
  return email;
}

export function emailFromCompanyData(metadataJson: string, contactEmails: string[]): string | null {
  let metadata: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(metadataJson);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      metadata = parsed as Record<string, unknown>;
    }
  } catch {
    // Malformed metadata has no usable company email header.
  }

  const original = metadata.original;
  if (original && typeof original === "object" && !Array.isArray(original)) {
    const headers = original as Record<string, unknown>;
    const priorities = ["email", "company email", "email address", "company email address"];
    for (const priority of priorities) {
      const header = Object.keys(headers).find((name) => normalizedEmailHeader(name) === priority);
      const email = header ? validEmail(headers[header]) : null;
      if (email) return email;
    }
  }

  for (const value of contactEmails) {
    const email = validEmail(value);
    if (email) return email;
  }
  return null;
}

export function buildAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent select_account",
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export type GmailRawAttachment = { filename: string; mimeType: string; bytes: Uint8Array };

function wrappedBase64(bytes: Uint8Array): string {
  return toBase64(bytes).match(/.{1,76}/g)?.join("\r\n") ?? "";
}

export function buildRawMessage(to: string, subject: string, body: string, attachments: GmailRawAttachment[] = []): string {
  const validTo = validEmail(to);
  if (!validTo) throw new Error("Recipient email is invalid.");
  if (!subject.trim() || subject.length > 200 || /[\r\n]/.test(subject)) {
    throw new Error("Subject must be 1–200 characters without line breaks.");
  }
  if (body.length > 20_000) throw new Error("Message body exceeds 20,000 characters.");

  const encodedSubject = toBase64(encoder.encode(subject));
  if (attachments.length > 3) throw new Error("At most three attachments may be included.");
  for (const attachment of attachments) {
    if (!attachment.filename.trim() || attachment.filename.length > 180 || /[\r\n\u0000]/.test(attachment.filename)) throw new Error("Attachment filename is invalid.");
    if (!/^[\w!#$&.+\-^]+\/[\w!#$&.+\-^]+$/.test(attachment.mimeType)) throw new Error("Attachment content type is invalid.");
    if (attachment.bytes.byteLength > 10 * 1024 * 1024) throw new Error("Attachment is too large.");
  }
  const encodedBody = wrappedBase64(encoder.encode(body));
  const mime: string[] = [`To: ${validTo}`, `Subject: =?UTF-8?B?${encodedSubject}?=`, "MIME-Version: 1.0"];
  if (!attachments.length) {
    mime.push("Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", encodedBody);
  } else {
    const boundary = `=_LILI_${randomToken(12)}`;
    mime.push(`Content-Type: multipart/mixed; boundary="${boundary}"`, "", `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", encodedBody);
    for (const attachment of attachments) {
      mime.push(`--${boundary}`, `Content-Type: ${attachment.mimeType}`, "Content-Transfer-Encoding: base64", `Content-Disposition: attachment; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`, "", wrappedBase64(attachment.bytes));
    }
    mime.push(`--${boundary}--`, "");
  }
  return base64Url(encoder.encode(mime.join("\r\n")));
}
