import { registerRequiredSecret } from "@agent-native/core/secrets";

import { DISCORD_BOT_SECRET } from "../features/discord-api";
registerRequiredSecret({
  key: DISCORD_BOT_SECRET,
  label: "Discord bot token",
  description:
    "Posts approved feature questions and reads replies in a selected Discord channel.",
  docsUrl: "https://discord.com/developers/applications",
  scope: "user",
  kind: "api-key",
  required: false,
});
export default () => {};
