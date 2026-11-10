import { defineAction } from "@agent-native/core/action";
import {
  FeatureWithImagesSchema,
  RevisionInput,
} from "@shared/features/types";

import { featureErrors } from "../server/features/errors";
import { featureLink } from "../server/features/links";
import {
  featureScreenshots,
  readScreenshotBytes,
} from "../server/features/screenshots";
import { getFeature } from "../server/features/store";
export default defineAction({
  description:
    "Read an accessible feature's source evidence, question, revision, proposed decision and activity. Read before changing a question.",
  schema: RevisionInput.pick({ id: true }),
  outputSchema: FeatureWithImagesSchema,
  errors: featureErrors,
  http: { method: "GET" },
  deferLoading: false,
  link: featureLink,
  run: async ({ id }, context) => {
    const feature = await getFeature(id);
    // UI reads stay text-only: image bytes belong in tool results, never in the
    // browser's persisted query cache.
    if (context?.caller !== "tool") return feature;
    // Attach the import-time Stitch screenshot as a vision image. Permission
    // scope comes from getFeature above; the image is read from private storage
    // only after that access check. The framework lifts `_agentImages` out of
    // the tool result, so the model sees an image rather than a path.
    const screenshot = featureScreenshots(feature.data.sources)[0];
    if (!screenshot) return feature;
    try {
      const { bytes, mimeType } = await readScreenshotBytes(screenshot);
      return {
        ...feature,
        _agentImages: [
          {
            data: Buffer.from(bytes).toString("base64"),
            mediaType: mimeType,
            label: `${screenshot.label} · Stitch screenshot captured ${screenshot.capturedAt}`,
          },
        ],
      };
    } catch (error) {
      // Keep text evidence available; never fail a review because an image read
      // failed, and never imply the agent saw the screenshot.
      console.warn("[get-feature] screenshot unavailable", {
        featureId: id,
        reason: error instanceof Error ? error.name : "unknown",
      });
      return feature;
    }
  },
});
