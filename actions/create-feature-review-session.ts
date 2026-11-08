import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { featureErrors } from "../server/features/errors";
import { createFeatureReviewSession } from "../server/features/review-sessions";

export default defineAction({
  description:
    "Create a private review chat durably associated with a feature you can access. Does not send a message or change existing chats.",
  schema: z.object({ id: z.string().min(1).max(200) }),
  outputSchema: z.object({ threadId: z.string() }),
  errors: featureErrors,
  run: async ({ id }) => createFeatureReviewSession(id),
});
