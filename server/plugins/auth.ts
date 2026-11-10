import { createToolkitAuthPlugin } from "@agent-native/toolkit/app/auth/server";

export default createToolkitAuthPlugin({
  // The scheduler authenticates with DISCORD_FOLLOWUPS_SECRET, not a session.
  publicPaths: ["/api/discord-followups/run"],
  workspaceAppPublicPaths: ["/"],
  rootAuth: true,
  marketing: false,
});
