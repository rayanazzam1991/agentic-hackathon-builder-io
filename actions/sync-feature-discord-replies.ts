import { defineAction, isActionContractError } from "@agent-native/core/action";
import { FeatureWriteSchema } from "@shared/features/types";
import { z } from "zod";

import {
  discordFailure,
  syncDiscordReplies,
} from "../server/features/discord-workflow";
import { featureErrors } from "../server/features/errors";
import { featureLink } from "../server/features/links";
import { featureWriteReceipt } from "../server/features/receipt";

export default defineAction({
  description:
    "Frontend-only: read the latest 100 channel messages once and refresh replies for every sent question on a feature. Never sends, records an answer, or approves anything. Hidden from agent tools.",
  schema: z.object({ id: z.string().min(1).max(200) }),
  outputSchema: FeatureWriteSchema,
  errors: featureErrors,
  link: featureLink,
  agentTool: false,
  run: async ({ id }, context) => {
    if (context?.caller !== "frontend")
      throw featureErrors.noWrite(
        "Refresh replies from the feature screen.",
        "human_approval_required",
        { statusCode: 403 },
      );
    try {
      const feature = await syncDiscordReplies(id);
      return featureWriteReceipt(
        feature,
        "Refreshed Discord replies across sent questions. No message was sent.",
      );
    } catch (error) {
      if (isActionContractError(error)) throw error;
      return discordFailure(error);
    }
  },
});
