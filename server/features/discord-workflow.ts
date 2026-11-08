import { fail } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import {
  DiscordChange,
  DiscordMentionPermission,
  DiscordDeliveryStatus,
  type FeatureDiscord,
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
  options: { silentAtLimit?: boolean } = {},
) {
  const actor = requireActor();
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
async function saveData(current: Feature, data: FeatureData, detail: string) {
  const saved = await trySaveData(current, data, detail);
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
async function assertRecipientNotifiable(
  binding: FeatureDiscord,
  delivery: NonNullable<FeatureDiscord["delivery"]>,
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
function allowedMentions(delivery: {
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

export async function sendDiscordQuestion(
  id: string,
  revision: number,
  questionId?: string,
) {
  if (questionId && questionId !== PrimaryQuestionId)
    return sendSuggestedQuestion(id, revision, questionId);
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

async function sendSuggestedQuestion(
  id: string,
  revision: number,
  questionId: string,
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
      },
      "Confirmed one Discord question by reading back the sent message.",
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
  thread.replies = messages
    .filter(
      (m) =>
        m.channel_id === binding.channelId &&
        !m.author.bot &&
        !!m.content.trim() &&
        m.message_reference?.message_id === delivery.messageId,
    )
    .map((m) => ({
      id: m.id,
      authorId: m.author.id,
      author: m.author.username,
      text: m.content,
      at: m.timestamp,
      url: discordPermalink(binding.guildId, binding.channelId, m.id),
    }));
  thread.checkedAt = new Date().toISOString();
  thread.partial = messages.length === 100;
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
    // Re-read so a concurrent delivery of another question is not overwritten.
    return updateQuestionThread(
      id,
      questionId,
      (thread) => applyScan(thread, binding, messages),
      "Checked the latest 100 channel messages for direct replies to one question. No reply was automatically recorded or approved.",
    );
  }
  assertScannable(binding);
  applyScan(binding, binding, await scanChannel(binding));
  return save(
    current,
    binding,
    "Checked the latest 100 channel messages for direct replies. No reply was automatically recorded or approved.",
  );
}
