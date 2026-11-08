import { defineAction } from "@agent-native/core/action";
import { DiscordRoleSchema } from "@shared/features/discord";
import { z } from "zod";

import { readSetupRoles } from "../server/features/discord-settings";
import { discordFailure } from "../server/features/discord-workflow";
import { featureErrors } from "../server/features/errors";
export default defineAction({
  description:
    "Read available roles for your verified default Discord channel.",
  schema: z.object({}),
  outputSchema: z.array(DiscordRoleSchema).max(1000),
  errors: featureErrors,
  http: { method: "GET" },
  run: async () => {
    try {
      return await readSetupRoles();
    } catch (error) {
      return discordFailure(error);
    }
  },
});
