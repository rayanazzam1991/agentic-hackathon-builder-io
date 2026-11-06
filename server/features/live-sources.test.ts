import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  tools: vi.fn(),
  call: vi.fn(),
  request: vi.fn(),
}));
vi.mock("@agent-native/core/mcp-client", () => ({
  listVisibleMcpTools: mock.tools,
  callMcpTool: mock.call,
}));
vi.mock("@agent-native/core/provider-api", () => ({
  createProviderApiRuntime: () => ({ executeRequest: mock.request }),
}));
import { readLiveSources, unwrapMcp } from "./live-sources";
const input = {
  includeFigma: true,
  jiraUrl: "https://demo.atlassian.net/browse/DEMO-1",
  confluenceUrl: "https://demo.atlassian.net/wiki/x/AgAF",
  figmaUrl: "https://figma.com/design/ExampleKey/order?node-id=0-1",
};
const mcp = (data: unknown) => ({
  content: [{ type: "text", text: JSON.stringify(data) }],
  structuredContent: { unused: "not the human-readable response" },
});
beforeEach(() => {
  vi.resetAllMocks();
  mock.tools.mockResolvedValue([
    { serverId: "personal", name: "getJiraIssue", inputSchema: {} },
    {
      serverId: "personal",
      name: "getConfluencePage",
      inputSchema: { properties: { pageId: {}, contentFormat: {} } },
    },
  ]);
  mock.call.mockImplementation(async (_server, name) =>
    name === "getJiraIssue"
      ? mcp({
          key: "DEMO-1",
          fields: {
            summary: "Cancel order",
            description: "24 hours",
            updated: "2026-11-04",
          },
        })
      : mcp({
          id: "327682",
          title: "Specification",
          version: { number: 1 },
          body: "24 hours",
        }),
  );
  mock.request.mockResolvedValue({
    response: {
      ok: true,
      status: 200,
      truncated: false,
      json: {
        version: "v2",
        nodes: {
          "0:1": {
            document: { name: "Order", children: [{ characters: "48 hours" }] },
          },
        },
      },
    },
  });
});
describe("captured provider evidence", () => {
  it("uses app-scoped read tools and preserves independent provider text", async () => {
    const result = await readLiveSources(input, { caller: "frontend" });
    expect(result.sources.map((s) => s.kind)).toEqual([
      "jira",
      "confluence",
      "figma",
    ]);
    expect(result.sources[0]?.excerpt).toContain("24 hours");
    expect(result.sources[2]?.excerpt).toContain("48 hours");
    expect(result.sources.every((s) => s.url && s.capturedAt && s.scope)).toBe(
      true,
    );
    expect(mock.call).toHaveBeenCalledWith(
      "personal",
      "getConfluencePage",
      {
        cloudId: "https://demo.atlassian.net",
        pageId: "327682",
        contentFormat: "markdown",
      },
      expect.objectContaining({ providerId: "atlassian" }),
    );
    expect(mock.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/files/ExampleKey/nodes",
        query: { ids: "0:1" },
      }),
    );
  });
  it("never silently downgrades a requested Figma read when rate limited", async () => {
    mock.request.mockResolvedValue({
      response: { ok: false, status: 429, headers: { "retry-after": "60" } },
    });
    await expect(
      readLiveSources(input, { caller: "frontend" }),
    ).rejects.toThrow("Retry after 60 seconds");
  });
  it("excludes Figma only when explicitly selected and does not call it", async () => {
    const result = await readLiveSources(
      { ...input, includeFigma: false },
      { caller: "frontend" },
    );
    expect(result.sources.map((s) => s.kind)).toEqual(["jira", "confluence"]);
    expect(mock.request).not.toHaveBeenCalled();
  });
  it("rejects incomplete, truncated Figma responses", async () => {
    mock.request.mockResolvedValue({
      response: { ok: true, status: 200, truncated: true },
    });
    await expect(
      readLiveSources(input, { caller: "frontend" }),
    ).rejects.toThrow("Figma read failed");
  });
  it("rejects unsafe links before contacting any provider", async () => {
    await expect(
      readLiveSources(
        { ...input, jiraUrl: "https://127.0.0.1/browse/DEMO-1" },
        { caller: "frontend" },
      ),
    ).rejects.toThrow();
    expect(mock.tools).not.toHaveBeenCalled();
    expect(mock.request).not.toHaveBeenCalled();
  });
  it("does not select an arbitrary account when multiple connections match", async () => {
    mock.tools.mockResolvedValue([
      { serverId: "a", name: "getJiraIssue" },
      { serverId: "b", name: "getJiraIssue" },
    ]);
    await expect(
      readLiveSources(input, { caller: "frontend" }),
    ).rejects.toThrow("exactly one");
    expect(mock.call).not.toHaveBeenCalled();
  });
  it("rejects a provider error wrapped in a successful transport", () => {
    expect(() => unwrapMcp(mcp({ error: true, message: "denied" }))).toThrow();
  });
});
