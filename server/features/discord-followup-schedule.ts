import {
  DiscordFollowUpStatus,
  DiscordFollowUpContentLimit,
  discordFollowUpContent,
  type DiscordFollowUp,
  type DiscordPerson,
  type DiscordRole,
  type DiscordThreadState,
} from "@shared/features/discord";

/**
 * Pure schedule construction and invalidation. Kept separate from the worker
 * and the send workflow so both can share it without an import cycle.
 */

export interface FollowUpRecipient {
  recipientRole?: DiscordRole | undefined;
  recipientPerson?: DiscordPerson | undefined;
}

export function followUpMention(recipient: FollowUpRecipient): string {
  if (recipient.recipientPerson)
    return `<@${recipient.recipientPerson.id}>`;
  if (recipient.recipientRole) return `<@&${recipient.recipientRole.id}>`;
  throw new Error("A follow-up requires exactly one recipient.");
}

function recipientSnapshot(recipient: FollowUpRecipient) {
  const role = recipient.recipientRole;
  const person = recipient.recipientPerson;
  if (Number(!!role) + Number(!!person) !== 1)
    throw new Error("A follow-up requires exactly one recipient.");
  return person ? { recipientPerson: person } : { recipientRole: role! };
}

export function buildFollowUp(input: {
  featureId: string;
  questionId: string;
  questionText: string;
  guildId: string;
  channelId: string;
  delivery: {
    messageId: string | null;
    recipientRole?: DiscordRole | undefined;
    recipientPerson?: DiscordPerson | undefined;
  };
  hours: number;
  now: Date;
  actor: string;
  messageAt?: string | null;
}): DiscordFollowUp {
  if (!input.delivery.messageId)
    throw new Error("A confirmed original message is required.");
  if (!Number.isInteger(input.hours) || input.hours < 1 || input.hours > 24)
    throw new Error("Follow-up delay must be between 1 and 24 hours.");
  const recipient = {
    ...(input.delivery.recipientRole
      ? { recipientRole: input.delivery.recipientRole }
      : {}),
    ...(input.delivery.recipientPerson
      ? { recipientPerson: input.delivery.recipientPerson }
      : {}),
  };
  const content = discordFollowUpContent(
    followUpMention(recipient),
    input.featureId,
    input.questionId,
  );
  if (content.length > DiscordFollowUpContentLimit)
    throw new Error("The follow-up text exceeds Discord's message limit.");
  const dueAt = new Date(
    input.now.getTime() + input.hours * 60 * 60 * 1000,
  ).toISOString();
  return {
    status: DiscordFollowUpStatus.SCHEDULED,
    hours: input.hours,
    nonce: crypto.randomUUID().replace(/-/g, "").slice(0, 24),
    dueAt,
    createdAt: input.now.toISOString(),
    createdBy: input.actor,
    content,
    questionText: input.questionText,
    guildId: input.guildId,
    channelId: input.channelId,
    messageId: input.delivery.messageId,
    messageAt: input.messageAt ?? null,
    ...recipientSnapshot(recipient),
    claimedAt: null,
    claimExpiresAt: null,
    attempts: 0,
    lastCheckedAt: null,
    followUpMessageId: null,
    sentAt: null,
    stoppedAt: null,
    answeredBy: null,
    answeredAt: null,
    replyId: null,
    lastError: null,
    reason: null,
  };
}

/**
 * A question, recipient, channel, approval or delivery change invalidates the
 * pending schedule. A confirmed send or an already uncertain delivery is kept
 * as history; the worker rechecks the snapshot before any POST.
 */
export function invalidateFollowUp(
  thread: DiscordThreadState,
  reason: string,
  now = new Date(),
): boolean {
  const followUp = thread.followUp;
  if (!followUp) return false;
  if (
    followUp.status !== DiscordFollowUpStatus.SCHEDULED &&
    followUp.status !== DiscordFollowUpStatus.UNVERIFIED &&
    followUp.status !== DiscordFollowUpStatus.SENDING
  )
    return false;
  followUp.status = DiscordFollowUpStatus.CANCELLED;
  followUp.stoppedAt = now.toISOString();
  followUp.reason = reason.slice(0, 500);
  return true;
}

/** True when the schedule may be created or replaced. A sent/uncertain record
 * is terminal so one question can never produce a second automatic message. */
export function canScheduleFollowUp(followUp: DiscordFollowUp | null | undefined) {
  if (!followUp) return true;
  return (
    followUp.status === DiscordFollowUpStatus.CANCELLED ||
    followUp.status === DiscordFollowUpStatus.FAILED
  );
}
