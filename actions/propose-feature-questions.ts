import { defineAction } from "@agent-native/core/action";
import {
  SuggestedQuestionBatchSchema,
  SuggestedQuestionWriteSchema,
} from "@shared/features/types";

import { featureErrors } from "../server/features/errors";
import { featureLink } from "../server/features/links";
import { proposeQuestions } from "../server/features/suggested-questions";
export default defineAction({
  description:
    "Propose 1-5 candidate questions extracted from a feature's captured sources, each with an origin (source_question or agent_finding), verbatim source excerpts and an optional suggested responsible role (null if unresolved; ownerReason is required when a role is set). Proposals only appear in chat for the user to accept or reject; they never enter the question pool and are not compared to it until the user accepts one. Requires the current revision.",
  schema: SuggestedQuestionBatchSchema,
  outputSchema: SuggestedQuestionWriteSchema,
  link: featureLink,
  errors: featureErrors,
  run: async ({ id, revision, questions }) => {
    const { feature, created, skipped, limitations } = await proposeQuestions(
      id,
      revision,
      questions,
    );
    return {
      ...feature,
      _receipt: {
        changed: created.length > 0,
        verified: true,
        subject: feature.id,
        summary: created.length
          ? `Saved and verified ${created.length} proposal(s) for the user's review; ${skipped.length} skipped. The question pool was not changed.`
          : "No proposals were saved: every one is already waiting for review.",
      },
      suggestionReview: { created, skipped, limitations },
    };
  },
});
