import { env } from "cloudflare:workers";
import { getDb } from "../../../../db";
import { and, eq, lt } from "drizzle-orm";
import { gmailOAuthStates } from "../../../../db/schema";
import { userFromRequest, unauthorizedResponse } from "../../../../lib/auth/require-user";
import { buildAuthorizationUrl, isGmailConfigured, randomToken, sha256Base64Url } from "../../../../lib/email/core";
import { emailJson, OAUTH_COOKIE, privateNoStore } from "../../../../lib/email/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = userFromRequest(request);
  if (!user) return privateNoStore(unauthorizedResponse());
  if (!isGmailConfigured(env)) {
    return emailJson({
      error: {
        code: "GMAIL_NOT_CONFIGURED",
        message: "Gmail is not configured. Add the Google OAuth credentials and token encryption key, then try again.",
      },
    }, { status: 503 });
  }

  const state = randomToken();
  const verifier = randomToken(48);
  const redirectUri = env.GOOGLE_REDIRECT_URI?.trim() || `${new URL(request.url).origin}/api/email/callback`;
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const db = getDb();
  await db.delete(gmailOAuthStates).where(and(
    eq(gmailOAuthStates.ownerId, user.userId),
    lt(gmailOAuthStates.expiresAt, new Date().toISOString()),
  ));
  await db.insert(gmailOAuthStates).values({
    id: `gmail_oauth_${crypto.randomUUID()}`,
    ownerId: user.userId,
    stateHash: await sha256Base64Url(state),
    pkceVerifier: verifier,
    redirectUri,
    expiresAt,
  });

  const authorizationUrl = buildAuthorizationUrl({
    clientId: env.GOOGLE_CLIENT_ID!,
    redirectUri,
    state,
    codeChallenge: await sha256Base64Url(verifier),
  });
  return new Response(null, {
    status: 302,
    headers: {
      location: authorizationUrl,
      "set-cookie": `${OAUTH_COOKIE}=${state}; Path=/; Max-Age=600; Secure; HttpOnly; SameSite=Lax`,
      "cache-control": "private, no-store",
    },
  });
}
