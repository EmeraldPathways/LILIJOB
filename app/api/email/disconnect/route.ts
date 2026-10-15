import { eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../../db";
import { gmailConnections, gmailOAuthStates } from "../../../../db/schema";
import { userFromRequest, unauthorizedResponse } from "../../../../lib/auth/require-user";
import { decryptToken, isGmailConfigured } from "../../../../lib/email/core";
import { apiError, emailJson, hasSameOrigin, privateNoStore } from "../../../../lib/email/http";
import { revokeGoogleToken } from "../../../../lib/email/google";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = userFromRequest(request);
  if (!user) return privateNoStore(unauthorizedResponse());
  if (!hasSameOrigin(request)) return apiError("CROSS_ORIGIN", "This request must come from this site.", 403);

  try {
    const db = getDb();
    const [connection] = await db.select().from(gmailConnections)
      .where(eq(gmailConnections.ownerId, user.userId)).limit(1);
    if (connection && isGmailConfigured(env)) {
      try {
        const token = connection.encryptedRefreshToken
          ? await decryptToken(connection.encryptedRefreshToken, env.GMAIL_TOKEN_ENCRYPTION_KEY!)
          : await decryptToken(connection.encryptedAccessToken, env.GMAIL_TOKEN_ENCRYPTION_KEY!);
        await revokeGoogleToken(token);
      } catch {
        // Still clear local credentials if they cannot be decrypted or revoked.
      }
    }
    await db.delete(gmailConnections).where(eq(gmailConnections.ownerId, user.userId));
    await db.delete(gmailOAuthStates).where(eq(gmailOAuthStates.ownerId, user.userId));
    return emailJson({ connected: false });
  } catch {
    return emailJson({ error: { code: "EMAIL_DISCONNECT_FAILED", message: "Unable to disconnect Gmail." } }, { status: 500 });
  }
}
