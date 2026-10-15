import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const { mockUsePathname } = vi.hoisted(() => ({
  mockUsePathname: vi.fn(() => "/"),
}));

vi.mock("next/navigation", () => ({ usePathname: mockUsePathname }));

import { WorkspaceFrame } from "../../components/workbench/workspace-frame";

const user = {
  userId: "user-1",
  displayName: "Researcher",
  email: "researcher@example.com",
  fullName: "Researcher",
};

const destinations = [
  ["Companies", "/"],
  ["Email", "/email"],
  ["Research history", "/history"],
  ["AI assistant", "/ai"],
  ["Imports", "/imports"],
  ["Settings", "/settings"],
  ["Ecommerce", "/sectors/ecommerce"],
  ["Startups", "/sectors/startups"],
  ["Tech Permits", "/sectors/tech-permits"],
  ["Fintech", "/sectors/fintech"],
  ["Permit reality", "/permit"],
] as const;

describe("shared workspace navigation", () => {
  it("keeps every internal destination available and grouped on each workspace route", () => {
    for (const [path, activeLabel, activeHref] of [
      ["/", "Companies", "/"],
      ["/email", "Email", "/email"],
      ["/history", "Research history", "/history"],
      ["/ai", "AI assistant", "/ai"],
      ["/imports", "Imports", "/imports"],
      ["/settings", "Settings", "/settings"],
      ["/company/co-1", "Companies", "/"],
      ["/sectors/ecommerce", "Ecommerce", "/sectors/ecommerce"],
      ["/sectors/startups", "Startups", "/sectors/startups"],
      ["/sectors/tech-permits", "Tech Permits", "/sectors/tech-permits"],
      ["/sectors/fintech", "Fintech", "/sectors/fintech"],
      ["/permit", "Permit reality", "/permit"],
    ] as const) {
      mockUsePathname.mockReturnValue(path);
      const html = renderToStaticMarkup(
        <WorkspaceFrame user={user}>
          <section>Page content</section>
        </WorkspaceFrame>,
      );

      expect(html).toContain('aria-label="Workspace"');
      expect(html).toContain('aria-label="Manage"');
      expect(html).toContain('aria-label="Intelligence"');
      expect(html).toContain(activeLabel);
      const activeLink = html.match(
        /<a\b(?=[^>]*aria-current="page")[^>]*>/,
      )?.[0];
      expect(activeLink).toContain(`href="${activeHref}"`);

      const workspaceGroup = html.match(
        /<nav\b(?=[^>]*aria-label="Workspace")[^>]*>([\s\S]*?)<\/nav>/,
      )?.[1];
      const manageGroup = html.match(
        /<nav\b(?=[^>]*aria-label="Manage")[^>]*>([\s\S]*?)<\/nav>/,
      )?.[1];
      expect(workspaceGroup).toContain('href="/"');
      expect(workspaceGroup).toContain('href="/email"');
      expect(workspaceGroup).toContain('href="/ai"');
      expect(manageGroup).toContain('href="/imports"');
      expect(manageGroup).toContain('href="/history"');
      expect(manageGroup).toContain('href="/settings"');
      const intelligenceGroup = html.match(
        /<nav\b(?=[^>]*aria-label="Intelligence")[^>]*>([\s\S]*?)<\/nav>/,
      )?.[1];
      expect(intelligenceGroup).toContain('href="/permit"');

      for (const [, href] of destinations) {
        const link = html.match(
          new RegExp(`<a\\b[^>]*href="${href.replaceAll("/", "\\/")}"[^>]*>`),
        )?.[0];
        expect(link, `${path} should include ${href}`).toBeTruthy();
        expect(link).not.toContain('target="_top"');
      }
    }
  });

  it("keeps account and external sign-out controls in the top bar", () => {
    mockUsePathname.mockReturnValue("/imports");
    const html = renderToStaticMarkup(
      <WorkspaceFrame user={user}>
        <section>Page content</section>
      </WorkspaceFrame>,
    );

    expect(html).toContain('class="workspace-frame__top-account"');
    expect(html).toContain("researcher@example.com");
    expect(html).toContain(
      'href="/signout-with-chatgpt?return_to=%2F" target="_top"',
    );
    expect(html.indexOf("/signout-with-chatgpt")).toBeLessThan(
      html.indexOf("<aside"),
    );
  });

  it("uses a main landmark for section pages without nesting the company profile main", () => {
    mockUsePathname.mockReturnValue("/imports");
    const sectionPage = renderToStaticMarkup(
      <WorkspaceFrame user={user}>
        <section>Imports content</section>
      </WorkspaceFrame>,
    );
    expect(sectionPage.match(/<main\b/g)).toHaveLength(1);

    mockUsePathname.mockReturnValue("/company/co-1");
    const profilePage = renderToStaticMarkup(
      <WorkspaceFrame user={user}>
        <main>Company profile</main>
      </WorkspaceFrame>,
    );
    expect(profilePage.match(/<main\b/g)).toHaveLength(1);
  });
});
