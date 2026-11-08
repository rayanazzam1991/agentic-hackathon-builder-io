import { defineAction } from "@agent-native/core/action";
import {
  AskReviewChangeSchema,
  FeatureWriteSchema,
  RevisionInput,
} from "@shared/features/types";
import { z } from "zod";

import { featureErrors } from "../server/features/errors";
import { featureLink } from "../server/features/links";
import { featureWriteReceipt } from "../server/features/receipt";
import { reviewSuggestedQuestionAsk } from "../server/features/suggested-questions";
export default defineAction({
  description:
    "Owner-only: approve or reject asking one suggested question, or reopen a rejected one to pending. Approval covers the saved text and recipient only; it is not a business-decision approval and sends nothing. Requires the current revision.",
  schema: RevisionInput.extend({
    questionId: z.string().min(1).max(100).describe("Suggested question id."),
    change: AskReviewChangeSchema,
  }),
  outputSchema: FeatureWriteSchema,
  link: featureLink,
  errors: featureErrors,
  needsApproval: true,
  deferLoading: false,
  run: async ({ id, revision, questionId, change }, context) => {
    // Agents and direct composition cannot approve; the owner uses the UI.
    if (context?.caller !== "frontend")
      throw featureErrors.noWrite(
        "Review asking this question from the feature review screen.",
        "human_approval_required",
        { statusCode: 403 },
      );
    return featureWriteReceipt(
      await reviewSuggestedQuestionAsk(id, revision, questionId, change),
      "Recorded and verified the ask review. Nothing was sent.",
    );
  },
});
