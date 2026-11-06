import { defineAction, isActionContractError } from "@agent-native/core/action";
import { FeatureWriteSchema, RevisionInput } from "@shared/features/types";

import {
  checkDiscordReplies,
  discordFailure,
} from "../server/features/discord-workflow";
import { featureErrors } from "../server/features/errors";
import { featureLink } from "../server/features/links";
import { featureWriteReceipt } from "../server/features/receipt";
export default defineAction({
  description:
    "Read the latest 100 messages in a feature's verified Discord channel, reconcile a pending send and save direct human reply candidates. Never sends, records a business reply or approves automatically.",
  schema: RevisionInput,
  outputSchema: FeatureWriteSchema,
  errors: featureErrors,
  link: featureLink,
  run: async ({ id, revision }) => {
    try {
      return featureWriteReceipt(
        await checkDiscordReplies(id, revision),
        "Checked Discord and saved reply candidates with coverage limits. No message was sent.",
      );
    } catch (error) {
      if (isActionContractError(error)) throw error;
      return discordFailure(error);
    }
  },
});
