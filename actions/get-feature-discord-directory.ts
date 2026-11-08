import { defineAction, isActionContractError } from "@agent-native/core/action";
import { DiscordDirectorySchema } from "@shared/features/discord";
import { RevisionInput } from "@shared/features/types";

import {
  discordFailure,
  getFeatureDiscordDirectory,
} from "../server/features/discord-workflow";
import { featureErrors } from "../server/features/errors";
export default defineAction({
  description:
    "Owner-only: list the Discord people and roles the bot can verify for an owned live feature's connected channel, with each person's role associations, whether they can view the channel, and explicit coverage limits. Discord membership never establishes approval authority. Reads only; does not change roles or permissions or send messages.",
  schema: RevisionInput.pick({ id: true }),
  outputSchema: DiscordDirectorySchema,
  http: { method: "GET" },
  errors: featureErrors,
  run: async ({ id }) => {
    try {
      return await getFeatureDiscordDirectory(id);
    } catch (error) {
      if (isActionContractError(error)) throw error;
      return discordFailure(error);
    }
  },
});
