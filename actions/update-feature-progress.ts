import { defineAction } from "@agent-native/core/action";
import { FeatureProgressChangeSchema, FeatureWriteSchema } from "@shared/features/types";
import { featureErrors } from "../server/features/errors";
import { featureLink } from "../server/features/links";
import { featureWriteReceipt } from "../server/features/receipt";
import { changeFeatureProgress } from "../server/features/store";

export default defineAction({
  description: "Explicitly start, complete, reopen or reset feature progress. Does not change questions, approvals or Discord. Requires the current revision.",
  schema: FeatureProgressChangeSchema,
  outputSchema: FeatureWriteSchema,
  link: featureLink,
  errors: featureErrors,
  deferLoading: false,
  run: async ({ id, revision, event }) => featureWriteReceipt(
    await changeFeatureProgress(id, revision, event),
    "Saved and verified feature progress.",
  ),
});
