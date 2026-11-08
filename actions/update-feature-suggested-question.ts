import { defineAction } from "@agent-native/core/action";
import {
  FeatureWriteSchema,
  SuggestedQuestionUpdateSchema,
} from "@shared/features/types";

import { featureErrors } from "../server/features/errors";
import { featureLink } from "../server/features/links";
import { featureWriteReceipt } from "../server/features/receipt";
import { changeSuggestedQuestion } from "../server/features/suggested-questions";
export default defineAction({
  description:
    "Edit, dismiss or restore one suggested question by questionId (not the primary question). Edit can change text, suggested role, cited evidence and recipient role; dismissed suggestions are restorable. Never approves or sends. Requires the current revision.",
  schema: SuggestedQuestionUpdateSchema,
  outputSchema: FeatureWriteSchema,
  link: featureLink,
  errors: featureErrors,
  run: async ({ id, revision, questionId, change }) =>
    featureWriteReceipt(
      await changeSuggestedQuestion(id, revision, questionId, change),
      "Saved and verified the suggested question update. Nothing was approved or sent.",
    ),
});
