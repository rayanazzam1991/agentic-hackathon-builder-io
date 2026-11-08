import { defineAction } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db";
import { featureErrors } from "../server/features/errors";
import { featureListLink } from "../server/features/links";
import { requireActor } from "../server/features/store";

export default defineAction({
  description:
    "Preview or permanently delete every feature review owned by the signed-in user in the active workspace, with its sharing entries. Reviews owned by others are excluded. Deletes only app records, never Discord messages. Deletion requires the frontend and expectedCount from the preview. dryRun defaults to true.",
  agentTool: false,
  schema: z.object({
    dryRun: z
      .boolean()
      .default(true)
      .describe(
        "True previews matching reviews; false permanently deletes them in one transaction.",
      ),
    expectedCount: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "Required when dryRun is false: the review count shown in the preview. A mismatch deletes nothing.",
      ),
  }),
  outputSchema: z.object({
    reviews: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        hasDiscordHistory: z.boolean(),
      }),
    ),
    remaining: z.number(),
    _receipt: z.object({
      changed: z.boolean(),
      verified: z.boolean(),
      subject: z.string(),
      summary: z.string(),
    }),
  }),
  errors: featureErrors,
  link: featureListLink,
  run: async ({ dryRun, expectedCount }, context) => {
    const actor = requireActor();
    const filter = and(
      accessFilter(schema.features, schema.featureShares),
      eq(schema.features.ownerEmail, actor),
    );
    const select = async (db: ReturnType<typeof getDb>) =>
      (
        await db
          .select({
            id: schema.features.id,
            title: schema.features.title,
            data: schema.features.data,
          })
          .from(schema.features)
          .where(filter)
      ).map(({ id, title, data }) => ({
        id,
        title,
        hasDiscordHistory: !!data.discord?.delivery,
      }));
    const db = getDb();
    if (dryRun) {
      const reviews = await select(db);
      return {
        reviews,
        remaining: reviews.length,
        _receipt: {
          changed: false,
          verified: true,
          subject: "features",
          summary: "Preview only. No reviews deleted.",
        },
      };
    }
    if (context?.caller !== "frontend")
      throw featureErrors.noWrite(
        "Remove reviews from the feature list screen.",
        "human_approval_required",
        { statusCode: 403 },
      );
    return db.transaction(async (tx) => {
      const reviews = await select(tx as unknown as typeof db);
      if (expectedCount !== reviews.length)
        throw featureErrors.noWrite(
          "The reviews changed since the preview. Review the list and try again.",
          "stale_revision",
          { statusCode: 409 },
        );
      const ids = reviews.map((r) => r.id);
      if (ids.length) {
        await tx
          .delete(schema.featureShares)
          .where(inArray(schema.featureShares.resourceId, ids));
        await tx
          .delete(schema.features)
          .where(and(filter, inArray(schema.features.id, ids)));
      }
      const remaining = (await select(tx as unknown as typeof db)).length;
      return {
        reviews,
        remaining,
        _receipt: {
          changed: ids.length > 0,
          verified: remaining === 0,
          subject: "features",
          summary:
            "Deleted your reviews and their shares. Discord messages were not touched.",
        },
      };
    });
  },
});
