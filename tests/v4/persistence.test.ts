import { describe, expect, it } from "vitest";
import { v4MigrationStatements, V4_SCHEMA_VERSION } from "../../lib/v4/migration";
import { v4Tables } from "../../db/schema-v4";

describe("Version 4 persistence contract", () => {
  it("defines every interview-engine entity with an owner boundary", () => {
    const expected = [
      "candidateProfiles", "candidateDocuments", "experienceEvidence", "jobSnapshots",
      "jobDiscoveryRuns", "jobMatches", "companySignals", "recruitmentContacts",
      "applications", "applicationEvents", "outreachDrafts", "outreachEvents", "applicationPacks", "sectorPitches",
      "interviews", "interviewPacks", "dailyActionItems", "jobSearchMetricsDaily",
      "notificationPreferences", "userActivityAudit", "agentRuns", "agentSteps",
      "settingsVersions", "permitRules", "permitEvaluations",
    ];
    for (const name of expected) {
      expect(v4Tables[name as keyof typeof v4Tables]).toBeDefined();
    }
    expect(V4_SCHEMA_VERSION).toBe(1);
    expect(v4MigrationStatements.length).toBeGreaterThan(53);
  });

  it("migration is additive and repeat-safe", () => {
    expect(v4MigrationStatements.every((statement) => /CREATE TABLE IF NOT EXISTS|CREATE UNIQUE INDEX IF NOT EXISTS|CREATE INDEX IF NOT EXISTS/.test(statement))).toBe(true);
    expect(v4MigrationStatements.some((statement) => /DROP TABLE|DELETE FROM companies|DELETE FROM jobs/i.test(statement))).toBe(false);
  });
});
