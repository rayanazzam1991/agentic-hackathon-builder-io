import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { featureErrors } from "../server/features/errors";
import { openFeatureReviewSession } from "../server/features/review-sessions";

export default defineAction({
  description:
    "Verify access to a feature and its associated review session before opening it.",
  schema: z.object({
    id: z.string().min(1).max(200),
    threadId: z.string().min(1).max(200),
  }),
  outputSchema: z.object({ threadId: z.string() }),
  errors: featureErrors,
  run: async ({ id, threadId }) => openFeatureReviewSession(id, threadId),
});
