import { defineAction } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db";
import { featureErrors } from "../server/features/errors";
import { featureListLink } from "../server/features/links";
import { removeFeatureScreenshots } from "../server/features/screenshots";
import { requireActor } from "../server/features/store";

export default defineAction({
  description:
    "Preview or permanently delete every owned synthetic sample review in the active workspace, plus its sharing entries. Live reviews and other owners' reviews are excluded. dryRun defaults to true.",
  agentTool: false,
  schema: z.object({
    dryRun: z
      .boolean()
      .default(true)
      .describe(
        "True previews matching reviews; false permanently deletes those samples in one transaction.",
      ),
  }),
  outputSchema: z.object({
    reviews: z.array(z.object({ id: z.string(), title: z.string() })),
    remainingSamples: z.number(),
    _receipt: z.object({
      changed: z.boolean(),
      verified: z.boolean(),
      subject: z.string(),
      summary: z.string(),
    }),
  }),
  errors: featureErrors,
  link: featureListLink,
  run: async ({ dryRun }) => {
    const actor = requireActor();
    // Exact JSON boolean, owner identity AND active workspace access: never infer
    // provenance from a title, and never remove a shared review owned by someone else.
    const filter = and(
      accessFilter(schema.features, schema.featureShares),
      eq(schema.features.ownerEmail, actor),
      sql<boolean>`${schema.features.data}->'sample' = 'true'::jsonb`,
    );
    const db = getDb();
    const rows = () =>
      db
        .select({
          id: schema.features.id,
          title: schema.features.title,
          data: schema.features.data,
        })
        .from(schema.features)
        .where(filter);
    if (dryRun) {
      const samples = await rows();
      return {
        reviews: samples.map(({ id, title }) => ({ id, title })),
        remainingSamples: samples.length,
        _receipt: {
          changed: false,
          verified: true,
          subject: "sample-reviews",
          summary: "Preview only. No reviews deleted.",
        },
      };
    }
    const samples = await rows();
    // Delete image bytes before rows. A cleanup failure changes nothing and is
    // safe to retry; deleting an already-missing blob counts as success.
    try {
      await removeFeatureScreenshots(samples.map((row) => row.data.sources));
    } catch {
      throw featureErrors.noWrite(
        "The stored screenshots could not be removed. No samples were deleted; retry.",
        "screenshot_cleanup_failed",
        { statusCode: 503 },
      );
    }
    return db.transaction(async (tx) => {
      const reviews = await tx
        .delete(schema.features)
        .where(filter)
        .returning({ id: schema.features.id, title: schema.features.title });
      if (reviews.length)
        await tx.delete(schema.featureShares).where(
          inArray(
            schema.featureShares.resourceId,
            reviews.map((row) => row.id),
          ),
        );
      const remaining = await tx
        .select({ id: schema.features.id })
        .from(schema.features)
        .where(filter);
      return {
        reviews,
        remainingSamples: remaining.length,
        _receipt: {
          changed: reviews.length > 0,
          verified: remaining.length === 0,
          subject: "sample-reviews",
          summary:
            "Deleted owned sample reviews and their shares; live reviews were excluded.",
        },
      };
    });
  },
});
