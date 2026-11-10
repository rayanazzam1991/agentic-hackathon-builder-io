import { fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import {
  DiscordChange,
  DiscordFollowUpStatus,
  DiscordMentionPermission,
  DiscordDeliveryStatus,
  DiscordSnowflake,
  type DiscordFollowUp,
  type FeatureDiscord,
  type DiscordPerson,
  type DiscordRole,
  type DiscordRoleMappings,
  type DiscordThreadState,
} from "@shared/features/discord";
import type { DiscordChangeSchema } from "@shared/features/discord";
import { recipientKey } from "@shared/features/questions";
import {
  FeatureResource,
  FeatureParticipant,
  PrimaryQuestionId,
  QuestionAskApproval,
  QuestionEvent,
  QuestionRecipientState,
  QuestionStatus,
  QuestionSuggestionStatus,
  type Feature,
  type FeatureData,
  type FeatureQuestionItem,
} from "@shared/features/types";
import { and, eq } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
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
import {
  assertBotCanNotifyPerson,
  loadDiscordDirectory,
} from "./discord-directory";
import { featureErrors } from "./errors";
import { buildFollowUp } from "./discord-followup-schedule";
import { readDiscordSetup, readSetupRoles, setupToBinding } from "./discord-settings";
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
// Compare-and-set write; null means another edit won the race.
async function trySaveData(
  current: Feature,
  data: FeatureData,
  detail: string,
  options: { silentAtLimit?: boolean; silent?: boolean } = {},
) {
  const actor = requireActor();
  if (!options.silent) {
    if (data.activity.length >= 100) {
      if (!options.silentAtLimit)
        fail("This review reached its activity limit.", {
          errorCode: "activity_limit",
        });
    } else
      data.activity.push({
        id: crypto.randomUUID(),
        event: "Discord",
        actor,
        at: new Date().toISOString(),
        detail,
      });
  }
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
  return saved ? getFeature(current.id) : null;
}
async function saveData(
  current: Feature,
  data: FeatureData,
  detail: string,
  options: { silent?: boolean } = {},
) {
  const saved = await trySaveData(current, data, detail, options);
  if (!saved)
    fail("Another edit won the race. Review the saved state before retrying.", {
      errorCode: "stale_revision",
      statusCode: 409,
    });
  return saved;
}
export async function applyDiscordSetup(id: string, revision: number) {
  const current = await currentFeature(id, revision, true);
  if (current.data.discord)
    throw featureErrors.noWrite("This feature already has a Discord channel. Its existing setup and history were not changed.", "invalid_transition", { statusCode: 409 });
  const setup = await readDiscordSetup();
  if (!setup)
    throw featureErrors.noWrite("Set up Discord in Settings first.", "invalid_transition");
  const roles = await readSetupRoles();
  if (Object.values(setup.roleMappings).some((role) => !roles.some((available) => available.id === role.id)))
    throw featureErrors.noWrite("A saved Discord role is no longer available. Update settings first.", "invalid_transition");
  const data = structuredClone(current.data);
  data.discord = setupToBinding(setup);
  return saveData(current, data, "Applied personal Discord defaults. No message was sent.");
}
async function save(current: Feature, discord: FeatureDiscord, detail: string) {
  const data = structuredClone(current.data);
  data.discord = discord;
  return saveData(current, data, detail);
}
function findQuestion(data: FeatureData, questionId: string) {
  const question = data.questions?.find((q) => q.id === questionId);
  if (!question)
    throw featureErrors.noWrite(
      "Suggested question not found.",
      "suggestion_not_found",
      { statusCode: 404 },
    );
  return question;
}
// Applies a change to one question's Discord thread on the latest saved
// revision, so concurrent deliveries of other questions never block or
// overwrite each other. Used after a reservation, when the outcome of an
// outbound request must be recorded regardless of unrelated edits.
async function updateQuestionThread(
  id: string,
  questionId: string,
  mutate: (thread: NonNullable<FeatureQuestionItem["discord"]>) => void,
  detail: string,
) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const fresh = await getFeature(id);
    const data = structuredClone(fresh.data);
    const question = findQuestion(data, questionId);
    if (!question.discord)
      throw featureErrors.noWrite(
        "This question has no Discord thread.",
        "invalid_transition",
      );
    mutate(question.discord);
    const saved = await trySaveData(fresh, data, detail, {
      silentAtLimit: true,
    });
    if (saved) return saved;
  }
  fail("Another edit won the race. Review the saved state before retrying.", {
    errorCode: "stale_revision",
    statusCode: 409,
  });
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
const hasLeftDraft = (q: FeatureQuestionItem) =>
  !!q.discord?.delivery &&
  q.discord.delivery.status !== DiscordDeliveryStatus.DRAFT;
function requireNoQuestionDelivery(feature: Feature) {
  if (feature.data.questions?.some(hasLeftDraft))
    throw featureErrors.noWrite(
      "A suggested question was already posted or is pending. Its channel cannot be replaced.",
      "discord_delivery_pending",
    );
}
export async function assertRecipientNotifiable(
  binding: FeatureDiscord,
  delivery: {
    recipientRole?: DiscordRole | undefined;
    recipientPerson?: DiscordPerson | undefined;
  },
) {
  if (delivery.recipientPerson) {
    await assertBotCanNotifyPerson(binding, delivery.recipientPerson.id);
    return;
  }
  if (!delivery.recipientRole) return;
  const role = (await listDiscordRoles(binding.guildId, binding)).find(
    (role) => role.id === delivery.recipientRole!.id,
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
export function allowedMentions(delivery: {
  recipientRole?: { id: string } | undefined;
  recipientPerson?: { id: string } | undefined;
}) {
  if (delivery.recipientPerson)
    return {
      parse: [],
      roles: [],
      users: [delivery.recipientPerson.id],
      replied_user: false,
    };
  return delivery.recipientRole
    ? {
        parse: [],
        roles: [delivery.recipientRole.id],
        users: [],
        replied_user: false,
      }
    : { parse: [] };
}
const DiscordContentLimit = 2000;
const SourceLabel: Record<string, string> = {
  confluence: "Confluence",
  jira: "Jira",
  figma: "Figma",
  stitch: "Stitch",
};
// Evidence is quoted so the recipient sees where the question came from.
// Sources are only called a possible conflict when several are cited.
function evidenceSection(
  evidence: FeatureQuestionItem["evidence"],
  room: number,
) {
  if (!evidence.length || room < 120) return "";
  const heading =
    new Set(evidence.map((e) => e.source)).size > 1
      ? "Possible conflict between sources:"
      : "Evidence:";
  const link = (e: FeatureQuestionItem["evidence"][number]) =>
    e.url ? `\n  <${e.url}>` : "";
  const label = (e: FeatureQuestionItem["evidence"][number]) =>
    `• ${SourceLabel[e.source] ?? e.source}${e.version ? ` (${e.version})` : ""}: `;
  const fixed = evidence.reduce(
    (sum, e) => sum + label(e).length + link(e).length + 4,
    heading.length + 2,
  );
  const each = Math.floor((room - fixed) / evidence.length);
  if (each < 40) return "";
  const lines = evidence.map((e) => {
    const quote = e.excerpt.replace(/\s+/g, " ").trim();
    const cut = quote.length > each ? `${quote.slice(0, each - 1)}…` : quote;
    return `${label(e)}"${cut}"${link(e)}`;
  });
  return `\n\n${heading}\n${lines.join("\n")}`;
}
function questionContent(
  featureId: string,
  question: FeatureQuestionItem,
  mention: string,
  nonce: string,
) {
  const head = `${mention} ${question.text}`;
  const footer = `\n\nFeature Coordinator reference: ${featureId}/${question.id}/${nonce}`;
  const room = DiscordContentLimit - head.length - footer.length;
  return `${head}${evidenceSection(question.evidence, room)}${footer}`;
}
// Snapshots the approved text, recipient role and channel of one suggested
// question. Later mapping or channel changes never retarget the snapshot.
async function draftSuggestedQuestion(current: Feature, questionId: string) {
  const binding = requireBinding(current);
  const data = structuredClone(current.data);
  const question = findQuestion(data, questionId);
  if (hasLeftDraft(question))
    throw featureErrors.noWrite(
      "This question was already posted or is pending. Its history is preserved.",
      "discord_delivery_pending",
    );
  assertSendable(question);
  const { role, person } = question.recipient;
  const mention = person ? `<@${person.id}>` : `<@&${role!.id}>`;
  const nonce = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  question.discord = {
    delivery: {
      ...(person ? { recipientPerson: person } : { recipientRole: role! }),
      channelId: binding.channelId,
      questionText: question.text,
      status: DiscordDeliveryStatus.DRAFT,
      nonce,
      content: questionContent(current.id, question, mention, nonce),
      requestedAt: null,
      messageId: null,
    },
    replies: [],
    checkedAt: null,
    partial: false,
  };
  return saveData(
    current,
    data,
    "Saved a Discord draft for one approved question. Not sent.",
  );
}
// The owner's ask approval covers exactly this text and recipient.
function assertSendable(question: FeatureQuestionItem) {
  if (question.suggestion.status === QuestionSuggestionStatus.DISMISSED)
    throw featureErrors.noWrite(
      "Restore this dismissed question before sending it.",
      "invalid_transition",
    );
  if (question.askApproval.status !== QuestionAskApproval.APPROVED)
    throw featureErrors.noWrite(
      "The owner must approve asking this question first.",
      "invalid_transition",
    );
  if (
    question.status !== QuestionStatus.OPEN ||
    question.recipient.status !== QuestionRecipientState.SELECTED ||
    !recipientKey(question.recipient)
  )
    throw featureErrors.noWrite(
      "This question needs an open status and a selected recipient.",
      "invalid_transition",
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

// Owner-only read of the people and roles this bot can verify for the linked
// channel. Coverage and its limits are reported, never assumed complete.
export async function getFeatureDiscordDirectory(id: string) {
  requireActor();
  await assertAccess(FeatureResource.TYPE, id, "owner");
  const feature = await getFeature(id);
  if (feature.data.sample)
    throw featureErrors.noWrite(
      "Discord is available for live reviews only.",
      "invalid_transition",
    );
  return loadDiscordDirectory(requireBinding(feature));
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
    requireNoQuestionDelivery(current);
    const ids = parseDiscordChannel(change.channelUrl);
    const verified = await verifyDiscordChannel(ids.guildId, ids.channelId);
    const data = structuredClone(current.data);
    data.discord = {
      ...verified,
      delivery: null,
      replies: [],
      checkedAt: null,
      partial: false,
    };
    // A reviewed draft belongs to the channel it was snapshotted for.
    for (const question of data.questions ?? []) delete question.discord;
    return saveData(
      current,
      data,
      "Verified and connected a Discord text channel. No message was sent.",
    );
  }
  if (change.event === DiscordChange.QUESTION_DRAFT)
    return draftSuggestedQuestion(current, change.questionId);
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
    !fresh.message_reference?.message_id ||
    (fresh.message_reference.message_id !== binding.delivery.messageId &&
      fresh.message_reference.message_id !== binding.followUp?.followUpMessageId) ||
    fresh.content !== candidate.text
  )
    throw featureErrors.noWrite(
      "This Discord reply changed. Check replies again before recording it.",
      "stale_revision",
      { statusCode: 409 },
    );
  const updated = await changeQuestion(
    id,
    revision,
    {
      event: QuestionEvent.REPLY,
      text: fresh.content,
      respondent: `${fresh.author.username} (${fresh.author.id})`,
    },
    candidate.url,
  );
  const followUp = updated.data.discord?.followUp;
  if (
    followUp &&
    (followUp.status === DiscordFollowUpStatus.SCHEDULED ||
      followUp.status === DiscordFollowUpStatus.UNVERIFIED ||
      followUp.status === DiscordFollowUpStatus.SENDING)
  ) {
    const binding = structuredClone(requireBinding(updated));
    binding.followUp = {
      ...followUp,
      status: DiscordFollowUpStatus.ANSWERED,
      stoppedAt: new Date().toISOString(),
      answeredBy: `${fresh.author.username} (${fresh.author.id})`,
      answeredAt: fresh.timestamp,
      replyId: fresh.id,
      lastError: null,
      reason:
        "The owner recorded this Discord reply; the pending follow-up was stopped.",
    };
    return save(
      updated,
      binding,
      "Recorded a Discord reply. The pending follow-up was stopped.",
    );
  }
  return updated;
}

export async function sendDiscordQuestion(
  id: string,
  revision: number,
  questionId?: string,
  followUpHours?: number,
) {
  if (questionId && questionId !== PrimaryQuestionId)
    return sendSuggestedQuestion(id, revision, questionId, followUpHours);
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
  if (
    followUpHours &&
    !binding.delivery.recipientRole &&
    !binding.delivery.recipientPerson
  )
    throw featureErrors.noWrite(
      "Choose a recipient before enabling a follow-up.",
      "invalid_transition",
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
  await assertRecipientNotifiable(binding, binding.delivery);
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
        allowed_mentions: allowedMentions(binding.delivery!),
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
    if (followUpHours)
      binding.followUp = buildFollowUp({
        featureId: id,
        questionId: PrimaryQuestionId,
        questionText: current.data.question.text,
        guildId: binding.guildId,
        channelId: binding.channelId,
        delivery: binding.delivery!,
        hours: followUpHours,
        now: new Date(),
        actor: requireActor(),
        messageAt: result.timestamp,
      });
    return {
      feature: await save(
        current,
        binding,
        followUpHours
          ? `Confirmed the Discord question by reading back the sent message. One automatic follow-up is scheduled in ${followUpHours} hour(s).`
          : "Confirmed the Discord question by reading back the sent message.",
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

async function sendSuggestedQuestion(
  id: string,
  revision: number,
  questionId: string,
  followUpHours?: number,
) {
  const current = await currentFeature(id, revision, true);
  const binding = requireBinding(current);
  const question = findQuestion(current.data, questionId);
  const reviewed = question.discord?.delivery;
  if (reviewed?.status === DiscordDeliveryStatus.SENT)
    return { feature: current, changed: false };
  if (!reviewed || reviewed.status !== DiscordDeliveryStatus.DRAFT)
    throw featureErrors.noWrite(
      reviewed
        ? "This question is already pending. Check the delivery before retrying."
        : "Save a draft for this question and review it first.",
      "discord_delivery_pending",
    );
  assertSendable(question);
  // The owner's approval and the reviewed snapshot must still describe the
  // same question, recipient and channel.
  if (
    reviewed.questionText !== question.text ||
    recipientKey({
      status: QuestionRecipientState.SELECTED,
      ...(reviewed.recipientPerson
        ? { person: reviewed.recipientPerson }
        : { role: reviewed.recipientRole }),
    }) !== recipientKey(question.recipient) ||
    reviewed.channelId !== binding.channelId
  )
    throw featureErrors.noWrite(
      "The question, recipient or channel changed after review. Save a new draft and review it again.",
      "invalid_transition",
    );
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
  await assertRecipientNotifiable(binding, reviewed);
  const api = await discordApi();
  const data = structuredClone(current.data);
  const reserved = findQuestion(data, questionId).discord!.delivery!;
  reserved.status = DiscordDeliveryStatus.SENDING;
  reserved.requestedAt = new Date().toISOString();
  // Only the revision winner may reach POST.
  await saveData(
    current,
    data,
    "Reserved one reviewed Discord question for delivery. Delivery is not yet confirmed.",
  );
  let messageId: string | null = null;
  let messageAt: string | null = null;
  try {
    const result = DiscordMessage.parse(
      await api(`/channels/${binding.channelId}/messages`, {
        content: reviewed.content,
        nonce: reviewed.nonce,
        enforce_nonce: true,
        allowed_mentions: allowedMentions(reviewed),
      }),
    );
    messageId = result.id;
    messageAt = result.timestamp;
    const confirmed = DiscordMessage.parse(
      await api(`/channels/${binding.channelId}/messages/${result.id}`),
    );
    if (
      confirmed.channel_id !== binding.channelId ||
      confirmed.author.id !== binding.botId ||
      confirmed.content !== reviewed.content
    )
      throw new Error("Delivery readback mismatch.");
  } catch {
    // A timeout can occur after Discord accepted POST. Never automatically repost.
    return {
      feature: await updateQuestionThread(
        id,
        questionId,
        (thread) => {
          thread.delivery!.status = DiscordDeliveryStatus.UNCERTAIN;
          thread.delivery!.messageId = messageId;
        },
        "Discord delivery of one question is unconfirmed. Use Check replies on it to reconcile; do not resend.",
      ),
      changed: true,
    };
  }
  return {
    feature: await updateQuestionThread(
      id,
      questionId,
      (thread) => {
        thread.delivery!.status = DiscordDeliveryStatus.SENT;
        thread.delivery!.messageId = messageId;
        if (followUpHours)
          thread.followUp = buildFollowUp({
            featureId: id,
            questionId,
            questionText: question.text,
            guildId: binding.guildId,
            channelId: binding.channelId,
            delivery: thread.delivery!,
            hours: followUpHours,
            now: new Date(),
            actor: requireActor(),
            messageAt,
          });
      },
      followUpHours
        ? `Confirmed one Discord question by reading back the sent message. One automatic follow-up is scheduled in ${followUpHours} hour(s).`
        : "Confirmed one Discord question by reading back the sent message.",
    ),
    changed: true,
  };
}

function assertScannable(thread: {
  delivery: FeatureDiscord["delivery"];
}): asserts thread is { delivery: NonNullable<FeatureDiscord["delivery"]> } {
  if (
    !thread.delivery ||
    thread.delivery.status === DiscordDeliveryStatus.DRAFT
  )
    throw featureErrors.noWrite(
      "Send the reviewed question first.",
      "invalid_transition",
    );
  if (
    thread.delivery.status === DiscordDeliveryStatus.SENDING &&
    thread.delivery.requestedAt &&
    Date.now() - Date.parse(thread.delivery.requestedAt) < 60000
  )
    throw featureErrors.noWrite(
      "Delivery is still in progress. Wait a minute before checking again.",
      "discord_delivery_pending",
    );
}
async function scanChannel(binding: FeatureDiscord) {
  const api = await discordApi();
  return z
    .array(DiscordMessage)
    .max(100)
    .parse(await api(`/channels/${binding.channelId}/messages?limit=100`));
}
// Reconciles one thread's delivery (matched by its unique nonce-bearing
// content) and captures direct human replies to its message only.
function applyScan(
  thread: DiscordThreadState,
  binding: FeatureDiscord,
  messages: z.infer<typeof DiscordMessage>[],
) {
  const delivery = thread.delivery!;
  if (!delivery.messageId || delivery.status !== DiscordDeliveryStatus.SENT) {
    const matching = messages.filter(
      (m) =>
        m.channel_id === binding.channelId &&
        m.author.id === binding.botId &&
        m.content === delivery.content,
    );
    if (matching.length === 1) {
      delivery.messageId = matching[0]!.id;
      delivery.status = DiscordDeliveryStatus.SENT;
    } else delivery.status = DiscordDeliveryStatus.UNCERTAIN;
  }
  const captured = messages
    .filter(
      (m) =>
        m.channel_id === binding.channelId &&
        !m.author.bot &&
        !!m.content.trim() &&
        !!m.message_reference?.message_id &&
        (m.message_reference.message_id === delivery.messageId ||
          m.message_reference.message_id === thread.followUp?.followUpMessageId),
    )
    .map((m) => ({
      id: m.id,
      authorId: m.author.id,
      author: m.author.username,
      text: m.content,
      at: m.timestamp,
      url: discordPermalink(binding.guildId, binding.channelId, m.id),
    }));
  // Keep earlier captures when they leave the bounded channel scan. Refresh
  // captures still in the batch so edits and deleted messages are not trusted.
  const scannedIds = new Set(messages.map((message) => message.id));
  thread.replies = [...captured, ...thread.replies.filter((reply) => !scannedIds.has(reply.id))]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 100);
  thread.checkedAt = new Date().toISOString();
  thread.partial = messages.length === 100;
}

type FollowUpReplyDecision =
  | {
      status: "answered";
      reply: { id: string; author: string; at: string };
    }
  | { status: "unverified"; reason: string }
  | null;

/** Positive reply evidence only: a manual check never turns "no reply seen"
 * into a cancellation. Membership is verified for role recipients; a fetch
 * failure becomes actionable `unverified` rather than an answer. */
async function evaluateFollowUpFromMessages(
  followUp: DiscordFollowUp | null | undefined,
  binding: FeatureDiscord,
  messages: z.infer<typeof DiscordMessage>[],
): Promise<FollowUpReplyDecision> {
  if (
    !followUp ||
    (followUp.status !== DiscordFollowUpStatus.SCHEDULED &&
      followUp.status !== DiscordFollowUpStatus.UNVERIFIED)
  )
    return null;
  const direct = messages.filter(
    (message) =>
      message.channel_id === binding.channelId &&
      !message.author.bot &&
      !!message.content.trim() &&
      message.message_reference?.message_id === followUp.messageId,
  );
  if (followUp.recipientPerson) {
    const match = direct.find(
      (message) => message.author.id === followUp.recipientPerson!.id,
    );
    return match
      ? {
          status: "answered",
          reply: {
            id: match.id,
            author: match.author.username,
            at: match.timestamp,
          },
        }
      : null;
  }
  if (!followUp.recipientRole) return null;
  const api = await discordApi();
  const checked = new Set<string>();
  for (const message of direct) {
    if (checked.has(message.author.id)) continue;
    checked.add(message.author.id);
    try {
      const member = z
        .object({ roles: z.array(DiscordSnowflake).max(1000) })
        .parse(
          await api(`/guilds/${binding.guildId}/members/${message.author.id}`),
        );
      if (member.roles.includes(followUp.recipientRole.id))
        return {
          status: "answered",
          reply: {
            id: message.id,
            author: message.author.username,
            at: message.timestamp,
          },
        };
    } catch (error) {
      if (error instanceof DiscordApiError && error.status === 404) continue;
      return {
        status: "unverified",
        reason:
          "Could not verify whether a replying member holds the reviewed role. The follow-up was not sent automatically.",
      };
    }
  }
  return null;
}

function applyFollowUpDecision(
  thread: DiscordThreadState,
  decision: FollowUpReplyDecision,
) {
  const followUp = thread.followUp;
  if (
    !decision ||
    !followUp ||
    (followUp.status !== DiscordFollowUpStatus.SCHEDULED &&
      followUp.status !== DiscordFollowUpStatus.UNVERIFIED)
  )
    return;
  const now = new Date().toISOString();
  if (decision.status === "answered") {
    followUp.status = DiscordFollowUpStatus.ANSWERED;
    followUp.stoppedAt = now;
    followUp.answeredBy = decision.reply.author;
    followUp.answeredAt = decision.reply.at;
    followUp.replyId = decision.reply.id;
    followUp.reason = "A qualifying reply arrived before the follow-up was sent.";
    followUp.lastError = null;
    return;
  }
  followUp.status = DiscordFollowUpStatus.UNVERIFIED;
  followUp.lastError = decision.reason;
  followUp.reason = decision.reason;
}

export async function checkDiscordReplies(
  id: string,
  revision: number,
  questionId?: string,
) {
  const current = await currentFeature(id, revision);
  const binding = structuredClone(requireBinding(current));
  if (questionId && questionId !== PrimaryQuestionId) {
    const known = findQuestion(current.data, questionId);
    assertScannable(known.discord ?? { delivery: null });
    const messages = await scanChannel(binding);
    const decision = await evaluateFollowUpFromMessages(
      known.discord?.followUp,
      binding,
      messages,
    );
    // Re-read so a concurrent delivery of another question is not overwritten.
    return updateQuestionThread(
      id,
      questionId,
      (thread) => {
        applyScan(thread, binding, messages);
        applyFollowUpDecision(thread, decision);
      },
      "Checked the latest 100 channel messages for direct replies to one question. No reply was automatically recorded or approved.",
    );
  }
  assertScannable(binding);
  const messages = await scanChannel(binding);
  const decision = await evaluateFollowUpFromMessages(
    binding.followUp,
    binding,
    messages,
  );
  applyScan(binding, binding, messages);
  applyFollowUpDecision(binding, decision);
  return save(
    current,
    binding,
    "Checked the latest 100 channel messages for direct replies. No reply was automatically recorded or approved.",
  );
}

function isScannableThread(thread: DiscordThreadState) {
  const delivery = thread.delivery;
  if (!delivery || delivery.status === DiscordDeliveryStatus.DRAFT) return false;
  if (
    delivery.status === DiscordDeliveryStatus.SENDING &&
    delivery.requestedAt &&
    Date.now() - Date.parse(delivery.requestedAt) < 60000
  )
    return false;
  return true;
}

/**
 * One channel read that refreshes replies for every sent question. Used by the
 * feature page's foreground refresh; it never records an answer or approves.
 * The save is silent so periodic refreshes cannot exhaust the activity limit.
 */
export async function syncDiscordReplies(id: string) {
  requireActor();
  await assertAccess(FeatureResource.TYPE, id, "editor");
  let current = await getFeature(id);
  if (current.data.sample) return { feature: current, changed: false };
  for (let attempt = 0; attempt < 3; attempt++) {
    const data = structuredClone(current.data);
    const binding = requireBinding({ ...current, data });
    const entries: DiscordThreadState[] = [];
    if (isScannableThread(binding)) entries.push(binding);
    for (const question of data.questions ?? [])
      if (question.discord && isScannableThread(question.discord))
        entries.push(question.discord);
    if (!entries.length) return { feature: current, changed: false };
    const messages = await scanChannel(binding);
    let changed = false;
    for (const thread of entries) {
      const before = structuredClone(thread);
      const decision = await evaluateFollowUpFromMessages(
        thread.followUp,
        binding,
        messages,
      );
      applyScan(thread, binding, messages);
      applyFollowUpDecision(thread, decision);
      const checkedAt = thread.checkedAt;
      thread.checkedAt = before.checkedAt;
      // Write immediately for a real change. Persist an unchanged scan's
      // timestamp at most once a minute to avoid competing with user edits.
      if (
        !before.checkedAt ||
        Date.now() - Date.parse(before.checkedAt) >= 60_000 ||
        !isDeepStrictEqual(before, thread)
      ) {
        thread.checkedAt = checkedAt;
        changed = true;
      }
    }
    if (!changed) return { feature: await getFeature(id), changed: false };
    const saved = await trySaveData(
      current,
      data,
      `Checked the latest 100 channel messages for replies across ${entries.length} question(s).`,
      { silent: true },
    );
    if (saved) return { feature: saved, changed: true };
    current = await getFeature(id);
  }
  fail("Another edit won the race. Refresh replies again.", { errorCode: "stale_revision", statusCode: 409 });
}
