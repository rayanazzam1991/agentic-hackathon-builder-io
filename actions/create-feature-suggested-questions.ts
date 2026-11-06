import { defineAction } from "@agent-native/core/action";
import {
  FeatureWriteSchema,
  SuggestedQuestionBatchSchema,
} from "@shared/features/types";

import { featureErrors } from "../server/features/errors";
import { featureLink } from "../server/features/links";
import { featureWriteReceipt } from "../server/features/receipt";
import { createSuggestedQuestions } from "../server/features/suggested-questions";
export default defineAction({
  description:
    "Add 1-5 suggested questions to a feature, each with an origin (source_question or agent_finding), verbatim excerpts from captured sources, and an optional suggested responsible role (null if unresolved). Suggestions are unapproved and unsent. Requires the current revision.",
  schema: SuggestedQuestionBatchSchema,
  outputSchema: FeatureWriteSchema,
  link: featureLink,
  errors: featureErrors,
  run: async ({ id, revision, questions }) =>
    featureWriteReceipt(
      await createSuggestedQuestions(id, revision, questions),
      "Saved and verified the suggested questions. Nothing was approved or sent.",
    ),
});
