import { describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({ getDb: vi.fn() }));

import { parseOfficialPublicPage } from "../../lib/v4/collection";
import { fetchOfficialPublicSource } from "../../lib/v4/job-radar";

const checkedAt = "2026-10-15T12:00:00.000Z";

describe("official public source collection", () => {
  it("collects directly published recruiting contacts and dated structured hiring signals", () => {
    const html = `
      <script type="application/ld+json">{
        "@graph": [
          {"@type":"Person","name":"Aine Murphy","jobTitle":"Talent Acquisition Partner","email":"aine@acme.test"},
          {"@type":"NewsArticle","headline":"Acme raises €4m to expand its Dublin team","datePublished":"2026-10-10","url":"https://acme.test/news/funding"}
        ]
      }</script>
      <a href="mailto:careers@acme.test">Careers</a>
      <a href="mailto:someone@other.test">External contact</a>`;
    const collected = parseOfficialPublicPage({ companyId: "company-a", companyDomain: "acme.test", sourceUrl: "https://acme.test/team", html, checkedAt });

    expect(collected.contacts).toHaveLength(2);
    expect(collected.contacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Aine Murphy", role: "Talent Acquisition Partner", email: "aine@acme.test", sourceUrl: "https://acme.test/team" }),
      expect.objectContaining({ email: "careers@acme.test", emailStatus: "published", inferredEmail: false }),
    ]));
    expect(collected.signals).toMatchObject([{ type: "funding", summary: "Acme raises €4m to expand its Dublin team", eventDate: "2026-10-10", sourceUrl: "https://acme.test/team", discoveredAt: checkedAt, sourceReliability: "primary", dublinConnection: true }]);
    expect(collected.emailStatus).toBe("published");
    expect(collected.signalStatus).toBe("collected");
    expect(collected.contacts.some((contact) => contact.email?.endsWith("@other.test"))).toBe(false);
  });

  it("returns explicit unavailable states and never invents an email from a person's name", () => {
    const collected = parseOfficialPublicPage({
      companyId: "company-a",
      companyDomain: "acme.test",
      sourceUrl: "https://acme.test/team",
      html: `<script type="application/ld+json">{"@type":"Person","name":"Aine Murphy","jobTitle":"Recruiter"}</script>`,
      checkedAt,
    });
    expect(collected.contacts).toMatchObject([{ name: "Aine Murphy", role: "Recruiter", email: null, emailStatus: "email-unavailable", inferredEmail: false }]);
    expect(collected.emailStatus).toBe("unavailable");
    expect(collected.signalStatus).toBe("unavailable");
    expect(collected.signals).toEqual([]);
  });

  it("fetches only safe public pages, caps response bytes, and keeps redirects within the approved hosts", async () => {
    let calls = 0;
    const crossHost = await fetchOfficialPublicSource("https://acme.test/team", async () => {
      calls += 1;
      return new Response(null, { status: 302, headers: { location: "https://other.test/team" } });
    }, { allowedHosts: ["acme.test"] });
    expect(crossHost.status).toBe("source-blocked");
    expect(calls).toBe(1);

    const tooLarge = await fetchOfficialPublicSource("https://acme.test/team", async () => new Response("x".repeat(300_000), { headers: { "content-type": "text/html" } }), { maxBytes: 256_000 });
    expect(tooLarge.status).toBe("error");
    expect(tooLarge.error).toMatch(/size limit/i);
    expect(await fetchOfficialPublicSource("http://127.0.0.1/admin", async () => { throw new Error("must not fetch"); })).toMatchObject({ status: "unsupported" });
  });
});
