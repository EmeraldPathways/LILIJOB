import { describe, expect, it } from "vitest";
import { classifyContact, isGenericInbox } from "../../lib/v4/contacts";

describe("Version 4 contact classification", () => {
  it("separates recruitment-specific and generic addresses", () => {
    expect(classifyContact({ email: "talent@acme.test", role: "Talent Acquisition Partner" }).type).toBe("recruitment-specific");
    expect(classifyContact({ email: "info@acme.test", role: "Recruiter" }).type).toBe("general-business-inbox");
    expect(classifyContact({ email: "sales@acme.test", role: "Sales" }).type).toBe("sales");
    expect(isGenericInbox("info@acme.test")).toBe(true);
  });

  it("keeps profile-only people email-unavailable and never creates an inferred address", () => {
    const result = classifyContact({ name: "A Recruiter", role: "Recruiter", linkedinUrl: "https://www.linkedin.com/in/a-recruiter" });
    expect(result.type).toBe("public-named-recruiter");
    expect(result.email).toBeNull();
    expect(result.emailStatus).toBe("email-unavailable");
    expect(result.inferredEmail).toBe(false);
  });

  it("classifies relevant hiring managers separately from reliability", () => {
    const result = classifyContact({ name: "Product Lead", role: "Head of Product", email: "product.lead@acme.test", sourceUrl: "https://acme.test/team" });
    expect(result.type).toBe("public-relevant-hiring-manager");
    expect(result.qualityScore).toBeGreaterThan(0);
    expect(result.sourceUrl).toBe("https://acme.test/team");
  });
});
