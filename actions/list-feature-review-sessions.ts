import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { featureErrors } from "../server/features/errors";
import { listFeatureReviewSessions } from "../server/features/review-sessions";

export default defineAction({
  description:
    "List up to 50 accessible review sessions associated with an accessible feature. Unassociated chats are excluded.",
  schema: z.object({ id: z.string().min(1).max(200) }),
  outputSchema: z.array(
    z.object({ threadId: z.string(), title: z.string(), isOwner: z.boolean() }),
  ),
  errors: featureErrors,
  http: { method: "GET" },
  run: async ({ id }) => listFeatureReviewSessions(id),
});
