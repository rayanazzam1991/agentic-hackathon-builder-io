import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { resetDiscordSetup } from "../server/features/discord-settings";
import { discordFailure } from "../server/features/discord-workflow";
import { featureErrors } from "../server/features/errors";

export default defineAction({
  description:
    "Reset the caller's saved Discord channel and role defaults in the current workspace. Does not remove the bot token or change features, drafts, history or messages.",
  schema: z.object({}),
  outputSchema: z.object({ reset: z.boolean() }),
  errors: featureErrors,
  run: async () => {
    try {
      return await resetDiscordSetup();
    } catch (error) {
      return discordFailure(error);
    }
  },
});
