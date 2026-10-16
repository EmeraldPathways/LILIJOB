import { buildRawMessage, type GmailEnvironment, type GmailRawAttachment } from "./core";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const REQUEST_TIMEOUT_MS = 15_000;

export type GoogleTokens = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};

export class GmailSendError extends Error {
  constructor(
    message: string,
    readonly outcome: "failed" | "unknown",
  ) {
    super(message);
    this.name = "GmailSendError";
  }
}

async function tokenRequest(values: Record<string, string>): Promise<GoogleTokens> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("Google authorization could not be completed.");
  const result = await response.json() as Partial<GoogleTokens>;
  if (typeof result.access_token !== "string" || !result.access_token) {
    throw new Error("Google did not return an access token.");
  }
  return result as GoogleTokens;
}

export async function exchangeAuthorizationCode(input: {
  code: string;
  verifier: string;
  redirectUri: string;
  env: GmailEnvironment;
}): Promise<GoogleTokens> {
  if (!input.env.GOOGLE_CLIENT_ID || !input.env.GOOGLE_CLIENT_SECRET) {
    throw new Error("Gmail is not configured.");
  }
  return tokenRequest({
    code: input.code,
    code_verifier: input.verifier,
    client_id: input.env.GOOGLE_CLIENT_ID,
    client_secret: input.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
  });
}

export async function refreshGoogleAccessToken(input: {
  refreshToken: string;
  env: GmailEnvironment;
}): Promise<GoogleTokens> {
  if (!input.env.GOOGLE_CLIENT_ID || !input.env.GOOGLE_CLIENT_SECRET) {
    throw new Error("Gmail is not configured.");
  }
  return tokenRequest({
    refresh_token: input.refreshToken,
    client_id: input.env.GOOGLE_CLIENT_ID,
    client_secret: input.env.GOOGLE_CLIENT_SECRET,
    grant_type: "refresh_token",
  });
}

export async function googleAccountEmail(accessToken: string): Promise<string> {
  const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("Google account email could not be verified.");
  const result = await response.json() as { email?: unknown; verified_email?: unknown };
  if (result.verified_email !== true || typeof result.email !== "string" || !result.email) {
    throw new Error("Google account email could not be verified.");
  }
  return result.email;
}

export async function sendGmailMessage(input: {
  accessToken: string;
  to: string;
  subject: string;
  body: string;
  attachments?: GmailRawAttachment[];
}): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ raw: buildRawMessage(input.to, input.subject, input.body, input.attachments ?? []) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new GmailSendError("Gmail did not confirm delivery; it will not be retried automatically.", "unknown");
  }
  if (!response.ok) {
    const outcome = response.status >= 500 || response.status === 408 ? "unknown" : "failed";
    const message = outcome === "unknown"
      ? "Gmail did not confirm delivery; it will not be retried automatically."
      : `Gmail rejected the message (HTTP ${response.status}).`;
    throw new GmailSendError(message, outcome);
  }
  const result = await response.json().catch(() => null) as { id?: unknown } | null;
  if (typeof result?.id !== "string" || !result.id) {
    throw new GmailSendError("Gmail did not confirm delivery; it will not be retried automatically.", "unknown");
  }
  return result.id;
}

export async function revokeGoogleToken(token: string): Promise<void> {
  try {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // Local credentials are still removed if provider revocation is unavailable.
  }
}
