import { defineAction, isActionContractError } from "@agent-native/core/action";
import {
  DiscordQuestionInput,
  FeatureWriteSchema,
} from "@shared/features/types";

import { cancelFollowUpForQuestion } from "../server/features/discord-followups";
import { featureErrors } from "../server/features/errors";
import { featureLink } from "../server/features/links";
import { featureWriteReceipt } from "../server/features/receipt";

export default defineAction({
  description:
    "Owner-only: cancel a pending automatic Discord follow-up without sending anything. Not available to the agent.",
  schema: DiscordQuestionInput,
  outputSchema: FeatureWriteSchema,
  errors: featureErrors,
  link: featureLink,
  needsApproval: true,
  agentTool: false,
  run: async ({ id, revision, questionId }, context) => {
    if (context?.caller !== "frontend")
      throw featureErrors.noWrite(
        "Cancel a follow-up from the feature screen.",
        "human_approval_required",
        { statusCode: 403 },
      );
    try {
      const feature = await cancelFollowUpForQuestion(
        id,
        revision,
        questionId,
      );
      return featureWriteReceipt(
        feature,
        "Cancelled one automatic Discord follow-up. Nothing was sent.",
      );
    } catch (error) {
      if (isActionContractError(error)) throw error;
      throw featureErrors.noWrite(
        error instanceof Error
          ? error.message
          : "Could not cancel this follow-up.",
        "invalid_transition",
      );
    }
  },
});
