import { describe, expect, it } from "vitest";
import {
  buildAuthorizationUrl,
  buildRawMessage,
  decryptToken,
  emailFromCompanyData,
  encryptToken,
  sha256Base64Url,
} from "../../lib/email/core";

const key = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1)).toString("base64url");

describe("Gmail primitives", () => {
  it("encrypts tokens at rest and rejects a different key", async () => {
    const encrypted = await encryptToken("refresh-secret", key);
    expect(encrypted).not.toContain("refresh-secret");
    await expect(decryptToken(encrypted, key)).resolves.toBe("refresh-secret");
    await expect(decryptToken(encrypted, Buffer.alloc(32, 8).toString("base64url"))).rejects.toThrow();
  });

  it("builds an authorization URL with only the send and email scopes plus PKCE", async () => {
    const url = new URL(buildAuthorizationUrl({
      clientId: "client-id",
      redirectUri: "https://site.example/api/email/callback",
      state: "random-state",
      codeChallenge: await sha256Base64Url("verifier-value"),
    }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/userinfo.email",
    ]);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("random-state");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(await sha256Base64Url("verifier-value"));
  });

  it("prefers a valid exact company email header over contact emails", () => {
    expect(emailFromCompanyData(
      JSON.stringify({ original: { "Email": "  jobs@acme.example ", "Company Email": " talent@acme.example " } }),
      ["recruiter@acme.example"],
    )).toBe("jobs@acme.example");
    expect(emailFromCompanyData(
      JSON.stringify({ original: { Notes: "email talent@acme.example" } }),
      ["invalid", "recruiter@acme.example"],
    )).toBe("recruiter@acme.example");
    expect(emailFromCompanyData("not-json", ["not an address"])).toBeNull();
  });

  it("builds an isolated, safe base64url MIME message", () => {
    const raw = buildRawMessage("recruiter@acme.example", "Hello, Māori team", "Kia ora\nThanks");
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    const mime = Buffer.from(raw, "base64url").toString("utf8");
    expect(mime).toContain("To: recruiter@acme.example\r\n");
    expect(mime).toContain("Subject: =?UTF-8?B?");
    expect(mime).toContain("Content-Transfer-Encoding: base64");
    expect(mime).not.toContain("\nThanks");
  });
});
