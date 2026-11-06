import { defineAction, isActionContractError } from "@agent-native/core/action";
import { DiscordRoleSchema } from "@shared/features/discord";
import { RevisionInput } from "@shared/features/types";
import { z } from "zod";

import {
  discordFailure,
  listFeatureDiscordRoles,
} from "../server/features/discord-workflow";
import { featureErrors } from "../server/features/errors";
export default defineAction({
  description:
    "List real selectable Discord server roles for an owned live feature's connected channel. Does not change roles or send messages.",
  schema: RevisionInput.pick({ id: true }),
  outputSchema: z.array(DiscordRoleSchema).max(1000),
  http: { method: "GET" },
  errors: featureErrors,
  run: async ({ id }) => {
    try {
      return await listFeatureDiscordRoles(id);
    } catch (error) {
      if (isActionContractError(error)) throw error;
      return discordFailure(error);
    }
  },
});
