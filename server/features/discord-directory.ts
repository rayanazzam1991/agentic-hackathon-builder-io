import {
  DiscordMemberCoverage,
  DiscordPersonVisibility,
  DiscordSnowflake,
  type DiscordDirectory,
  type DiscordDirectoryPerson,
  type DiscordPerson,
  type DiscordRole,
  type FeatureDiscord,
} from "@shared/features/discord";
import { z } from "zod";

import {
  DiscordApiError,
  Permission,
  discordApi,
  effectiveDiscordPermissions,
  listDiscordRoles,
} from "./discord-api";
import { featureErrors } from "./errors";

const PageSize = 500;
const MaxPages = 4;
const Member = z.object({
  user: z.object({
    id: DiscordSnowflake,
    username: z.string().min(1).max(100),
    global_name: z.string().max(100).nullish(),
    bot: z.boolean().optional(),
  }),
  nick: z.string().max(100).nullish(),
  roles: z.array(DiscordSnowflake).max(1000),
});
type Member = z.infer<typeof Member>;
const RoleNames = z
  .array(
    z.object({ id: DiscordSnowflake, name: z.string(), managed: z.boolean() }),
  )
  .max(1000);

type Api = Awaited<ReturnType<typeof discordApi>>;
interface Context {
  binding: FeatureDiscord;
  rawRoles: unknown;
  rawChannel: unknown;
  ownerId: string | null;
  names: Map<string, string>;
}

async function readContext(api: Api, binding: FeatureDiscord) {
  const [rawRoles, rawChannel] = await Promise.all([
    api(`/guilds/${binding.guildId}/roles`),
    api(`/channels/${binding.channelId}`),
  ]);
  const names = new Map(
    RoleNames.parse(rawRoles)
      .filter((role) => !role.managed)
      .map((role) => [role.id, role.name]),
  );
  // Only the owner can hold every permission without a role granting it.
  let ownerId: string | null = null;
  try {
    ownerId = z
      .object({ owner_id: DiscordSnowflake })
      .parse(await api(`/guilds/${binding.guildId}`)).owner_id;
  } catch {
    ownerId = null;
  }
  return { binding, rawRoles, rawChannel, ownerId, names } satisfies Context;
}

function permissionsOf(context: Context, member: unknown, id: string) {
  return effectiveDiscordPermissions(
    context.binding.guildId,
    id,
    context.rawRoles,
    member,
    context.rawChannel,
    context.binding.channelId,
  );
}
function visibilityOf(context: Context, member: Member) {
  if (member.user.id === context.ownerId)
    return DiscordPersonVisibility.VISIBLE;
  try {
    const bits = permissionsOf(context, member, member.user.id);
    return (bits & Permission.ADMINISTRATOR) !== 0n ||
      (bits & Permission.VIEW_CHANNEL) !== 0n
      ? DiscordPersonVisibility.VISIBLE
      : DiscordPersonVisibility.HIDDEN;
  } catch {
    return DiscordPersonVisibility.UNKNOWN;
  }
}
function personOf(context: Context, member: Member): DiscordPerson {
  const { user } = member;
  return {
    id: user.id,
    username: user.username,
    displayName: member.nick || user.global_name || user.username,
    roles: member.roles
      .filter((id) => context.names.has(id))
      .slice(0, 50)
      .map((id) => ({ id, name: context.names.get(id)! })),
  };
}

// Reads only; nothing here changes membership, roles or permissions.
export async function loadDiscordDirectory(
  binding: FeatureDiscord,
): Promise<DiscordDirectory> {
  const api = await discordApi();
  const [roles, context] = await Promise.all([
    listDiscordRoles(binding.guildId, binding),
    readContext(api, binding),
  ]);
  const limitations: string[] = [];
  if (!context.ownerId)
    limitations.push(
      "The server owner could not be identified, so the owner may be shown as unable to view the channel.",
    );
  const members: Member[] = [];
  let coverage: DiscordDirectory["coverage"]["members"] =
    DiscordMemberCoverage.COMPLETE;
  let after: string | undefined;
  let malformed = 0;
  for (let page = 0; ; page++) {
    if (page === MaxPages) {
      coverage = DiscordMemberCoverage.PARTIAL;
      limitations.push(
        `Only the first ${PageSize * MaxPages} server members were read. Select someone beyond that by Discord user ID.`,
      );
      break;
    }
    let raw: unknown[];
    try {
      raw = z
        .array(z.unknown())
        .parse(
          await api(
            `/guilds/${binding.guildId}/members?limit=${PageSize}${after ? `&after=${after}` : ""}`,
          ),
        );
    } catch (error) {
      if (!(error instanceof DiscordApiError) || error.status !== 403)
        throw error;
      coverage =
        page === 0
          ? DiscordMemberCoverage.UNAVAILABLE
          : DiscordMemberCoverage.PARTIAL;
      limitations.push(
        "Discord refused the member list. The bot's Server Members Intent is probably not enabled in the Discord Developer Portal, so people cannot be listed. You can still select a person by Discord user ID.",
      );
      break;
    }
    for (const item of raw) {
      const parsed = Member.safeParse(item);
      if (parsed.success) members.push(parsed.data);
      else malformed++;
    }
    const last = raw[raw.length - 1] as { user?: { id?: string } } | undefined;
    if (raw.length < PageSize || !last?.user?.id) break;
    after = last.user.id;
  }
  if (malformed)
    limitations.push(
      `${malformed} member record(s) could not be read and are not listed.`,
    );
  const people: DiscordDirectoryPerson[] = members
    .filter((member) => !member.user.bot)
    .map((member) => ({
      ...personOf(context, member),
      visibility: visibilityOf(context, member),
    }))
    .sort(
      (a, b) =>
        Number(b.visibility === DiscordPersonVisibility.VISIBLE) -
          Number(a.visibility === DiscordPersonVisibility.VISIBLE) ||
        a.displayName.localeCompare(b.displayName),
    );
  const count = (visibility: string) =>
    people.filter((person) => person.visibility === visibility).length;
  if (count(DiscordPersonVisibility.UNKNOWN))
    limitations.push(
      "Channel visibility could not be verified for some people. They cannot be selected.",
    );
  return {
    people,
    roles,
    coverage: {
      members: coverage,
      listed: people.length,
      visible: count(DiscordPersonVisibility.VISIBLE),
      hidden: count(DiscordPersonVisibility.HIDDEN),
      unknown: count(DiscordPersonVisibility.UNKNOWN),
      limitations,
    },
  };
}

// An individual is only a valid recipient while still a server member who can
// view the linked channel; a mention would not reach anyone else.
export async function verifyDiscordPerson(
  binding: FeatureDiscord,
  userId: string,
  shared?: { api: Api; context: Context },
): Promise<DiscordPerson> {
  DiscordSnowflake.parse(userId);
  const api = shared?.api ?? (await discordApi());
  const context = shared?.context ?? (await readContext(api, binding));
  let raw: unknown;
  try {
    raw = await api(`/guilds/${binding.guildId}/members/${userId}`);
  } catch (error) {
    if (error instanceof DiscordApiError && error.status === 404)
      throw featureErrors.noWrite(
        "That Discord user is not a member of the linked server. Choose another recipient; nothing was substituted.",
        "invalid_transition",
      );
    throw error;
  }
  const member = Member.parse(raw);
  if (member.user.bot)
    throw featureErrors.noWrite(
      "Bots cannot be question recipients. Choose a person.",
      "invalid_transition",
    );
  const visibility = visibilityOf(context, member);
  if (visibility === DiscordPersonVisibility.HIDDEN)
    throw featureErrors.noWrite(
      "That person cannot view the linked channel, so a mention would not notify them. Choose a role or another person, or ask a server administrator to grant channel access. Nothing was substituted.",
      "invalid_transition",
    );
  if (visibility === DiscordPersonVisibility.UNKNOWN)
    throw featureErrors.noWrite(
      "Could not verify this person's access to the linked channel. Retry when Discord is available. Nothing was substituted.",
      "discord_unavailable",
    );
  return personOf(context, member);
}

export async function verifyDiscordRole(
  binding: FeatureDiscord,
  roleId: string,
): Promise<DiscordRole> {
  DiscordSnowflake.parse(roleId);
  const role = (await listDiscordRoles(binding.guildId, binding)).find(
    (item) => item.id === roleId,
  );
  if (!role)
    throw featureErrors.noWrite(
      "That Discord role does not exist or cannot be selected. Reload the directory and choose an existing role; nothing was substituted.",
      "invalid_transition",
    );
  return role;
}

// The bot must be able to view and post in the channel to notify a person.
export async function assertBotCanNotifyPerson(
  binding: FeatureDiscord,
  userId: string,
) {
  const api = await discordApi();
  const context = await readContext(api, binding);
  await verifyDiscordPerson(binding, userId, { api, context });
  let bits: bigint;
  try {
    const member = await api(
      `/guilds/${binding.guildId}/members/${binding.botId}`,
    );
    bits = permissionsOf(context, member, binding.botId);
  } catch {
    throw featureErrors.noWrite(
      "Could not verify the bot's permission to post in this channel. Retry when Discord is available. Your draft is saved; nothing was sent.",
      "discord_unavailable",
    );
  }
  const needed = Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES;
  if ((bits & Permission.ADMINISTRATOR) === 0n && (bits & needed) !== needed)
    throw featureErrors.noWrite(
      "Discord denies this bot permission to post in this channel. Ask a server administrator to review the bot's effective channel permissions or choose another recipient. Your draft is saved; nothing was sent.",
      "invalid_transition",
    );
}
