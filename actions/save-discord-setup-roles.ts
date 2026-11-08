import { defineAction } from "@agent-native/core/action";
import { DiscordSnowflake } from "@shared/features/discord";
import { FeatureParticipant } from "@shared/features/types";
import { z } from "zod";

import {
  DiscordSetupSchema,
  saveSetupRoles,
} from "../server/features/discord-settings";
import { discordFailure } from "../server/features/discord-workflow";
import { featureErrors } from "../server/features/errors";
export default defineAction({
  description:
    "Save your personal responsibility-to-Discord-role defaults after verifying roles. Does not approve or send questions.",
  schema: z.object({
    mappings: z.partialRecord(z.enum(FeatureParticipant), DiscordSnowflake),
  }),
  outputSchema: DiscordSetupSchema,
  errors: featureErrors,
  run: async ({ mappings }) => {
    try {
      return await saveSetupRoles(mappings);
    } catch (error) {
      return discordFailure(error);
    }
  },
});
