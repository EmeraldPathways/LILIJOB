import { headers } from "next/headers";
import { redirect } from "next/navigation";

export type SiteUser = {
  userId: string;
  email: string;
  displayName: string;
};

export function userFromHeaders(input: Headers): SiteUser | null {
  const userId = input.get("oai-authenticated-user-id");
  const email = input.get("oai-authenticated-user-email");
  if (!userId || !email) return null;

  const encodedName = input.get("oai-authenticated-user-full-name");
  let displayName = email;
  if (encodedName) {
    try {
      displayName = decodeURIComponent(encodedName);
    } catch {
      displayName = encodedName;
    }
  }

  return { userId, email, displayName };
}

export async function requireSiteUser(returnTo = "/"): Promise<SiteUser> {
  const currentHeaders = await headers();
  const user = userFromHeaders(currentHeaders);
  if (user) return user;
  redirect(`/signin-with-chatgpt?return_to=${encodeURIComponent(returnTo)}`);
}

export function userFromRequest(request: Request): SiteUser | null {
  return userFromHeaders(request.headers);
}

export function unauthorizedResponse(): Response {
  return Response.json(
    { error: { code: "UNAUTHENTICATED", message: "Sign in with ChatGPT to use this private Site." } },
    { status: 401 },
  );
}
