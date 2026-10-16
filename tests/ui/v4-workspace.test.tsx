import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as workspace from "../../components/v4/v4-workspace";
import * as applications from "../../components/v4/applications-panel";

describe("V4 workspace workflows", () => {
  it("resolves the current profile by stable id after a profiles refresh", () => {
    const refreshed = { id: "profile-1", name: "Product", targetFamiliesJson: "[]", constraintsJson: "{}", weightConfigJson: "{}", approvedVersion: 1 };
    const resolve = (workspace as unknown as { resolveSelectedProfile?: (profiles: typeof refreshed[], selectedId: string | null) => typeof refreshed | null }).resolveSelectedProfile;

    expect(typeof resolve).toBe("function");
    expect(resolve?.([refreshed], "profile-1")).toBe(refreshed);
    expect(resolve?.([refreshed], "removed-profile")).toBe(refreshed);
    expect(resolve?.([], null)).toBeNull();
  });

  it("encodes a Dublin-local interview time with the correct daylight-saving offset", () => {
    const convert = (workspace as unknown as { toDublinTimestamp?: (local: string) => string | null }).toDublinTimestamp;

    expect(convert?.("2026-06-15T09:30")).toBe("2026-06-15T09:30:00+01:00");
    expect(convert?.("2026-01-15T09:30")).toBe("2026-01-15T09:30:00+00:00");
    expect(convert?.("2026-03-29T01:30")).toBeNull();
    expect(convert?.("2026-10-25T01:30")).toBeNull();
  });

  it("lets users set an interview date and time in Europe/Dublin", () => {
    const html = renderToStaticMarkup(<workspace.V4Workspace kind="interviews" />);

    expect(html).toContain('type="datetime-local"');
    expect(html).toContain("Europe/Dublin");
  });

  it("provides dashboard links for first-use setup and the next actions", () => {
    const html = renderToStaticMarkup(<workspace.V4Workspace kind="dashboard" />);

    expect(html).toContain('href="/candidate"');
    expect(html).toContain('href="/job-radar"');
    expect(html).toContain('href="/interviews"');
  });

  it("shows opt-in schedule settings alongside Job Radar", () => {
    const html = renderToStaticMarkup(<workspace.V4Workspace kind="job-radar" />);

    expect(html).toContain("Refresh schedule");
    expect(html).toContain("Daily");
    expect(html).toContain("Weekly");
  });

  it("exposes contact do-not-contact and correction review controls", () => {
    const Controls = (workspace as unknown as { ContactReviewControls?: (props: { doNotContact: boolean; correctionFlag: boolean; onDoNotContactChange: () => void; onCorrectionFlagChange: () => void }) => React.ReactNode }).ContactReviewControls;

    expect(typeof Controls).toBe("function");
    const html = renderToStaticMarkup(<>{Controls?.({ doNotContact: false, correctionFlag: false, onDoNotContactChange: () => undefined, onCorrectionFlagChange: () => undefined })}</>);

    expect(html).toContain("Mark do not contact");
    expect(html).toContain("Flag details for correction");
  });

  it("exposes signal correction and suppression controls", () => {
    const Actions = (workspace as unknown as { SignalReviewActions?: (props: { suppressed: boolean; onCorrect: () => void; onToggleSuppressed: () => void }) => React.ReactNode }).SignalReviewActions;

    expect(typeof Actions).toBe("function");
    const html = renderToStaticMarkup(<>{Actions?.({ suppressed: false, onCorrect: () => undefined, onToggleSuppressed: () => undefined })}</>);

    expect(html).toContain("Correct record");
    expect(html).toContain("Suppress signal");
  });

  it("shows permit source availability with a rule-review caveat", () => {
    const Panel = (workspace as unknown as { PermitSourceStatusPanel?: (props: { checks: Record<string, unknown>[]; busy: boolean; interpretation: string; error: string | null; onRefresh: () => void }) => React.ReactNode }).PermitSourceStatusPanel;

    expect(typeof Panel).toBe("function");
    const html = renderToStaticMarkup(<>{Panel?.({ checks: [{ sourceUrl: "https://enterprise.gov.ie/permit", checkedAt: "2026-10-15T12:00:00.000Z", status: "retrieved", title: "Permit rules", contentHash: "abcdef012345", requiresRuleReview: true }], busy: false, interpretation: "Availability checks do not approve permit rules.", error: null, onRefresh: () => undefined })}</>);

    expect(html).toContain("Check official sources");
    expect(html).toContain("Retrieved");
    expect(html).toContain("Availability checks do not approve permit rules.");
  });

  it("offers printable, Word, and PDF exports for a saved application pack", () => {
    const ExportLinks = (applications as unknown as { ApplicationPackExportLinks?: (props: { packId: string }) => React.ReactNode }).ApplicationPackExportLinks;

    expect(typeof ExportLinks).toBe("function");
    const html = renderToStaticMarkup(<>{ExportLinks?.({ packId: "pack-7" })}</>);

    expect(html).toContain("/api/v4/packs/pack-7/export?format=html");
    expect(html).toContain("/api/v4/packs/pack-7/export?format=docx");
    expect(html).toContain("/api/v4/packs/pack-7/export?format=pdf");
  });

  it("offers printable, Word, and PDF exports for a prepared interview pack", () => {
    const ExportLinks = (workspace as unknown as { InterviewPackExportLinks?: (props: { interviewId: string }) => React.ReactNode }).InterviewPackExportLinks;

    expect(typeof ExportLinks).toBe("function");
    const html = renderToStaticMarkup(<>{ExportLinks?.({ interviewId: "interview/7" })}</>);

    expect(html).toContain("/api/v4/interviews/interview%2F7/export?format=html");
    expect(html).toContain("/api/v4/interviews/interview%2F7/export?format=docx");
    expect(html).toContain("/api/v4/interviews/interview%2F7/export?format=pdf");
  });
});
