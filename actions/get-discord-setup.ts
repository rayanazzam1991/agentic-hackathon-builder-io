import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  DiscordSetupSchema,
  readDiscordSetup,
} from "../server/features/discord-settings";
export default defineAction({
  description:
    "Read your personal Discord channel and role defaults for this workspace. No credentials are returned.",
  schema: z.object({}),
  outputSchema: DiscordSetupSchema.nullable(),
  http: { method: "GET" },
  run: readDiscordSetup,
});
