import { getSession, runWithRequestContext } from "@agent-native/core/server";
import { FeatureSource } from "@shared/features/types";
import { createError, defineEventHandler, getRouterParam, setResponseHeaders } from "h3";

import {
  FeatureScreenshotError,
  readScreenshotBytes,
} from "../../../../features/screenshots";
import { getFeature } from "../../../../features/store";

// Authenticated, feature-scoped delivery of the import-time Stitch screenshot.
// The route name is stable but access is enforced by getFeature (owner/editor/
// viewer shares); there is no public or signed-storage URL in the browser.
export default defineEventHandler(async (event) => {
  const session = await getSession(event);
  if (!session?.email)
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  const id = getRouterParam(event, "id");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id))
    throw createError({ statusCode: 404, statusMessage: "Not found" });
  return runWithRequestContext(
    {
      userEmail: session.email,
      ...(session.orgId ? { orgId: session.orgId } : {}),
    },
    async () => {
      let feature;
      try {
        feature = await getFeature(id);
      } catch (error) {
        // Missing and inaccessible reviews answer the same way so the route
        // cannot confirm that an unreadable feature exists.
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 403)
          throw createError({ statusCode: 404, statusMessage: "Not found" });
        throw error;
      }
      const source = feature.data.sources.find(
        (candidate) =>
          candidate.kind === FeatureSource.STITCH && candidate.screenshot,
      );
      const screenshot = source?.screenshot;
      if (!screenshot)
        throw createError({
          statusCode: 404,
          statusMessage: "No screenshot for this feature.",
        });
      let bytes: Uint8Array;
      let mimeType: string;
      try {
        ({ bytes, mimeType } = await readScreenshotBytes(screenshot));
      } catch (error) {
        throw createError({
          statusCode: 503,
          statusMessage:
            error instanceof FeatureScreenshotError
              ? error.message
              : "The stored screenshot could not be read.",
        });
      }
      const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1];
      setResponseHeaders(event, {
        "Content-Type": mimeType,
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `inline; filename="stitch-${(screenshot.screenId ?? "screen").replace(/[^A-Za-z0-9_-]/g, "")}.${extension}"`,
        // Private per-caller bytes: never let a shared cache or proxy keep them.
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      });
      return bytes;
    },
  );
});
