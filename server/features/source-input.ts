import { DesignProvider } from "@shared/features/types";
import { z } from "zod";

export class SourceLinkError extends Error {}

export const LiveSourceInput = z.object({
  designProvider: z
    .enum(DesignProvider)
    .optional()
    .describe(
      "Design source: stitch, figma, or none. Omit to preserve includeFigma behaviour.",
    ),
  stitchProjectId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,100}$/)
    .optional()
    .describe("Selected existing Stitch project ID."),
  stitchScreenId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,100}$/)
    .optional()
    .describe("Selected existing Stitch screen ID."),
  includeFigma: z
    .boolean()
    .default(true)
    .describe(
      "Include a Figma read; defaults to true. False explicitly creates a Jira/Confluence-only review.",
    ),
  jiraUrl: z.string().url().max(1000).describe("Jira Cloud story URL."),
  confluenceUrl: z
    .string()
    .url()
    .max(1000)
    .describe("Confluence page or tiny-link URL on the same site."),
  figmaUrl: z
    .string()
    .url()
    .max(1000)
    .describe("Figma Design URL including node-id; required only for Figma.")
    .optional(),
});

export function getDesignProvider(input: z.infer<typeof LiveSourceInput>) {
  return (
    input.designProvider ??
    (input.includeFigma ? DesignProvider.FIGMA : DesignProvider.NONE)
  );
}

// Validate provider-specific locators before any authenticated network request.
export function parseSourceLinks(input: z.infer<typeof LiveSourceInput>) {
  const jira = new URL(input.jiraUrl);
  const confluence = new URL(input.confluenceUrl);
  const designProvider = getDesignProvider(input);
  if (designProvider === DesignProvider.FIGMA && !input.figmaUrl)
    throw new SourceLinkError("Enter a Figma Design URL with a node selection.");
  const figma =
    designProvider === DesignProvider.FIGMA
      ? new URL(input.figmaUrl ?? "")
      : undefined;
  if (
    designProvider === DesignProvider.STITCH &&
    (!input.stitchProjectId || !input.stitchScreenId)
  )
    throw new SourceLinkError("Select a Stitch project and screen.");
  for (const url of [jira, confluence, ...(figma ? [figma] : [])]) {
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      throw new SourceLinkError(
        "Use HTTPS source links without credentials or custom ports.",
      );
  }
  if (
    !/^[a-z0-9-]+\.atlassian\.net$/.test(jira.hostname) ||
    confluence.origin !== jira.origin
  )
    throw new SourceLinkError(
      "Jira and Confluence must belong to the same Atlassian Cloud site.",
    );
  const key = /^\/browse\/([A-Z][A-Z0-9_]*-\d+)\/?$/.exec(jira.pathname)?.[1];
  const pageId = /\/pages\/(?:edit-v2\/)?(\d+)(?:\/|$)/.exec(
    confluence.pathname,
  )?.[1];
  const tiny = /^\/wiki\/x\/([A-Za-z0-9_-]+)\/?$/.exec(
    confluence.pathname,
  )?.[1];
  if (!key)
    throw new SourceLinkError(
      "Enter a Jira issue URL in the Jira story field, for example https://your-site.atlassian.net/browse/PROJ-123. A Confluence page URL cannot be used there.",
    );
  if (!pageId && !tiny)
    throw new SourceLinkError("Enter a Confluence page or tiny link in the Confluence page field.");
  // Confluence tiny links are URL-safe base64 of a little-endian content ID.
  const bytes = tiny ? Buffer.from(tiny, "base64url") : undefined;
  if (bytes && (bytes.length < 1 || bytes.length > 6))
    throw new SourceLinkError("Enter a valid Confluence tiny link.");
  const id = pageId ?? String(bytes!.readUIntLE(0, bytes!.length));
  const fileKey = /^\/design\/([A-Za-z0-9]+)\//.exec(
    figma?.pathname ?? "",
  )?.[1];
  const nodeId = figma?.searchParams.get("node-id")?.replace("-", ":");
  if (
    figma &&
    (!["www.figma.com", "figma.com"].includes(figma.hostname) ||
      !fileKey ||
      !nodeId ||
      !/^\d+:\d+$/.test(nodeId))
  )
    throw new SourceLinkError("Use a Figma Design link with a numeric node-id.");
  return {
    site: jira.origin,
    key,
    pageId: id,
    fileKey: fileKey ?? "",
    nodeId: nodeId ?? "",
    jiraUrl: `${jira.origin}/browse/${key}`,
    confluenceUrl: `${jira.origin}/wiki/pages/viewpage.action?pageId=${id}`,
    figmaUrl: figma
      ? `https://www.figma.com/design/${fileKey}/order?node-id=${nodeId!.replace(":", "-")}`
      : "",
  };
}

/** Extract textual evidence only; rendered macros and image pixels aren't covered. */
export function documentText(value: unknown, depth = 0): string {
  if (depth > 60)
    throw new Error("Document nesting exceeds the supported limit.");
  if (typeof value === "string") return value;
  if (Array.isArray(value))
    return value.map((v) => documentText(v, depth + 1)).join("\n");
  if (!value || typeof value !== "object") return "";
  const node = value as Record<string, unknown>;
  if (typeof node.text === "string") return node.text;
  return documentText(node.content, depth + 1);
}

export function figmaText(value: unknown): string {
  const lines: string[] = [];
  let visited = 0;
  function walk(value: unknown, depth: number) {
    if (++visited > 20000 || depth > 60)
      throw new Error("Figma selection is too large. Select a smaller frame.");
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (node.visible === false) return;
    if (typeof node.characters === "string") lines.push(node.characters);
    else if (typeof node.name === "string") lines.push(`[${node.name}]`);
    if (Array.isArray(node.children))
      node.children.forEach((child) => walk(child, depth + 1));
  }
  walk(value, 0);
  return lines.join("\n");
}
