import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import { resolveSecretDetailed } from "@agent-native/core/server";
import {
  DiscordMentionPermission,
  DiscordRoleSchema,
  DiscordSnowflake,
} from "@shared/features/discord";
import { z } from "zod";

export class DiscordApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
export const DISCORD_BOT_SECRET = "FEATURE_COORDINATOR_DISCORD_BOT_TOKEN";
const origin = "https://discord.com";
export const DiscordMessage = z.object({
  id: DiscordSnowflake,
  channel_id: DiscordSnowflake,
  content: z.string().max(4000),
  timestamp: z.string(),
  author: z.object({
    id: DiscordSnowflake,
    username: z.string(),
    bot: z.boolean().optional(),
  }),
  message_reference: z
    .object({ message_id: DiscordSnowflake.nullish() })
    .nullish(),
});
export type DiscordMessage = z.infer<typeof DiscordMessage>;
export function parseDiscordChannel(url: string) {
  const parsed = new URL(url);
  const ids = /^\/channels\/(\d{17,20})\/(\d{17,20})\/?$/.exec(parsed.pathname);
  if (parsed.origin !== origin || parsed.username || parsed.password || !ids)
    throw new DiscordApiError("Use a Discord server channel URL.");
  return { guildId: ids[1]!, channelId: ids[2]! };
}
export async function discordApi() {
  const secret = await resolveSecretDetailed(DISCORD_BOT_SECRET);
  if (secret.lookupFailed)
    throw new DiscordApiError(
      "Discord credential storage is unavailable. Retry later.",
    );
  if (!secret.value || secret.source === "env")
    throw new DiscordApiError(
      "Save your Discord bot token in Settings → API keys.",
    );
  const token = secret.value;
  return async (path: string, body?: unknown) => {
    // Paths are constructed only by this adapter's validated-ID callers.
    if (
      !/^\/(?:users\/@me|guilds\/\d{17,20}(?:\/(?:roles|members\/\d{17,20}))?|guilds\/\d{17,20}\/members\?limit=500(?:&after=\d{17,20})?|channels\/\d{17,20}(?:\/messages(?:\/\d{17,20})?)?)(?:\?limit=100(?:&before=\d{17,20})?)?$/.test(
        path,
      )
    )
      throw new DiscordApiError("Unsupported Discord endpoint.");
    const response = await ssrfSafeFetch(
      `${origin}/api/v10${path}`,
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bot ${token}`,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20000),
      },
      {
        httpsOnly: true,
        followRedirects: false,
        assertUrlAllowed(url) {
          if (new URL(url).origin !== origin)
            throw new DiscordApiError("Discord destination mismatch.");
        },
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401)
        throw new DiscordApiError(
          "Discord rejected the bot token. Check the saved key.",
        );
      if (response.status === 403 || response.status === 404)
        throw new DiscordApiError(
          "The bot cannot access this channel. Check the server installation and channel permissions.",
          response.status,
        );
      if (response.status === 429)
        throw new DiscordApiError(
          "Discord is rate limited. Retry later; do not repeat a pending send.",
        );
      throw new DiscordApiError(
        "Discord could not complete the request.",
        response.status,
      );
    }
    if (!response.body)
      throw new DiscordApiError("Discord returned an empty response.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > 512 * 1024) {
          await reader.cancel();
          throw new DiscordApiError(
            "Discord response exceeds the supported size.",
          );
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  };
}
export async function verifyDiscordChannel(guildId: string, channelId: string) {
  DiscordSnowflake.parse(guildId);
  DiscordSnowflake.parse(channelId);
  const api = await discordApi();
  const [channel, bot] = await Promise.all([
    api(`/channels/${channelId}`),
    api("/users/@me"),
  ]);
  const info = z
    .object({
      id: DiscordSnowflake,
      guild_id: DiscordSnowflake,
      name: z.string(),
      type: z.number(),
    })
    .parse(channel);
  const identity = z
    .object({ id: DiscordSnowflake, bot: z.literal(true) })
    .parse(bot);
  if (info.id !== channelId || info.guild_id !== guildId || info.type !== 0)
    throw new DiscordApiError(
      "Select a standard text channel in the expected Discord server.",
    );
  return { guildId, channelId, channelName: info.name, botId: identity.id };
}

// This read never changes server roles or membership and excludes broad/bot roles.
export async function listDiscordRoles(
  guildId: string,
  context?: { channelId: string; botId: string },
) {
  if (context) {
    DiscordSnowflake.parse(context.channelId);
    DiscordSnowflake.parse(context.botId);
  }
  DiscordSnowflake.parse(guildId);
  const api = await discordApi();
  const raw = await api(`/guilds/${guildId}/roles`);
  const result = z
    .array(DiscordRoleSchema.extend({ managed: z.boolean() }))
    .max(1000)
    .safeParse(raw);
  if (!result.success) {
    console.warn(
      "Discord role schema mismatch",
      result.error.issues.map((issue) => ({
        path: issue.path,
        code: issue.code,
      })),
    );
    throw new DiscordApiError(
      "Discord returned unsupported role data. Check the local integration log.",
    );
  }
  const roles = result.data;
  let permissions: bigint | undefined;
  if (context) {
    try {
      const [member, channel] = await Promise.all([
        api(`/guilds/${guildId}/members/${context.botId}`),
        api(`/channels/${context.channelId}`),
      ]);
      permissions = effectiveDiscordPermissions(
        guildId,
        context.botId,
        raw,
        member,
        channel,
        context.channelId,
      );
    } catch {
      // A failed permission read is not evidence of a denied mention.
      permissions = undefined;
    }
  }
  return roles
    .filter((role) => role.id !== guildId && !role.managed)
    .map(({ id, name, mentionable }) => ({
      id,
      name,
      mentionable,
      ...(context
        ? {
            mentionPermission:
              permissions === undefined
                ? DiscordMentionPermission.UNKNOWN
                : (permissions & Permission.ADMINISTRATOR) !== 0n ||
                    ((permissions &
                      (Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES)) ===
                      (Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES) &&
                      (mentionable ||
                        (permissions & Permission.MENTION_EVERYONE) !== 0n))
                  ? DiscordMentionPermission.ALLOWED
                  : DiscordMentionPermission.DENIED,
          }
        : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const Permission = {
  ADMINISTRATOR: 1n << 3n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  MENTION_EVERYONE: 1n << 17n,
} as const;
const bitfield = z
  .string()
  .regex(/^\d{1,30}$/)
  .transform(BigInt);
// Discord ordering: everyone, combined role overwrites, then member overwrite.
export function effectiveDiscordPermissions(
  guildId: string,
  botId: string,
  rawRoles: unknown,
  rawMember: unknown,
  rawChannel: unknown,
  channelId: string,
) {
  const roles = z
    .array(z.object({ id: DiscordSnowflake, permissions: bitfield }))
    .max(1000)
    .parse(rawRoles);
  const member = z
    .object({
      user: z.object({ id: z.literal(botId) }),
      roles: z.array(DiscordSnowflake).max(1000),
    })
    .parse(rawMember);
  const channel = z
    .object({
      id: z.literal(channelId),
      guild_id: z.literal(guildId),
      type: z.literal(0),
      permission_overwrites: z
        .array(
          z.object({
            id: DiscordSnowflake,
            type: z.union([z.literal(0), z.literal(1)]),
            allow: bitfield,
            deny: bitfield,
          }),
        )
        .max(1000),
    })
    .parse(rawChannel);
  const ids = new Set([guildId, ...member.roles]);
  if ([...ids].some((id) => !roles.some((role) => role.id === id)))
    throw new DiscordApiError("Incomplete Discord permission data.");
  let permissions = roles
    .filter((role) => ids.has(role.id))
    .reduce((bits, role) => bits | role.permissions, 0n);
  if (permissions & Permission.ADMINISTRATOR) return permissions;
  const apply = (overwrites: typeof channel.permission_overwrites) => {
    const deny = overwrites.reduce((bits, item) => bits | item.deny, 0n);
    const allow = overwrites.reduce((bits, item) => bits | item.allow, 0n);
    permissions = (permissions & ~deny) | allow;
  };
  apply(
    channel.permission_overwrites.filter(
      (item) => item.type === 0 && item.id === guildId,
    ),
  );
  apply(
    channel.permission_overwrites.filter(
      (item) => item.type === 0 && item.id !== guildId && ids.has(item.id),
    ),
  );
  apply(
    channel.permission_overwrites.filter(
      (item) => item.type === 1 && item.id === botId,
    ),
  );
  return permissions;
}
