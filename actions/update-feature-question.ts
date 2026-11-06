import { defineAction } from "@agent-native/core/action";
import {
  FeatureWriteSchema,
  QuestionChangeSchema,
  RevisionInput,
} from "@shared/features/types";
import { z } from "zod";

import { featureErrors } from "../server/features/errors";
import { featureLink } from "../server/features/links";
import { featureWriteReceipt } from "../server/features/receipt";
import { changeQuestion } from "../server/features/store";
export default defineAction({
  description:
    "Assign an open question, record a real supplied reply, or propose a decision after a reply. Never approves or publishes. Requires the current revision.",
  schema: RevisionInput.extend({
    change: QuestionChangeSchema.describe(
      "assign, reply or propose operation with its required fields.",
    ),
  }),
  outputSchema: FeatureWriteSchema,
  link: featureLink,
  errors: featureErrors,
  deferLoading: false,
  run: async ({ id, revision, change }) =>
    featureWriteReceipt(
      await changeQuestion(id, revision, change),
      "Saved and verified the question update.",
    ),
});
