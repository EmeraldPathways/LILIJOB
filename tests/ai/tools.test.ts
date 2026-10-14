import { describe, expect, it, vi } from "vitest";
import { createAgentTools, type AgentDependencies } from "../../lib/ai/tools";

describe("AI tool boundary", () => {
  it("passes the authenticated owner through every saved-data operation", async () => {
    const searchCompanies = vi.fn().mockResolvedValue([{ id: "co-1", name: "Acme" }]);
    const getCompany = vi.fn().mockResolvedValue({ id: "co-1", name: "Acme" });
    const deps: AgentDependencies = { searchCompanies, getCompany };
    const tools = createAgentTools("owner-1", deps);

    await tools.searchSaved({ query: "Acme" });
    await tools.getCompany("co-1");

    expect(searchCompanies).toHaveBeenCalledWith("owner-1", { query: "Acme" });
    expect(getCompany).toHaveBeenCalledWith("owner-1", "co-1");
  });

  it("keeps refresh and discovery actions non-destructive", async () => {
    const refresh = vi.fn().mockResolvedValue({ runId: "run-1" });
    const discover = vi.fn().mockResolvedValue({ runId: "run-2" });
    const tools = createAgentTools("owner-1", { refresh, discover });

    await expect(tools.refresh({ category: "fintech" })).resolves.toEqual({ runId: "run-1" });
    await expect(tools.discover("startups")).resolves.toEqual({ runId: "run-2" });
    expect(refresh).toHaveBeenCalledWith("owner-1", { category: "fintech" });
    expect(discover).toHaveBeenCalledWith("owner-1", "startups");
  });
});
