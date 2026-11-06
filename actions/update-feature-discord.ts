import { defineAction, isActionContractError } from "@agent-native/core/action";
import { DiscordChangeSchema } from "@shared/features/discord";
import { FeatureWriteSchema, RevisionInput } from "@shared/features/types";

import {
  discordFailure,
  updateDiscord,
} from "../server/features/discord-workflow";
import { featureErrors } from "../server/features/errors";
import { featureLink } from "../server/features/links";
import { featureWriteReceipt } from "../server/features/receipt";
export default defineAction({
  description:
    "Connect a verified Discord text channel, map feature responsibilities to verified server role IDs, save an unsent targeted question draft, or explicitly record a fetched reply. Never posts a message or approves a decision.",
  schema: RevisionInput.extend({ change: DiscordChangeSchema }),
  outputSchema: FeatureWriteSchema,
  errors: featureErrors,
  link: featureLink,
  run: async ({ id, revision, change }) => {
    try {
      return featureWriteReceipt(
        await updateDiscord(id, revision, change),
        "Saved and verified the Discord review state. No message was sent.",
      );
    } catch (error) {
      if (isActionContractError(error)) throw error;
      return discordFailure(error);
    }
  },
});
