import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  tools: vi.fn(),
  call: vi.fn(),
  config: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@agent-native/core/mcp-client", () => ({
  listVisibleMcpTools: mock.tools,
  callMcpTool: mock.call,
}));
vi.mock("@agent-native/core/server/agent-chat/mcp-glue", () => ({
  getMcpManagerForCurrentRequest: async () => ({
    getServerConfig: mock.config,
  }),
}));
vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: mock.fetch,
}));
import { unwrapProviderResult } from "./provider-result";
import {
  assertStitchAssetUrl,
  extractStitchText,
  listStitchDesigns,
  decodeStitchScreenshot,
  readStitchScreen,
  stitchReader,
} from "./stitch";
const name = "projects/123/screens/screen1";
// 1x1 transparent PNG.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const htmlAsset = "https://stitch.googleapis.com/asset";
const thumbAsset = "https://lh3.googleusercontent.com/thumb";
const envelope = (value: unknown) => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
});
beforeEach(() => {
  vi.resetAllMocks();
  mock.config.mockReturnValue({
    type: "http",
    url: "https://stitch.googleapis.com/mcp",
  });
  mock.tools.mockResolvedValue(
    ["list_projects", "list_screens", "get_screen"].map((name) => ({
      serverId: "connected",
      name,
    })),
  );
  mock.call.mockResolvedValue(
    envelope({
      name,
      title: "Eligible",
      htmlCode: { downloadUrl: htmlAsset },
      thumbnailScreenshot: { downloadUrl: thumbAsset },
    }),
  );
  mock.fetch.mockImplementation(async (url: string) =>
    url === thumbAsset
      ? new Response(png)
      : new Response(
          "<html><body><h1>Order</h1><p>48 hours</p><script>sendSecret()</script></body></html>",
        ),
  );
});
describe("Stitch selected-screen reads", () => {
  it("decodes Google's JSON download before removing scripts", () => {
    const payload = JSON.stringify({
      dataString:
        "<!DOCTYPE html><html><body><p>48 hours</p><script>doNotExecute()</script></body></html>",
    });
    const result = extractStitchText(
      payload,
      "https://stitch.withgoogle.com/projects/123",
    );
    expect(result).toContain("48 hours");
    expect(result).not.toContain("doNotExecute");
    expect(result).not.toContain("dataString");
  });
  it("rejects successful HTTP error JSON instead of treating it as design evidence", () => {
    expect(() =>
      extractStitchText(
        '{"error":"denied"}',
        "https://stitch.withgoogle.com/projects/123",
      ),
    ).toThrow();
  });
  it("pins the server URL rather than trusting its name", async () => {
    mock.config.mockReturnValue({
      type: "http",
      url: "https://evil.example/mcp",
    });
    await expect(stitchReader()).rejects.toThrow();
    expect(mock.call).not.toHaveBeenCalled();
  });
  it("does not permit mutation tools", async () => {
    const reader = await stitchReader();
    await expect(reader.read("generate_screen_from_text", {})).rejects.toThrow(
      "does not allow writes",
    );
    expect(mock.call).not.toHaveBeenCalled();
  });
  it("downloads bounded inert HTML without forwarding connector credentials", async () => {
    const result = await readStitchScreen("123", "screen1", {
      caller: "frontend",
    });
    expect(result.kind).toBe("stitch");
    expect(result.excerpt).toContain("48 hours");
    expect(result.excerpt).not.toContain("sendSecret");
    expect(Buffer.from(result.screenshotImage!.bytes).equals(png)).toBe(true);
    expect(result.screenshotImage?.screenId).toBe("screen1");
    const options = mock.fetch.mock.calls[0]?.[1];
    expect(options).not.toHaveProperty("headers");
    expect(mock.fetch.mock.calls[0]?.[2]).toMatchObject({
      httpsOnly: true,
      followRedirects: false,
    });
  });
  it("sends only the scoped API key to the same Google API origin", async () => {
    mock.config.mockReturnValue({
      type: "http",
      url: "https://stitch.googleapis.com/mcp",
      headers: {
        "X-Goog-Api-Key": "test-key",
        Authorization: "do-not-forward",
      },
    });
    await readStitchScreen("123", "screen1", { caller: "frontend" });
    expect(mock.fetch.mock.calls[0]?.[1].headers).toEqual({
      "X-Goog-Api-Key": "test-key",
    });
    const policy = mock.fetch.mock.calls[0]?.[2];
    expect(() =>
      policy.assertUrlAllowed("https://lh3.googleusercontent.com/image"),
    ).toThrow("destination mismatch");
  });
  it("never forwards the key to a Google CDN asset", async () => {
    mock.config.mockReturnValue({
      type: "http",
      url: "https://stitch.googleapis.com/mcp",
      headers: { "X-Goog-Api-Key": "test-key" },
    });
    mock.call.mockResolvedValue(
      envelope({
        name,
        htmlCode: { downloadUrl: "https://lh3.googleusercontent.com/asset" },
        thumbnailScreenshot: { downloadUrl: thumbAsset },
      }),
    );
    await readStitchScreen("123", "screen1", { caller: "frontend" });
    expect(mock.fetch.mock.calls[0]?.[1]).not.toHaveProperty("headers");
    expect(mock.fetch.mock.calls[1]?.[1]).not.toHaveProperty("headers");
  });
  it("rejects mismatched screens before downloading", async () => {
    mock.call.mockResolvedValue(
      envelope({
        name: "projects/other/screens/screen1",
        htmlCode: { downloadUrl: "https://stitch.googleapis.com/asset" },
      }),
    );
    await expect(
      readStitchScreen("123", "screen1", { caller: "frontend" }),
    ).rejects.toThrow("different screen");
    expect(mock.fetch).not.toHaveBeenCalled();
  });
  it.each([
    "https://127.0.0.1/file",
    "https://stitch.googleapis.com.evil.example/file",
    "http://stitch.googleapis.com/file",
    "https://user:pass@stitch.googleapis.com/file",
    "https://stitch.googleapis.com:444/file",
  ])("rejects unsafe asset destinations %s", (url) =>
    expect(() => assertStitchAssetUrl(url)).toThrow(),
  );
  it("rejects oversized HTML without saving partial text", async () => {
    mock.fetch.mockImplementation(async (url: string) =>
      url === thumbAsset
        ? new Response(png)
        : new Response("x".repeat(1024 * 1024 + 1)),
    );
    await expect(
      readStitchScreen("123", "screen1", { caller: "frontend" }),
    ).rejects.toThrow("exceeds");
  });
  it("decodes Google's base64 screenshot envelope", () => {
    const envelope = JSON.stringify({
      imageMetadata: { mimeType: "image/png" },
      dataString: png.toString("base64"),
    });
    expect(Buffer.from(decodeStitchScreenshot(Buffer.from(envelope))).equals(png)).toBe(true);
    expect(Buffer.from(decodeStitchScreenshot(png)).equals(png)).toBe(true);
  });
  it("rejects a screen without a screenshot instead of saving text as success", async () => {
    mock.call.mockResolvedValue(
      envelope({ name, htmlCode: { downloadUrl: htmlAsset } }),
    );
    await expect(
      readStitchScreen("123", "screen1", { caller: "frontend" }),
    ).rejects.toThrow("no screenshot");
    expect(mock.fetch).not.toHaveBeenCalled();
  });
  it("projects only IDs and titles, never signed download links", async () => {
    mock.call.mockResolvedValue(
      envelope({
        projects: [
          {
            name: "projects/123",
            title: "Order",
            thumbnailScreenshot: { downloadUrl: "https://example.com/private" },
          },
        ],
      }),
    );
    expect(await listStitchDesigns(undefined)).toEqual([
      { id: "123", title: "Order" },
    ]);
  });
  it("decodes escaped JSON and rejects provider error envelopes", () => {
    const json = JSON.stringify({ projects: [] });
    expect(unwrapProviderResult(envelope(json))).toEqual({ projects: [] });
    expect(() => unwrapProviderResult(envelope({ error: true }))).toThrow();
  });
});
