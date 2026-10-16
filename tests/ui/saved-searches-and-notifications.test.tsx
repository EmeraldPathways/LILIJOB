import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SavedSearchesWorkspace } from "../../components/v4/saved-searches-workspace";
import { NotificationsWorkspace } from "../../components/v4/notifications-workspace";
import { WorkspaceFrame } from "../../components/workbench/workspace-frame";

describe("saved searches and in-app digest screens", () => {
  it("offers a manual local search flow and a route to digest settings", () => {
    const html = renderToStaticMarkup(<SavedSearchesWorkspace />);
    expect(html).toContain("Saved searches");
    expect(html).toContain("Create a saved search");
    expect(html).toContain("Companies and jobs");
    expect(html).toContain("do not refresh sources or call paid services");
    expect(html).toContain('href="/notifications"');
  });

  it("adds saved searches to primary navigation", () => {
    const html = renderToStaticMarkup(<WorkspaceFrame user={{ userId: "owner-a", email: "owner@example.test", displayName: "Owner", fullName: "Owner" }}><p>Page</p></WorkspaceFrame>);
    expect(html).toContain('href="/saved-searches"');
    expect(html).toContain("Saved searches");
  });

  it("explains consent, local time settings and the in-app-only digest", () => {
    const html = renderToStaticMarkup(<NotificationsWorkspace />);
    expect(html).toContain("Enable the in-app digest");
    expect(html).toContain("I consent to this internal digest");
    expect(html).toContain("Quiet hours use local wall-clock time");
    expect(html).toContain("No background schedule sends email or push");
    expect(html).toContain('type="time"');
  });
});
