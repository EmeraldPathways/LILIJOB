import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));

import { extractCitedUrls } from "../../lib/research/openai-search-provider";

describe("OpenAI web-search result parsing", () => {
  it("reads URL citations from Responses annotations", () => {
    expect(extractCitedUrls({
      output_text: "North Star is hiring.",
      output: [{ content: [{ type: "output_text", text: "North Star is hiring.", annotations: [{ type: "url_citation", url: "https://northstar.ie/careers" }] }] }],
    })).toEqual(["https://northstar.ie/careers"]);
  });
});
