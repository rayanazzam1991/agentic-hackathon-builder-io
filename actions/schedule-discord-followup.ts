import { defineAction, isActionContractError } from "@agent-native/core/action";
import {
  DiscordFollowUpInput,
  FeatureWriteSchema,
} from "@shared/features/types";

import { scheduleFollowUpForQuestion } from "../server/features/discord-followups";
import { featureErrors } from "../server/features/errors";
import { featureLink } from "../server/features/links";
import { featureWriteReceipt } from "../server/features/receipt";

export default defineAction({
  description:
    "Owner-only: schedule one automatic Discord follow-up for an already confirmed question. Never sends now and is not available to the agent.",
  schema: DiscordFollowUpInput,
  outputSchema: FeatureWriteSchema,
  errors: featureErrors,
  link: featureLink,
  needsApproval: true,
  agentTool: false,
  run: async ({ id, revision, questionId, hours }, context) => {
    if (context?.caller !== "frontend")
      throw featureErrors.noWrite(
        "Schedule a follow-up from the feature screen.",
        "human_approval_required",
        { statusCode: 403 },
      );
    try {
      const feature = await scheduleFollowUpForQuestion(
        id,
        revision,
        hours,
        questionId,
      );
      return featureWriteReceipt(
        feature,
        "Scheduled one automatic Discord follow-up. Nothing was sent.",
      );
    } catch (error) {
      if (isActionContractError(error)) throw error;
      throw featureErrors.noWrite(
        error instanceof Error
          ? error.message
          : "Could not schedule this follow-up.",
        "invalid_transition",
      );
    }
  },
});
