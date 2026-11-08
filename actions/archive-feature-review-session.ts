import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { featureErrors } from "../server/features/errors";
import { archiveFeatureReviewSession } from "../server/features/review-sessions";

export default defineAction({
  description:
    "Archive or restore a review session you own after checking its feature and workspace. The chat history is preserved.",
  schema: z.object({
    id: z.string().min(1).max(200),
    threadId: z.string().min(1).max(200),
    archived: z.boolean(),
  }),
  outputSchema: z.object({ threadId: z.string(), archived: z.boolean() }),
  errors: featureErrors,
  run: async ({ id, threadId, archived }) =>
    archiveFeatureReviewSession(id, threadId, archived),
});
