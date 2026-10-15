import { and, eq, gt, isNull } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../../db";
import { gmailConnections, gmailOAuthStates } from "../../../../db/schema";
import { userFromRequest } from "../../../../lib/auth/require-user";
import { encryptToken, isGmailConfigured, sha256Base64Url } from "../../../../lib/email/core";
import { cookieValue, emailRedirect, OAUTH_COOKIE } from "../../../../lib/email/http";
import { exchangeAuthorizationCode, googleAccountEmail } from "../../../../lib/email/google";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isGmailConfigured(env)) {
    return emailRedirect(request, { error: "Gmail is not configured. Ask the site administrator to finish setup." });
  }
  const user = userFromRequest(request);
  if (!user) return emailRedirect(request, { error: "Sign in again, then reconnect Google." });

  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const cookieState = cookieValue(request, OAUTH_COOKIE);
  if (!state || !cookieState || state !== cookieState) {
    return emailRedirect(request, { error: "Google connection expired or could not be verified. Please try again." });
  }

  try {
    const db = getDb();
    const now = new Date().toISOString();
    const [pending] = await db.update(gmailOAuthStates).set({ consumedAt: now, updatedAt: now })
      .where(and(
        eq(gmailOAuthStates.ownerId, user.userId),
        eq(gmailOAuthStates.stateHash, await sha256Base64Url(state)),
        isNull(gmailOAuthStates.consumedAt),
        gt(gmailOAuthStates.expiresAt, now),
      ))
      .returning({ verifier: gmailOAuthStates.pkceVerifier, redirectUri: gmailOAuthStates.redirectUri });
    if (!pending) {
      return emailRedirect(request, { error: "Google connection expired or could not be verified. Please try again." });
    }

    if (url.searchParams.has("error")) {
      return emailRedirect(request, { error: "Google connection was not completed. You can try again." });
    }
    const code = url.searchParams.get("code");
    if (!code) return emailRedirect(request, { error: "Google did not return an authorization code. Please try again." });

    const tokens = await exchangeAuthorizationCode({
      code,
      verifier: pending.verifier,
      redirectUri: pending.redirectUri,
      env,
    });
    const grantedScopes = new Set(tokens.scope?.split(/\s+/) ?? []);
    if (
      !grantedScopes.has("https://www.googleapis.com/auth/gmail.send") ||
      !grantedScopes.has("https://www.googleapis.com/auth/userinfo.email")
    ) {
      return emailRedirect(request, { error: "Gmail send permission is required. Please reconnect and grant it." });
    }
    const googleEmail = await googleAccountEmail(tokens.access_token);
    const [existing] = await db.select().from(gmailConnections)
      .where(eq(gmailConnections.ownerId, user.userId)).limit(1);
    const encryptedRefreshToken = tokens.refresh_token
      ? await encryptToken(tokens.refresh_token, env.GMAIL_TOKEN_ENCRYPTION_KEY!)
      : existing?.googleEmail.toLowerCase() === googleEmail.toLowerCase()
        ? existing.encryptedRefreshToken
        : null;
    if (!encryptedRefreshToken) {
      return emailRedirect(request, { error: "Google did not grant offline access. Please reconnect and approve access." });
    }

    const expiresIn = Number.isFinite(tokens.expires_in) && (tokens.expires_in ?? 0) > 0
      ? tokens.expires_in!
      : 3600;
    const encryptedAccessToken = await encryptToken(tokens.access_token, env.GMAIL_TOKEN_ENCRYPTION_KEY!);
    const accessTokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    await db.insert(gmailConnections).values({
      id: existing?.id ?? `gmail_${crypto.randomUUID()}`,
      ownerId: user.userId,
      googleEmail,
      encryptedAccessToken,
      encryptedRefreshToken,
      accessTokenExpiresAt,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: gmailConnections.ownerId,
      set: {
        googleEmail,
        encryptedAccessToken,
        encryptedRefreshToken,
        accessTokenExpiresAt,
        updatedAt: now,
      },
    });
    return emailRedirect(request, { connected: true });
  } catch {
    return emailRedirect(request, { error: "Google connection could not be completed. Please try again." });
  }
}
