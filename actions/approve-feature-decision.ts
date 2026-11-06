import { defineAction } from "@agent-native/core/action";
import {
  FeatureWriteSchema,
  QuestionEvent,
  RevisionInput,
} from "@shared/features/types";

import { featureErrors } from "../server/features/errors";
import { featureLink } from "../server/features/links";
import { featureWriteReceipt } from "../server/features/receipt";
import { changeQuestion } from "../server/features/store";
export default defineAction({
  description:
    "Approve the exact observed proposed decision as the resource owner. Human approval is required. Produces a specification preview, never publishes.",
  schema: RevisionInput,
  outputSchema: FeatureWriteSchema,
  link: featureLink,
  errors: featureErrors,
  needsApproval: true,
  deferLoading: false,
  run: async ({ id, revision }, context) => {
    // Direct action composition is not an approval channel. Local Codex is
    // deliberately excluded; authenticated humans approve from the review UI.
    if (context?.caller !== "frontend")
      featureErrors.noWrite(
        "Approve this proposal from its feature review screen.",
        "human_approval_required",
        { statusCode: 403 },
      );
    return featureWriteReceipt(
      await changeQuestion(id, revision, { event: QuestionEvent.APPROVE }),
      "Recorded and verified human approval. Nothing was published.",
    );
  },
});
