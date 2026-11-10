import { defineAction } from "@agent-native/core/action";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db";
import { featureErrors } from "../server/features/errors";
import { featureListLink } from "../server/features/links";
import { removeFeatureScreenshots } from "../server/features/screenshots";
import { getFeature, requireActor } from "../server/features/store";

export default defineAction({
  description:
    "Permanently delete one feature review owned by the signed-in user in the active workspace, including its shares and stored screenshot. Deletes only app records, never Discord messages.",
  agentTool: false,
  uiOnly: true,
  schema: z.object({
    id: z.string().min(1).max(200).describe("Feature ID from the review page."),
  }),
  outputSchema: z.object({
    id: z.string(),
    deleted: z.boolean(),
    _receipt: z.object({
      changed: z.boolean(),
      verified: z.boolean(),
      subject: z.string(),
      summary: z.string(),
    }),
  }),
  errors: featureErrors,
  link: featureListLink,
  run: async ({ id }, context) => {
    const actor = requireActor();
    if (context?.caller !== "frontend")
      throw featureErrors.noWrite(
        "Remove reviews from the feature page.",
        "human_approval_required",
        { statusCode: 403 },
      );
    const feature = await getFeature(id);
    if (feature.ownerEmail !== actor)
      throw featureErrors.noWrite(
        "Only the review owner can delete this review.",
        "human_approval_required",
        { statusCode: 403 },
      );
    // Remove image bytes first. If storage cleanup fails nothing is deleted, so
    // the review cannot disappear while its screenshot stays reachable; a retry
    // is safe because an already-missing blob counts as deleted.
    try {
      await removeFeatureScreenshots([feature.data.sources]);
    } catch {
      throw featureErrors.noWrite(
        "The stored screenshot could not be removed. The review was not deleted; retry.",
        "screenshot_cleanup_failed",
        { statusCode: 503 },
      );
    }
    await getDb().transaction(async (tx) => {
      await tx
        .delete(schema.featureShares)
        .where(inArray(schema.featureShares.resourceId, [id]));
      await tx
        .delete(schema.features)
        .where(and(eq(schema.features.id, id), eq(schema.features.ownerEmail, actor)));
    });
    const [remaining] = await getDb()
      .select({ id: schema.features.id })
      .from(schema.features)
      .where(eq(schema.features.id, id));
    return {
      id,
      deleted: !remaining,
      _receipt: {
        changed: !remaining,
        verified: !remaining,
        subject: "feature",
        summary:
          "Deleted the review, its shares and its stored screenshot. Discord messages were not touched.",
      },
    };
  },
});
