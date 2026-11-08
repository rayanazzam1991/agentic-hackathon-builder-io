import { defineAction, isActionContractError } from "@agent-native/core/action";
import { FeatureWriteSchema, RevisionInput } from "@shared/features/types";

import {
  applyDiscordSetup,
  discordFailure,
} from "../server/features/discord-workflow";
import { featureErrors } from "../server/features/errors";
import { featureLink } from "../server/features/links";
import { featureWriteReceipt } from "../server/features/receipt";
export default defineAction({
  description:
    "Apply your verified personal Discord defaults to an owned live feature with no existing channel. Never sends or approves.",
  schema: RevisionInput,
  outputSchema: FeatureWriteSchema,
  errors: featureErrors,
  link: featureLink,
  run: async ({ id, revision }) => {
    try {
      return featureWriteReceipt(
        await applyDiscordSetup(id, revision),
        "Applied Discord defaults. No message sent.",
      );
    } catch (error) {
      if (isActionContractError(error)) throw error;
      return discordFailure(error);
    }
  },
});
