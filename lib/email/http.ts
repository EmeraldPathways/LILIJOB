export const OAUTH_COOKIE = "__Host-gmail-oauth";

export function privateNoStore(response: Response): Response {
  response.headers.set("cache-control", "private, no-store");
  return response;
}

export function emailJson(body: unknown, init?: ResponseInit): Response {
  return privateNoStore(Response.json(body, init));
}

export function hasSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function oauthCookie(value: string, maxAge: number): string {
  return `${OAUTH_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Lax`;
}

export function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");
    if (key === name) return valueParts.join("=") || null;
  }
  return null;
}

export function emailRedirect(request: Request, input: { connected?: true; error?: string }): Response {
  const target = new URL("/email", request.url);
  if (input.connected) target.searchParams.set("connected", "true");
  else target.searchParams.set("error", input.error ?? "Google connection could not be completed. Please try again.");
  return new Response(null, {
    status: 303,
    headers: {
      location: target.toString(),
      "set-cookie": oauthCookie("", 0),
      "cache-control": "private, no-store",
    },
  });
}

export function apiError(code: string, message: string, status: number): Response {
  return emailJson({ error: { code, message } }, { status });
}
