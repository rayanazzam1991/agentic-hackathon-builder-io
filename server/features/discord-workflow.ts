import { fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import {
  DiscordChange,
  DiscordMentionPermission,
  DiscordDeliveryStatus,
  type FeatureDiscord,
  type DiscordRoleMappings,
} from "@shared/features/discord";
import type { DiscordChangeSchema } from "@shared/features/discord";
import {
  FeatureResource,
  FeatureParticipant,
  QuestionEvent,
  QuestionStatus,
  type Feature,
} from "@shared/features/types";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../db";
import {
  discordApi,
  listDiscordRoles,
  DiscordApiError,
  DiscordMessage,
  parseDiscordChannel,
  verifyDiscordChannel,
} from "./discord-api";
import { featureErrors } from "./errors";
import { changeQuestion, getFeature, requireActor } from "./store";

async function currentFeature(id: string, revision: number, owner = false) {
  requireActor();
  await assertAccess(FeatureResource.TYPE, id, owner ? "owner" : "editor");
  const current = await getFeature(id);
  if (current.revision !== revision)
    throw featureErrors.noWrite(
      "This feature changed. Review the latest version.",
      "stale_revision",
      { statusCode: 409 },
    );
  if (current.data.sample)
    throw featureErrors.noWrite(
      "Discord is available for live reviews only.",
      "invalid_transition",
    );
  return current;
}
async function save(current: Feature, discord: FeatureDiscord, detail: string) {
  const actor = requireActor();
  if (current.data.activity.length >= 100)
    fail("This review reached its activity limit.", {
      errorCode: "activity_limit",
    });
  const data = structuredClone(current.data);
  data.discord = discord;
  data.activity.push({
    id: crypto.randomUUID(),
    event: "Discord",
    actor,
    at: new Date().toISOString(),
    detail,
  });
  const [saved] = await getDb()
    .update(schema.features)
    .set({ data, revision: current.revision + 1 })
    .where(
      and(
        eq(schema.features.id, current.id),
        eq(schema.features.revision, current.revision),
      ),
    )
    .returning({ id: schema.features.id });
  if (!saved)
    fail("Another edit won the race. Review the saved state before retrying.", {
      errorCode: "stale_revision",
      statusCode: 409,
    });
  return getFeature(current.id);
}
function requireBinding(feature: Feature) {
  const binding = feature.data.discord;
  if (!binding)
    throw featureErrors.noWrite(
      "Connect a Discord channel first.",
      "invalid_transition",
    );
  return binding;
}
function requireDraftable(feature: Feature) {
  const status = feature.data.discord?.delivery?.status;
  if (
    feature.status !== QuestionStatus.OPEN ||
    (status && status !== DiscordDeliveryStatus.DRAFT)
  )
    throw featureErrors.noWrite(
      "A posted or pending question cannot be replaced. Resolve this review first.",
      "discord_delivery_pending",
    );
}
export function discordPermalink(
  guildId: string,
  channelId: string,
  messageId: string,
) {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}
export function discordFailure(error: unknown): never {
  fail(
    error instanceof DiscordApiError
      ? error.message
      : "Discord could not complete the operation. Refresh the review and check delivery before retrying.",
    { errorCode: "discord_unavailable", statusCode: 503 },
  );
}
export async function listFeatureDiscordRoles(id: string) {
  requireActor();
  await assertAccess(FeatureResource.TYPE, id, "owner");
  const feature = await getFeature(id);
  if (feature.data.sample)
    throw featureErrors.noWrite(
      "Discord is available for live reviews only.",
      "invalid_transition",
    );
  const binding = requireBinding(feature);
  return listDiscordRoles(binding.guildId, binding);
}

export async function updateDiscord(
  id: string,
  revision: number,
  change: z.infer<typeof DiscordChangeSchema>,
) {
  const current = await currentFeature(
    id,
    revision,
    change.event !== DiscordChange.RECORD,
  );
  if (change.event === DiscordChange.CONNECT) {
    requireDraftable(current);
    const ids = parseDiscordChannel(change.channelUrl);
    const verified = await verifyDiscordChannel(ids.guildId, ids.channelId);
    return save(
      current,
      {
        ...verified,
        delivery: null,
        replies: [],
        checkedAt: null,
        partial: false,
      },
      "Verified and connected a Discord text channel. No message was sent.",
    );
  }
  const binding = structuredClone(requireBinding(current));
  if (change.event === DiscordChange.ROLES) {
    const available = await listDiscordRoles(binding.guildId);
    const mappings: DiscordRoleMappings = {};
    for (const responsibility of Object.values(FeatureParticipant)) {
      const id = change.mappings[responsibility];
      if (!id) continue;
      const role = available.find((role) => role.id === id);
      if (!role)
        throw featureErrors.noWrite(
          "A selected Discord role is no longer available. Reload server roles.",
          "invalid_transition",
        );
      mappings[responsibility] = role;
    }
    binding.roleMappings = mappings;
    return save(
      current,
      binding,
      "Saved verified Discord role mappings. Existing message recipients are unchanged; save a new draft to apply the mapping.",
    );
  }
  if (change.event === DiscordChange.DRAFT) {
    requireDraftable(current);
    const mapped = binding.roleMappings?.[current.data.question.owner];
    // Drafts preserve the explicit recipient without requiring notification access.
    // Existence and effective permissions are rechecked before any real send.
    const recipientRole = mapped;
    const nonce = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
    binding.delivery = {
      ...(recipientRole ? { recipientRole } : {}),
      questionText: change.text,
      status: DiscordDeliveryStatus.DRAFT,
      nonce,
      content: `${recipientRole ? `<@&${recipientRole.id}> ` : ""}${change.text}\n\nFeature Coordinator reference: ${id}/${nonce}`,
      requestedAt: null,
      messageId: null,
    };
    return save(
      current,
      binding,
      "Saved a Discord question draft for human review. Not sent.",
    );
  }
  const candidate = binding.replies.find(
    (reply) => reply.id === change.messageId,
  );
  if (!candidate || !binding.delivery?.messageId)
    throw featureErrors.noWrite(
      "Check replies and select a response to this question.",
      "invalid_transition",
    );
  const api = await discordApi();
  const fresh = DiscordMessage.parse(
    await api(`/channels/${binding.channelId}/messages/${candidate.id}`),
  );
  if (
    fresh.channel_id !== binding.channelId ||
    fresh.author.bot ||
    fresh.author.id !== candidate.authorId ||
    fresh.message_reference?.message_id !== binding.delivery.messageId ||
    fresh.content !== candidate.text
  )
    throw featureErrors.noWrite(
      "This Discord reply changed. Check replies again before recording it.",
      "stale_revision",
      { statusCode: 409 },
    );
  return changeQuestion(
    id,
    revision,
    {
      event: QuestionEvent.REPLY,
      text: fresh.content,
      respondent: `${fresh.author.username} (${fresh.author.id})`,
    },
    candidate.url,
  );
}

export async function sendDiscordQuestion(id: string, revision: number) {
  let current = await currentFeature(id, revision, true);
  let binding = structuredClone(requireBinding(current));
  if (binding.delivery?.status === DiscordDeliveryStatus.SENT)
    return { feature: current, changed: false };
  if (
    current.status !== QuestionStatus.OPEN ||
    binding.delivery?.status !== DiscordDeliveryStatus.DRAFT
  )
    throw featureErrors.noWrite(
      "A question is already pending, or no draft is saved. Check the delivery before retrying.",
      "discord_delivery_pending",
    );
  // Check access before reserving. Only the reservation winner may perform POST.
  const verified = await verifyDiscordChannel(
    binding.guildId,
    binding.channelId,
  );
  if (verified.botId !== binding.botId)
    throw featureErrors.noWrite(
      "The bot identity changed. Reconnect the channel before sending.",
      "discord_unavailable",
    );
  if (current.data.activity.length >= 99)
    throw featureErrors.noWrite(
      "This review reached its activity limit.",
      "activity_limit",
    );
  if (binding.delivery.recipientRole) {
    const role = (await listDiscordRoles(binding.guildId, binding)).find(
      (role) => role.id === binding.delivery!.recipientRole!.id,
    );
    if (!role)
      throw featureErrors.noWrite(
        "The reviewed recipient role no longer exists or is unavailable. Reload roles, choose an available role, and save the draft again.",
        "invalid_transition",
      );
    if (role.mentionPermission === DiscordMentionPermission.DENIED)
      throw featureErrors.noWrite(
        "Discord denies this bot permission to notify the reviewed role in this channel. Ask a server administrator to review the bot's effective channel permissions or choose an authorized recipient, then retry. Your draft is saved; nothing was sent.",
        "invalid_transition",
      );
    if (role.mentionPermission !== DiscordMentionPermission.ALLOWED)
      throw featureErrors.noWrite(
        "Could not verify the bot's notification permission in this channel. Reload roles and retry when Discord is available. Your draft is saved; nothing was sent.",
        "discord_unavailable",
      );
  }
  const api = await discordApi();
  binding.delivery.status = DiscordDeliveryStatus.SENDING;
  binding.delivery.requestedAt = new Date().toISOString();
  current = await save(
    current,
    binding,
    "Reserved the reviewed Discord question for delivery. Delivery is not yet confirmed.",
  );
  binding = structuredClone(requireBinding(current));
  try {
    const result = DiscordMessage.parse(
      await api(`/channels/${binding.channelId}/messages`, {
        content: binding.delivery!.content,
        nonce: binding.delivery!.nonce,
        enforce_nonce: true,
        allowed_mentions: binding.delivery!.recipientRole
          ? {
              parse: [],
              roles: [binding.delivery!.recipientRole.id],
              users: [],
              replied_user: false,
            }
          : { parse: [] },
      }),
    );
    binding.delivery!.messageId = result.id;
    const confirmed = DiscordMessage.parse(
      await api(`/channels/${binding.channelId}/messages/${result.id}`),
    );
    if (
      confirmed.channel_id !== binding.channelId ||
      confirmed.author.id !== binding.botId ||
      confirmed.content !== binding.delivery!.content
    )
      throw new Error("Delivery readback mismatch.");
    binding.delivery!.status = DiscordDeliveryStatus.SENT;
    return {
      feature: await save(
        current,
        binding,
        "Confirmed the Discord question by reading back the sent message.",
      ),
      changed: true,
    };
  } catch {
    // A timeout can occur after Discord accepted POST. Never automatically repost.
    binding.delivery!.status = DiscordDeliveryStatus.UNCERTAIN;
    return {
      feature: await save(
        current,
        binding,
        "Discord delivery is unconfirmed. Use Check replies to reconcile; do not resend.",
      ),
      changed: true,
    };
  }
}

export async function checkDiscordReplies(id: string, revision: number) {
  const current = await currentFeature(id, revision);
  const binding = structuredClone(requireBinding(current));
  if (
    !binding.delivery ||
    binding.delivery.status === DiscordDeliveryStatus.DRAFT
  )
    throw featureErrors.noWrite(
      "Send the reviewed question first.",
      "invalid_transition",
    );
  if (
    binding.delivery.status === DiscordDeliveryStatus.SENDING &&
    binding.delivery.requestedAt &&
    Date.now() - Date.parse(binding.delivery.requestedAt) < 60000
  )
    throw featureErrors.noWrite(
      "Delivery is still in progress. Wait a minute before checking again.",
      "discord_delivery_pending",
    );
  const api = await discordApi();
  const messages = z
    .array(DiscordMessage)
    .max(100)
    .parse(await api(`/channels/${binding.channelId}/messages?limit=100`));
  if (
    !binding.delivery.messageId ||
    binding.delivery.status !== DiscordDeliveryStatus.SENT
  ) {
    const matching = messages.filter(
      (m) =>
        m.channel_id === binding.channelId &&
        m.author.id === binding.botId &&
        m.content === binding.delivery!.content,
    );
    if (matching.length === 1) {
      binding.delivery.messageId = matching[0]!.id;
      binding.delivery.status = DiscordDeliveryStatus.SENT;
    } else binding.delivery.status = DiscordDeliveryStatus.UNCERTAIN;
  }
  binding.replies = messages
    .filter(
      (m) =>
        m.channel_id === binding.channelId &&
        !m.author.bot &&
        !!m.content.trim() &&
        m.message_reference?.message_id === binding.delivery!.messageId,
    )
    .map((m) => ({
      id: m.id,
      authorId: m.author.id,
      author: m.author.username,
      text: m.content,
      at: m.timestamp,
      url: discordPermalink(binding.guildId, binding.channelId, m.id),
    }));
  binding.checkedAt = new Date().toISOString();
  binding.partial = messages.length === 100;
  return save(
    current,
    binding,
    "Checked the latest 100 channel messages for direct replies. No reply was automatically recorded or approved.",
  );
}
