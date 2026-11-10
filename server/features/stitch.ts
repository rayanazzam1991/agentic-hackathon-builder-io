import type { ActionRunContext } from "@agent-native/core/action";
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import { extractStaticWebsiteContext } from "@agent-native/core/ingestion";
import {
  callMcpTool,
  listVisibleMcpTools,
} from "@agent-native/core/mcp-client";
import { getMcpManagerForCurrentRequest } from "@agent-native/core/server/agent-chat/mcp-glue";
import {
  MaxScreenshotBytes,
  StitchTool,
  FeatureSource,
  type FeatureData,
} from "@shared/features/types";
import { z } from "zod";

import { unwrapProviderResult } from "./provider-result";

const endpoint = "https://stitch.googleapis.com/mcp";

// Custom server names are user-defined. Pin the actual endpoint, never trust a
// server named "Stitch" as proof of who receives authenticated tool requests.
export async function stitchReader() {
  const tools = await listVisibleMcpTools();
  const manager = await getMcpManagerForCurrentRequest();
  const matches = tools.filter((tool) => {
    const config = manager.getServerConfig(tool.serverId);
    return (
      config?.type === "http" &&
      config.url.replace(/\/$/, "") === endpoint &&
      tool.name === StitchTool.LIST_PROJECTS
    );
  });
  if (matches.length !== 1)
    throw new Error(
      "Stitch needs exactly one connected official MCP server. Check Settings → Integrations.",
    );
  const serverId = matches[0]!.serverId;
  return {
    tools: tools.filter((t) => t.serverId === serverId),
    async fetchAsset(url: string, signal: AbortSignal) {
      assertStitchAssetUrl(url);
      const config = manager.getServerConfig(serverId);
      if (config?.type !== "http" || config.url.replace(/\/$/, "") !== endpoint)
        throw new Error("Stitch connection changed. Read again.");
      // The principal's MCP manager has already resolved the encrypted header.
      // Reuse only this key, only for the same Google API origin. Never return
      // it through actions or forward it to a CDN or a redirect destination.
      const key = Object.entries(config.headers ?? {}).find(
        ([name]) => name.toLowerCase() === "x-goog-api-key",
      )?.[1];
      const authenticated =
        new URL(url).origin === new URL(endpoint).origin && key;
      return ssrfSafeFetch(
        url,
        {
          signal,
          ...(authenticated ? { headers: { "X-Goog-Api-Key": key } } : {}),
        },
        {
          httpsOnly: true,
          followRedirects: false,
          assertUrlAllowed(candidate) {
            assertStitchAssetUrl(candidate);
            if (
              authenticated &&
              new URL(candidate).origin !== new URL(endpoint).origin
            )
              throw new Error("Stitch credential destination mismatch.");
          },
        },
      );
    },
    async read(
      name: string,
      args: Record<string, unknown>,
      context?: ActionRunContext,
    ) {
      if (!Object.values(StitchTool).some((allowed) => allowed === name))
        throw new Error("Stitch reader does not allow writes.");
      if (!tools.some((t) => t.serverId === serverId && t.name === name))
        throw new Error("Stitch read tool is unavailable.");
      return callMcpTool(serverId, name, args, context ? { context } : {});
    },
  };
}

export const StitchId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const item = z.object({ name: z.string(), title: z.string().optional() });
export async function listStitchDesigns(
  projectId: string | undefined,
  context?: ActionRunContext,
) {
  const reader = await stitchReader();
  if (projectId) {
    StitchId.parse(projectId);
    const data = unwrapProviderResult(
      await reader.read(StitchTool.LIST_SCREENS, { projectId }, context),
    );
    return z
      .array(item)
      .max(100)
      .parse(data.screens ?? [])
      .map((screen) => ({
        id: StitchId.parse(screen.name.split("/").pop()),
        title: screen.title ?? screen.name,
      }));
  }
  const data = unwrapProviderResult(
    await reader.read(StitchTool.LIST_PROJECTS, {}, context),
  );
  return z
    .array(item)
    .max(100)
    .parse(data.projects ?? [])
    .map((project) => ({
      id: StitchId.parse(project.name.split("/").pop()),
      title: project.title ?? project.name,
    }));
}
export function assertStitchAssetUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    ![
      "lh3.googleusercontent.com",
      "storage.googleapis.com",
      "stitch.googleapis.com",
    ].includes(url.hostname)
  )
    throw new Error("Stitch returned an unsupported asset host.");
}

export function extractStitchText(payload: string, url: string) {
  // Current Google downloads wrap HTML in JSON; older CDN links return HTML
  // directly. Decode the envelope before extraction so scripts never become
  // escaped source text in the saved evidence or the model's context.
  const html = payload.trimStart().startsWith("{")
    ? z
        .object({ dataString: z.string().max(1024 * 1024) })
        .parse(JSON.parse(payload)).dataString
    : payload;
  if (!/^\s*(?:<!doctype\s+html[^>]*>\s*)?<html\b/i.test(html))
    throw new Error("Stitch returned unsupported HTML content.");
  const extracted = extractStaticWebsiteContext(html, url);
  if (/^(sign in|sign-in|google accounts)/i.test(extracted.title))
    throw new Error(
      "Stitch returned a sign-in page rather than screen content.",
    );
  const text = extracted.text;
  if (!text.trim() || text.length > 60000)
    throw new Error("Stitch screen text is empty or too large.");
  return text;
}
export type StitchScreenSource = FeatureData["sources"][number] & {
  // In-memory capture only. live-sources.ts moves these bytes to private blob
  // storage once every selected source succeeded, so a failed import leaves no
  // orphaned file and SQL never stores binary payloads.
  screenshotImage?: {
    bytes: Uint8Array;
    title: string;
    capturedAt: string;
    projectId: string;
    screenId: string;
  };
};

async function downloadBounded(
  reader: Awaited<ReturnType<typeof stitchReader>>,
  url: string,
  limitBytes: number,
  context: ActionRunContext,
  label: string,
) {
  const response = await reader.fetchAsset(
    url,
    AbortSignal.any([
      ...(context.signal ? [context.signal] : []),
      AbortSignal.timeout(30000),
    ]),
  );
  if (!response.ok || !response.body)
    throw new Error(`Stitch ${label} download failed (${response.status}).`);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const stream = response.body.getReader();
  try {
    while (true) {
      const next = await stream.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > limitBytes) {
        await stream.cancel();
        throw new Error(`Stitch ${label} exceeds the supported size.`);
      }
      chunks.push(next.value);
    }
  } finally {
    stream.releaseLock();
  }
  return Buffer.concat(chunks);
}

// Google wraps screenshot downloads in a small JSON envelope:
// {"imageMetadata":{"mimeType":"image/png"},"dataString":"<base64>"}. Older
// links return the image directly. Decode only these two shapes and let the
// screenshot store validate the actual image signature.
export function decodeStitchScreenshot(payload: Uint8Array) {
  const text = Buffer.from(payload).toString("utf8").trimStart();
  if (!text.startsWith("{")) return Buffer.from(payload);
  const envelope = z
    .object({
      imageMetadata: z.object({ mimeType: z.string().optional() }).optional(),
      dataString: z.string().min(1).max(2 * 1024 * 1024),
    })
    .passthrough()
    .parse(JSON.parse(text));
  const bytes = Buffer.from(envelope.dataString, "base64");
  if (bytes.byteLength === 0)
    throw new Error("Stitch returned an empty screenshot.");
  return bytes;
}

// Download the selected screen's exported HTML as inert text and its import-time
// screenshot. Never execute scripts or load referenced assets.
export async function readStitchScreen(
  projectId: string,
  screenId: string,
  context: ActionRunContext,
): Promise<StitchScreenSource> {
  StitchId.parse(projectId);
  StitchId.parse(screenId);
  const reader = await stitchReader();
  const name = `projects/${projectId}/screens/${screenId}`;
  const data = unwrapProviderResult(
    await reader.read(StitchTool.GET_SCREEN, { name }, context),
  );
  const screen = z
    .object({
      name: z.string(),
      title: z.string().optional(),
      updateTime: z.string().optional(),
      htmlCode: z.object({ downloadUrl: z.string() }),
      // Stitch exposes a static image per screen; project listings use the same
      // field name. Accept the documented thumbnail, or a screen `screenshot`.
      thumbnailScreenshot: z.object({ downloadUrl: z.string() }).optional(),
      screenshot: z.object({ downloadUrl: z.string() }).optional(),
    })
    .passthrough()
    .parse(data.screen ?? data);
  if (screen.name !== name)
    throw new Error("Stitch returned a different screen.");
  const image = screen.thumbnailScreenshot ?? screen.screenshot;
  if (!image)
    throw new Error(
      "Stitch returned no screenshot for this screen. Pick a screen that has one; no review was created.",
    );
  assertStitchAssetUrl(screen.htmlCode.downloadUrl);
  assertStitchAssetUrl(image.downloadUrl);
  const htmlBytes = await downloadBounded(
    reader,
    screen.htmlCode.downloadUrl,
    1024 * 1024,
    context,
    "HTML",
  );
  // Google may wrap the image in base64 JSON, so the transport bound is
  // larger than the decoded image bound enforced by the screenshot store.
  const imageBytes = await downloadBounded(
    reader,
    image.downloadUrl,
    Math.ceil(MaxScreenshotBytes * 1.5),
    context,
    "screenshot",
  );
  const decodedImage = decodeStitchScreenshot(imageBytes);
  const capturedAt = new Date().toISOString();
  const url = `https://stitch.withgoogle.com/projects/${projectId}?screenId=${screenId}`;
  const text = extractStitchText(htmlBytes.toString("utf8"), url);
  const title = screen.title ?? "Stitch screen";
  return {
    kind: FeatureSource.STITCH,
    url,
    capturedAt,
    version: screen.updateTime ?? "Current at capture; no version supplied",
    excerpt: `${title}\n${text}`,
    scope:
      "Selected screen's exported static HTML text and its import-time screenshot. Scripts are not executed. Interactions, responsive behaviour, other screens and later design changes are not verified.",
    screenshotImage: {
      bytes: decodedImage,
      title,
      capturedAt,
      projectId,
      screenId,
    },
  };
}
