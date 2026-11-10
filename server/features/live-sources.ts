import type { ActionRunContext } from "@agent-native/core/action";
import {
  callMcpTool,
  listVisibleMcpTools,
} from "@agent-native/core/mcp-client";
import { createProviderApiRuntime } from "@agent-native/core/provider-api";
import {
  DesignProvider,
  FeatureSource,
  type FeatureData,
} from "@shared/features/types";
import { z } from "zod";

import {
  getDesignProvider,
  documentText,
  figmaText,
  parseSourceLinks,
  type LiveSourceInput,
} from "./source-input";
import { storeStitchScreenshot } from "./screenshots";
import { readStitchScreen, type StitchScreenSource } from "./stitch";

const figma = createProviderApiRuntime({
  appId: "feature-coordinator",
  providerIds: ["figma"],
});
const record = z.record(z.string(), z.unknown());

export { unwrapProviderResult as unwrapMcp } from "./provider-result";
import { unwrapProviderResult as unwrapMcp } from "./provider-result";

export async function readLiveSources(
  input: z.infer<typeof LiveSourceInput>,
  context: ActionRunContext,
  // Screenshot bytes are moved into private storage only after every selected
  // source succeeded, so a failed import cannot leave an orphaned image.
  storage?: { featureId: string; ownerEmail: string },
) {
  const links = parseSourceLinks(input);
  const designProvider = getDesignProvider(input);
  const tools = await listVisibleMcpTools({ providerId: "atlassian" });
  const jiraTools = tools.filter((t) => t.name === "getJiraIssue");
  if (jiraTools.length !== 1)
    throw new Error(
      "Connect exactly one Atlassian account with getJiraIssue available in Settings → Integrations.",
    );
  const jira = jiraTools[0]!;
  const page = tools.find(
    (t) =>
      t.serverId === jira.serverId &&
      ["getConfluencePage", "getConfluenceContent"].includes(t.name),
  );
  if (!page)
    throw new Error(
      "The connected Atlassian server does not expose a supported Confluence page reader.",
    );
  const properties = (page.inputSchema.properties ?? {}) as Record<
    string,
    unknown
  >;
  const pageArgs: Record<string, unknown> = { cloudId: links.site };
  if ("pageId" in properties) pageArgs.pageId = links.pageId;
  else if ("content_id" in properties) pageArgs.content_id = links.pageId;
  else if ("id" in properties) pageArgs.id = links.pageId;
  else
    throw new Error("The Confluence reader has an unsupported locator schema.");
  if ("bodyFormat" in properties) pageArgs.bodyFormat = "atlas_doc_format";
  if ("contentFormat" in properties) pageArgs.contentFormat = "markdown";
  if ("content_format" in properties) pageArgs.content_format = "markdown";
  if ("detail" in properties) pageArgs.detail = "full";
  const results = await Promise.allSettled([
    callMcpTool(
      jira.serverId,
      jira.name,
      {
        cloudId: links.site,
        issueIdOrKey: links.key,
        fields: ["summary", "description", "updated"],
        responseContentFormat: "markdown",
      },
      { providerId: "atlassian", context },
    ),
    callMcpTool(page.serverId, page.name, pageArgs, {
      providerId: "atlassian",
      context,
    }),
    designProvider === DesignProvider.STITCH
      ? readStitchScreen(input.stitchProjectId!, input.stitchScreenId!, context)
      : designProvider === DesignProvider.FIGMA
        ? figma.executeRequest({
            provider: "figma",
            method: "GET",
            path: `/files/${links.fileKey}/nodes`,
            query: { ids: links.nodeId },
            timeoutMs: 30000,
            maxBytes: 2 * 1024 * 1024,
            ...(context.signal ? { signal: context.signal } : {}),
          })
        : Promise.resolve(null),
  ]);
  const labels = [
    "Jira",
    "Confluence",
    designProvider === DesignProvider.STITCH ? "Stitch" : "Figma",
  ];
  const failures = results.flatMap((r, i) =>
    r.status === "rejected" ? [labels[i]] : [],
  );
  if (failures.length) {
    // Server-side diagnostics only: the client gets the safe aggregate below.
    // Provider bodies and tokens never reach this log.
    console.warn("[live-sources] source read failed", {
      labels: results.map((result, index) => ({
        source: labels[index],
        status: result.status,
        ...(result.status === "rejected"
          ? { reason: result.reason instanceof Error ? result.reason.message : String(result.reason) }
          : {}),
      })),
    });
    throw new Error(
      `${failures.join(", ")} could not be read. Check the app connection, source access, and token permissions; no review was created.`,
    );
  }
  const values = results.map(
    (r) => (r as PromiseFulfilledResult<unknown>).value,
  );
  const issue = unwrapMcp(values[0]);
  const fields = record.parse(issue.fields);
  const confluence = unwrapMcp(values[1]);
  const body =
    typeof confluence.body === "string"
      ? { value: confluence.body, format: "markdown" }
      : record.parse(confluence.body);
  let pageText = "";
  if (typeof body.value === "string") pageText = body.value;
  else if (body.atlas_doc_format) {
    const adf = record.parse(body.atlas_doc_format);
    pageText = documentText(
      typeof adf.value === "string" ? JSON.parse(adf.value) : adf.value,
    );
  }
  // Never render or describe HTML as verified plain text.
  if (body.format === "html" || (!pageText && body.storage))
    throw new Error(
      "Confluence returned HTML rather than supported document text.",
    );
  const capturedAt = new Date().toISOString();
  const bound = (text: string) => {
    if (!text.trim() || text.length > 60000)
      throw new Error(
        "A source is empty or exceeds 60,000 characters. Select a smaller source; no partial review was saved.",
      );
    return text;
  };
  const sources: FeatureData["sources"] = [
    {
      kind: FeatureSource.JIRA,
      url: links.jiraUrl,
      capturedAt,
      version: String(fields.updated ?? "Current at capture"),
      excerpt: bound(`${fields.summary}\n${documentText(fields.description)}`),
      scope:
        "Story description only. Comments, linked issues and separate acceptance-criteria custom fields are not included.",
    },
    {
      kind: FeatureSource.CONFLUENCE,
      url: links.confluenceUrl,
      capturedAt,
      version: `Version ${record.parse(confluence.version ?? {}).number ?? "unknown"}`,
      excerpt: bound(`${confluence.title}\n${pageText}`),
      scope:
        "Published page text only. Comments, attachments and rendered macros are not included.",
    },
  ];
  if (designProvider === DesignProvider.STITCH)
    sources.push(values[2] as FeatureData["sources"][number]);
  if (designProvider === DesignProvider.FIGMA) {
    const response = record.parse(values[2]);
    const http = record.parse(response.response ?? response);
    if (http.status === 429) {
      const headers = record.parse(http.headers ?? {});
      const retry = headers["retry-after"];
      const wait =
        typeof retry === "string" && /^\d+$/.test(retry)
          ? ` Retry after ${retry} seconds.`
          : " Retry later according to your Figma plan limits.";
      throw new Error(
        `Figma read failed (429: rate limited).${wait} You can explicitly exclude Figma for a Jira/Confluence-only review.`,
      );
    }
    if (http.ok !== true || http.truncated)
      throw new Error(
        `Figma read failed (${http.status ?? "unknown status"}). Check token scope, file access or response limits.`,
      );
    const file = record.parse(http.json);
    const nodes = record.parse(file.nodes);
    const selection = record.parse(nodes[links.nodeId]);
    sources.push({
      kind: FeatureSource.FIGMA,
      url: links.figmaUrl,
      capturedAt,
      version: String(
        file.version ?? file.lastModified ?? "Current at capture",
      ),
      excerpt: bound(figmaText(selection.document)),
      scope:
        "Layer names and editable text in the selected node. Actual visibility, image pixels, comments and prototype interactions are not analysed.",
    });
  }
  if (designProvider === DesignProvider.STITCH) {
    const stitchSource = sources[sources.length - 1] as StitchScreenSource;
    if (!stitchSource.screenshotImage)
      throw new Error(
        "Stitch did not return a screenshot for the selected screen. No review was created.",
      );
    if (!storage)
      throw new Error("Screenshot storage context is missing.");
    stitchSource.screenshot = await storeStitchScreenshot({
      featureId: storage.featureId,
      ownerEmail: storage.ownerEmail,
      capturedAt: stitchSource.screenshotImage.capturedAt,
      projectId: stitchSource.screenshotImage.projectId,
      screenId: stitchSource.screenshotImage.screenId,
      title: stitchSource.screenshotImage.title,
      bytes: stitchSource.screenshotImage.bytes,
    });
    delete stitchSource.screenshotImage;
  }
  return { title: String(fields.summary), sources };
}
