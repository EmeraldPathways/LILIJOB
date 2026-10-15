import { describe, expect, it } from "vitest";
import { discoverOfficialCareerPage, parseCareerFeed, parseCareerPage, isSafePublicUrl } from "../../lib/v4/job-radar";

const fixture = `
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"JobPosting","title":"Senior Product Manager","url":"https://acme.test/jobs/123","description":"Own product strategy and experimentation.","datePosted":"2026-10-14","jobLocation":{"address":{"addressLocality":"Dublin"}},"employmentType":"FULL_TIME","identifier":{"value":"123"}}
</script>`;

describe("Version 4 job radar", () => {
  it("extracts verified JSON-LD job fields and preserves posted versus checked dates", () => {
    const checkedAt = "2026-10-15T12:00:00.000Z";
    const result = parseCareerPage(fixture, "https://acme.test/careers", checkedAt);
    expect(result.status).toBe("supported");
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]).toMatchObject({ title: "Senior Product Manager", externalId: "123", location: "Dublin", postedAt: "2026-10-14", firstSeenAt: checkedAt, lastConfirmedAt: checkedAt, verified: true });
  });

  it("keeps ordinary career links as discovered and unverified", () => {
    const result = parseCareerPage('<a href="/careers/product-manager">Product Manager</a>', "https://acme.test", "2026-10-15T12:00:00.000Z");
    expect(result.status).toBe("partial");
    expect(result.jobs[0]).toMatchObject({ title: "Product Manager", verified: false, postedAt: null });
  });

  it("supports permitted Greenhouse and Lever public feed shapes", async () => {
    const greenhouse = parseCareerFeed({ jobs: [{ id: 42, title: "Product Manager", absolute_url: "https://acme.greenhouse.io/jobs/42", content: "<p>Own analytics.</p>", location: { name: "Dublin" } }] }, "https://boards-api.greenhouse.io/v1/boards/acme/jobs", "2026-10-15T12:00:00.000Z");
    expect(greenhouse).toMatchObject({ status: "supported", jobs: [{ externalId: "42", title: "Product Manager", location: "Dublin", verified: true }] });
    const lever = parseCareerFeed([{ id: "lever-1", text: "Growth PM", hostedUrl: "https://jobs.lever.co/acme/lever-1", description: "<p>Experimentation</p>", categories: { location: "Remote Ireland", commitment: "Full-time" } }], "https://api.lever.co/v0/postings/acme", "2026-10-15T12:00:00.000Z");
    expect(lever).toMatchObject({ status: "supported", jobs: [{ externalId: "lever-1", workModel: "remote", employmentType: "Full-time" }] });
    const result = await discoverOfficialCareerPage("https://api.lever.co/v0/postings/acme", async () => new Response(JSON.stringify([{ id: "lever-1", text: "Growth PM", hostedUrl: "https://jobs.lever.co/acme/lever-1", categories: { location: "Dublin" } }]), { status: 200, headers: { "content-type": "application/json" } }));
    expect(result.status).toBe("supported");
  });

  it("reports blocked and empty sources without treating them as closed jobs", async () => {
    const blocked = await discoverOfficialCareerPage("https://acme.test/careers", async () => new Response("blocked", { status: 403 }));
    expect(blocked.status).toBe("source-blocked");
    expect(blocked.jobs).toEqual([]);
    const empty = await discoverOfficialCareerPage("https://acme.test/careers", async () => new Response("<html>No roles today</html>", { status: 200 }));
    expect(empty.status).toBe("empty");
  });

  it("follows safe public redirects manually and parses the final official page", async () => {
    const urls: string[] = [];
    const result = await discoverOfficialCareerPage("https://acme.test/careers", async (input, init) => {
      expect(init?.redirect).toBe("manual");
      urls.push(input);
      if (urls.length === 1) return new Response(null, { status: 302, headers: { location: "/open-roles" } });
      return new Response(fixture.replaceAll("https://acme.test/jobs/123", "https://acme.test/jobs/final"), { status: 200 });
    });
    expect(urls).toEqual(["https://acme.test/careers", "https://acme.test/open-roles"]);
    expect(result.status).toBe("supported");
    expect(result.sourceUrl).toBe("https://acme.test/open-roles");
  });

  it("blocks an unsafe redirect at any hop and caps redirect loops", async () => {
    const unsafe = await discoverOfficialCareerPage("https://acme.test/careers", async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } }));
    expect(unsafe.status).toBe("source-blocked");
    let calls = 0;
    const loop = await discoverOfficialCareerPage("https://acme.test/careers", async () => {
      calls += 1;
      return new Response(null, { status: 302, headers: { location: "/careers" } });
    });
    expect(calls).toBeLessThanOrEqual(6);
    expect(loop.status).toBe("stale");
  });

  it("distinguishes inaccessible, rate-limited, failed and empty source statuses", async () => {
    const status = async (code: number) => (await discoverOfficialCareerPage("https://acme.test/careers", async () => new Response("", { status: code }))).status;
    expect(await status(403)).toBe("source-blocked");
    expect(await status(429)).toBe("stale");
    expect(await status(503)).toBe("error");
    expect((await discoverOfficialCareerPage("https://acme.test/careers", async () => new Response("<main>No open roles</main>", { status: 200 }))).status).toBe("empty");
  });

  it("rejects local and private URLs before a fetch is attempted", () => {
    expect(isSafePublicUrl("https://localhost/careers")).toBe(false);
    expect(isSafePublicUrl("http://192.168.1.5/jobs")).toBe(false);
    expect(isSafePublicUrl("https://acme.test/careers")).toBe(true);
  });

  it("blocks private IPv6 and does not follow redirects automatically", async () => {
    expect(isSafePublicUrl("http://[::1]/careers")).toBe(false);
    expect(isSafePublicUrl("http://[fe80::1]/careers")).toBe(false);
    const result = await discoverOfficialCareerPage("https://acme.test/careers", async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } }));
    expect(result.status).toBe("source-blocked");
    expect(result.error).toMatch(/safe public/i);
  });
});
