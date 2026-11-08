import { defineAction } from "@agent-native/core/action";
import {
  SuggestedQuestionBatchSchema,
  SuggestedQuestionWriteSchema,
} from "@shared/features/types";

import { featureErrors } from "../server/features/errors";
import { featureLink } from "../server/features/links";
import { createSuggestedQuestions } from "../server/features/suggested-questions";
export default defineAction({
  description:
    "Add 1-5 suggested questions to a feature, each with an origin (source_question or agent_finding), verbatim excerpts from captured sources, and an optional suggested responsible role (null if unresolved). Each needs ownerReason when a role is set. Possible duplicates of existing questions (including approved or sent) are skipped and explained in suggestionReview, and capture limitations are returned. Suggestions are unapproved and unsent. Requires the current revision.",
  schema: SuggestedQuestionBatchSchema,
  outputSchema: SuggestedQuestionWriteSchema,
  link: featureLink,
  errors: featureErrors,
  run: async ({ id, revision, questions }) => {
    const { feature, created, skipped, limitations } =
      await createSuggestedQuestions(id, revision, questions);
    return {
      ...feature,
      _receipt: {
        changed: created.length > 0,
        verified: true,
        subject: feature.id,
        summary: created.length
          ? `Saved and verified ${created.length} suggested question(s); ${skipped.length} skipped as possible duplicates. Nothing was approved or sent.`
          : "No questions were saved: every suggestion matched an existing question.",
      },
      suggestionReview: { created, skipped, limitations },
    };
  },
});
