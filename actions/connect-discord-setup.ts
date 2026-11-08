import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  connectDiscordSetup,
  DiscordSetupSchema,
} from "../server/features/discord-settings";
import { discordFailure } from "../server/features/discord-workflow";
import { featureErrors } from "../server/features/errors";
export default defineAction({
  description:
    "Verify and save your Discord channel as a personal default. Never sends messages.",
  schema: z.object({ channelUrl: z.string().url().max(500) }),
  outputSchema: DiscordSetupSchema,
  errors: featureErrors,
  run: async ({ channelUrl }) => {
    try {
      return await connectDiscordSetup(channelUrl);
    } catch (error) {
      return discordFailure(error);
    }
  },
});
