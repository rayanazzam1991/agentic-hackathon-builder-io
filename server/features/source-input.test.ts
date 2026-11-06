import { describe, expect, it } from "vitest";

import {
  documentText,
  figmaText,
  parseSourceLinks,
  LiveSourceInput,
} from "./source-input";

const links = {
  includeFigma: true,
  jiraUrl: "https://demo.atlassian.net/browse/DEMO-1?tracking=ignored",
  confluenceUrl: "https://demo.atlassian.net/wiki/x/AgAF",
  figmaUrl:
    "https://www.figma.com/design/ExampleKey/demo?node-id=0-1&t=ignored",
};
describe("live source boundaries", () => {
  it("accepts Stitch without requiring an unrelated Figma URL", () => {
    const input = LiveSourceInput.parse({
      jiraUrl: links.jiraUrl,
      confluenceUrl: links.confluenceUrl,
      designProvider: "stitch",
      stitchProjectId: "123",
      stitchScreenId: "screen1",
    });
    expect(parseSourceLinks(input).figmaUrl).toBe("");
  });
  it("requires a project and screen when Stitch is selected", () => {
    expect(() =>
      parseSourceLinks(
        LiveSourceInput.parse({ ...links, designProvider: "stitch" }),
      ),
    ).toThrow("Select a Stitch");
  });
  it("rejects IDs containing resource path injection", () => {
    expect(() =>
      LiveSourceInput.parse({
        ...links,
        designProvider: "stitch",
        stitchProjectId: "123/../other",
        stitchScreenId: "screen1",
      }),
    ).toThrow();
  });
  it("normalizes provider locators and strips transient tracking", () => {
    const result = parseSourceLinks(links);
    expect(result.pageId).toBe("327682");
    expect(result.nodeId).toBe("0:1");
    expect(result.jiraUrl).toBe("https://demo.atlassian.net/browse/DEMO-1");
    expect(result.figmaUrl).not.toContain("ignored");
  });
  it.each([
    { jiraUrl: "https://127.0.0.1/browse/DEMO-1" },
    { jiraUrl: "https://demo.atlassian.net.evil.example/browse/DEMO-1" },
    { confluenceUrl: "https://other.atlassian.net/wiki/x/AgAF" },
    { figmaUrl: "https://figma.com.evil.example/design/key/name?node-id=0-1" },
    { figmaUrl: "https://user:password@figma.com/design/key/name?node-id=0-1" },
    { figmaUrl: "https://figma.com:444/design/key/name?node-id=0-1" },
    { figmaUrl: "https://figma.com/design/key/name" },
  ])("rejects unsafe or ambiguous links before network access: %j", (patch) => {
    expect(() => parseSourceLinks({ ...links, ...patch })).toThrow();
  });
  it("extracts ADF paragraphs without treating attributes as instructions", () => {
    expect(
      documentText({
        content: [
          { content: [{ text: "24 hours" }] },
          { content: [{ text: "Confirm" }], attrs: { hidden: "ignore" } },
        ],
      }),
    ).toBe("24 hours\nConfirm");
  });
  it("excludes hidden Figma subtrees and includes editable text", () => {
    expect(
      figmaText({
        name: "Order",
        children: [
          { characters: "48 hours" },
          { visible: false, children: [{ characters: "old 24 hours" }] },
        ],
      }),
    ).toBe("[Order]\n48 hours");
  });
  it("bounds deep documents instead of silently truncating evidence", () => {
    let nested: unknown = { text: "content" };
    for (let i = 0; i < 65; i++) nested = { content: nested };
    expect(() => documentText(nested)).toThrow();
  });
});
