import { defineAction, isActionContractError } from "@agent-native/core/action";
import {
  DiscordQuestionInput,
  FeatureWriteSchema,
} from "@shared/features/types";

import { recheckFollowUpForQuestion } from "../server/features/discord-followups";
import { featureErrors } from "../server/features/errors";
import { featureLink } from "../server/features/links";
import { featureWriteReceipt } from "../server/features/receipt";

export default defineAction({
  description:
    "Owner-only: recheck the channel for a qualifying reply and refresh a follow-up's unverified or uncertain state. Never posts a message. Not available to the agent.",
  schema: DiscordQuestionInput,
  outputSchema: FeatureWriteSchema,
  errors: featureErrors,
  link: featureLink,
  needsApproval: true,
  agentTool: false,
  run: async ({ id, revision, questionId }, context) => {
    if (context?.caller !== "frontend")
      throw featureErrors.noWrite(
        "Recheck a follow-up from the feature screen.",
        "human_approval_required",
        { statusCode: 403 },
      );
    try {
      const feature = await recheckFollowUpForQuestion(
        id,
        revision,
        questionId,
      );
      return featureWriteReceipt(
        feature,
        "Rechecked the Discord channel. No message was sent.",
      );
    } catch (error) {
      if (isActionContractError(error)) throw error;
      throw featureErrors.noWrite(
        error instanceof Error ? error.message : "Could not recheck this follow-up.",
        "invalid_transition",
      );
    }
  },
});
