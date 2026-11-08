import { getRequestOrgId } from "@agent-native/core/server/request-context";
import {
  deleteUserSetting,
  getUserSetting,
  mutateUserSetting,
} from "@agent-native/core/settings";
import {
  DiscordRoleMappingsSchema,
  DiscordSnowflake,
} from "@shared/features/discord";
import { z } from "zod";

import {
  DiscordApiError,
  listDiscordRoles,
  parseDiscordChannel,
  verifyDiscordChannel,
} from "./discord-api";
import { requireActor } from "./store";

export const DiscordSetupSchema = z.object({
  guildId: DiscordSnowflake,
  channelId: DiscordSnowflake,
  channelName: z.string(),
  botId: DiscordSnowflake,
  roleMappings: DiscordRoleMappingsSchema,
});
const key = () =>
  `feature-coordinator.discord.${getRequestOrgId() ?? "personal"}`;
export async function readDiscordSetup() {
  const actor = requireActor();
  const value = await getUserSetting(actor, key(), { bypassCache: true });
  return value ? DiscordSetupSchema.parse(value) : null;
}
export async function resetDiscordSetup() {
  const actor = requireActor();
  const settingKey = key();
  await deleteUserSetting(actor, settingKey);
  if (await getUserSetting(actor, settingKey, { bypassCache: true }))
    throw new DiscordApiError(
      "Discord settings changed during reset. Reload and try again.",
    );
  return { reset: true };
}
export async function connectDiscordSetup(channelUrl: string) {
  const actor = requireActor();
  const ids = parseDiscordChannel(channelUrl);
  const verified = await verifyDiscordChannel(ids.guildId, ids.channelId);
  const previous = await readDiscordSetup();
  const setup = {
    ...verified,
    roleMappings:
      previous?.guildId === verified.guildId &&
      previous.botId === verified.botId
        ? previous.roleMappings
        : {},
  };
  await mutateUserSetting(actor, key(), (current) => {
    if (
      JSON.stringify(current ? DiscordSetupSchema.parse(current) : null) !==
      JSON.stringify(previous)
    )
      throw new DiscordApiError(
        "Discord settings changed. Reload and try again.",
      );
    return setup;
  });
  return (await readDiscordSetup())!;
}
export async function readSetupRoles() {
  const setup = await readDiscordSetup();
  if (!setup)
    throw new DiscordApiError("Connect a Discord channel in settings first.");
  const verified = await verifyDiscordChannel(setup.guildId, setup.channelId);
  if (verified.botId !== setup.botId)
    throw new DiscordApiError(
      "The Discord bot changed. Reconnect the channel first.",
    );
  return listDiscordRoles(setup.guildId, setup);
}
export async function saveSetupRoles(mappings: Record<string, string>) {
  const actor = requireActor();
  const setup = await readDiscordSetup();
  if (!setup)
    throw new DiscordApiError("Connect a Discord channel in settings first.");
  const roles = await readSetupRoles();
  const resolved = Object.fromEntries(
    Object.entries(mappings).map(([responsibility, id]) => {
      const role = roles.find((item) => item.id === id);
      if (!role)
        throw new DiscordApiError(
          "A selected role is no longer available. Reload roles.",
        );
      return [responsibility, role];
    }),
  );
  const updated = DiscordSetupSchema.parse({
    ...setup,
    roleMappings: resolved,
  });
  await mutateUserSetting(actor, key(), (current) => {
    if (
      JSON.stringify(current ? DiscordSetupSchema.parse(current) : null) !==
      JSON.stringify(setup)
    )
      throw new DiscordApiError(
        "Discord settings changed. Reload and try again.",
      );
    return updated;
  });
  return (await readDiscordSetup())!;
}
export function setupToBinding(setup: z.infer<typeof DiscordSetupSchema>) {
  return {
    ...setup,
    delivery: null,
    replies: [],
    checkedAt: null,
    partial: false,
  };
}
