import { runWithRequestContext } from "@agent-native/core/server";
import {
  DiscordFollowUpStatus,
  DiscordSnowflake,
  type DiscordFollowUp,
  type DiscordThreadState,
  type FeatureDiscord,
} from "@shared/features/discord";
import {
  getFeatureQuestions,
  recipientKey,
} from "@shared/features/questions";
import {
  FeatureDataSchema,
  PrimaryQuestionId,
  QuestionAskApproval,
  QuestionRecipientState,
  QuestionStatus,
  type Feature,
  type FeatureQuestionView,
} from "@shared/features/types";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../db";
import {
  DiscordApiError,
  DiscordMessage,
  discordApi,
  verifyDiscordChannel,
} from "./discord-api";
import {
  buildFollowUp,
  canScheduleFollowUp,
} from "./discord-followup-schedule";
import {
  allowedMentions,
  assertRecipientNotifiable,
  discordPermalink,
} from "./discord-workflow";
import { featureErrors } from "./errors";
import { getFeature, requireActor } from "./store";
import { assertAccess } from "@agent-native/core/sharing";
import { FeatureResource } from "@shared/features/types";

/**
 * Durable, at-most-once Discord follow-ups.
 *
 * The schedule lives on the question's Discord thread in the feature JSONB
 * aggregate, so a restart cannot lose it. A worker claims a due follow-up by
 * compare-and-set on the feature revision before any outbound request; only the
 * worker holding the `sending` claim may POST. A claim that expires (crash,
 * timeout) is reconciled by reading the channel, never by blindly reposting.
 */

const ClaimLeaseMs = 2 * 60 * 1000;
const UncertainRecheckMs = 5 * 60 * 1000;
const MaxScanPages = 5;
const PageSize = 100;
const MaxErrorLength = 500;

export type FollowUpProcessResult =
  | "skipped"
  | "sent"
  | "answered"
  | "unverified"
  | "cancelled"
  | "failed"
  | "uncertain";

type ReplyCheck =
  | { status: "answered"; reply: DiscordFollowUpReply }
  | { status: "none" }
  | { status: "unverified"; reason: string };

interface DiscordFollowUpReply {
  id: string;
  authorId: string;
  author: string;
  text: string;
  at: string;
  url: string;
}

function nowIso(now: Date) {
  return now.toISOString();
}

function errorText(error: unknown) {
  const message =
    error instanceof DiscordApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : "Discord could not complete the follow-up.";
  return message.slice(0, MaxErrorLength);
}

function actionErrorCode(error: unknown) {
  return (error as { errorCode?: unknown })?.errorCode;
}

/** A no-write contract error with `discord_unavailable` means the state could
 * not be verified; everything else before POST means nothing was sent. */
function classifyPreSendFailure(error: unknown): {
  status: typeof DiscordFollowUpStatus.FAILED | typeof DiscordFollowUpStatus.UNVERIFIED;
  reason: string;
} {
  if (actionErrorCode(error) === "discord_unavailable")
    return {
      status: DiscordFollowUpStatus.UNVERIFIED,
      reason: errorText(error),
    };
  if (error instanceof DiscordApiError) {
    // A transient transport/5xx/429/credential-store failure did not prove
    // Discord refused the message, so surface it as actionable but unverified.
    if (
      error.status === undefined ||
      [429, 500, 502, 503, 504].includes(error.status)
    )
      return {
        status: DiscordFollowUpStatus.UNVERIFIED,
        reason: errorText(error),
      };
  }
  return { status: DiscordFollowUpStatus.FAILED, reason: errorText(error) };
}

/** 400/401/403/404/429 are definite refusals: Discord did not create a
 * message. A timeout, 5xx or transport failure may have happened after the
 * request was accepted, so it is recorded as uncertain and never retried. */
function isDefinitePostFailure(error: unknown) {
  return (
    error instanceof DiscordApiError &&
    [400, 401, 403, 404, 429].includes(error.status ?? 0)
  );
}

function isQuestionStatus(value: string): value is QuestionStatus {
  return Object.values(QuestionStatus).includes(value as QuestionStatus);
}

export function threadForQuestion(
  data: Feature["data"],
  questionId: string,
): DiscordThreadState | null {
  if (questionId === PrimaryQuestionId) return data.discord ?? null;
  return (
    data.questions?.find((question) => question.id === questionId)?.discord ??
    null
  );
}

function followUpFor(
  feature: Feature,
  questionId: string,
): DiscordFollowUp | null {
  return threadForQuestion(feature.data, questionId)?.followUp ?? null;
}

function questionFor(
  feature: Feature,
  questionId: string,
): FeatureQuestionView | null {
  return (
    getFeatureQuestions(feature.data, feature.status).find(
      (question) => question.id === questionId,
    ) ?? null
  );
}

/** Everything the owner reviewed must still describe the same message. */
function snapshotProblem(
  feature: Feature,
  questionId: string,
  followUp: DiscordFollowUp,
): string | null {
  const question = questionFor(feature, questionId);
  if (!question) return "The question is no longer available.";
  const delivery = question.discord?.delivery;
  if (!delivery || delivery.status !== "sent" || !delivery.messageId)
    return "The original question is not confirmed as sent.";
  if (delivery.messageId !== followUp.messageId)
    return "The original message changed after the follow-up was scheduled.";
  if (question.text !== followUp.questionText)
    return "The question text changed after the follow-up was scheduled.";
  if (
    recipientKey(question.recipient) !==
    recipientKey({
      status: QuestionRecipientState.SELECTED,
      ...(followUp.recipientPerson
        ? { person: followUp.recipientPerson }
        : { role: followUp.recipientRole! }),
    })
  )
    return "The recipient changed after the follow-up was scheduled.";
  if (question.askApproval.status !== QuestionAskApproval.APPROVED)
    return "Asking this question is no longer approved.";
  if (question.status !== QuestionStatus.OPEN)
    return "This question is no longer open.";
  if (feature.data.discord?.channelId !== followUp.channelId)
    return "The Discord channel changed after the follow-up was scheduled.";
  return null;
}

async function casSave(
  feature: Feature,
  data: Feature["data"],
  detail: string,
  now: Date,
): Promise<Feature | null> {
  if (data.activity.length < 100) {
    data.activity.push({
      id: crypto.randomUUID(),
      event: "Discord follow-up",
      actor: "Feature Coordinator",
      at: nowIso(now),
      detail,
    });
  }
  const [saved] = await getDb()
    .update(schema.features)
    .set({ data, revision: feature.revision + 1 })
    .where(
      and(
        eq(schema.features.id, feature.id),
        eq(schema.features.revision, feature.revision),
      ),
    )
    .returning({ id: schema.features.id });
  return saved ? getFeature(feature.id) : null;
}

async function claimFollowUp(
  featureId: string,
  questionId: string,
  now: Date,
): Promise<{ feature: Feature; claimedAt: string } | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const fresh = await getFeature(featureId);
    const followUp = followUpFor(fresh, questionId);
    if (
      !followUp ||
      followUp.status !== DiscordFollowUpStatus.SCHEDULED ||
      Date.parse(followUp.dueAt) > now.getTime()
    )
      return null;
    const data = structuredClone(fresh.data);
    const thread = threadForQuestion(data, questionId);
    const current = thread?.followUp;
    if (!current) return null;
    const claimedAt = nowIso(now);
    current.status = DiscordFollowUpStatus.SENDING;
    current.claimedAt = claimedAt;
    current.claimExpiresAt = new Date(now.getTime() + ClaimLeaseMs).toISOString();
    current.attempts += 1;
    current.lastCheckedAt = claimedAt;
    const saved = await casSave(
      fresh,
      data,
      "Reserved one automatic Discord follow-up for delivery. Delivery is not yet confirmed.",
      now,
    );
    if (saved) return { feature: saved, claimedAt };
  }
  return null;
}

async function updateFollowUp(
  featureId: string,
  questionId: string,
  claimedAt: string | null,
  patch: Partial<DiscordFollowUp>,
  detail: string,
  now: Date,
): Promise<boolean> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const fresh = await getFeature(featureId);
    const data = structuredClone(fresh.data);
    const thread = threadForQuestion(data, questionId);
    const followUp = thread?.followUp;
    if (!followUp) return false;
    // The claim is the writer identity. A replacement schedule has a new claim.
    if (claimedAt && followUp.claimedAt !== claimedAt) return false;
    Object.assign(followUp, patch);
    if (patch.lastCheckedAt === undefined)
      followUp.lastCheckedAt = nowIso(now);
    const saved = await casSave(fresh, data, detail, now);
    if (saved) return true;
  }
  return false;
}

/** Read enough of the channel to include the original message. Returns
 * `complete: false` when five pages do not reach it; callers must not assume
 * that no reply exists in that case. */
export async function scanFollowUpMessages(
  binding: FeatureDiscord,
  followUp: DiscordFollowUp,
): Promise<{ messages: DiscordMessage[]; complete: boolean }> {
  const api = await discordApi();
  const messages: DiscordMessage[] = [];
  const seen = new Set<string>();
  let before: string | undefined;
  let complete = false;
  for (let page = 0; page < MaxScanPages; page += 1) {
    const query = `limit=${PageSize}${before ? `&before=${before}` : ""}`;
    const batch = z
      .array(DiscordMessage)
      .max(PageSize)
      .parse(await api(`/channels/${binding.channelId}/messages?${query}`));
    for (const message of batch) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      messages.push(message);
    }
    if (batch.length < PageSize) {
      complete = true;
      break;
    }
    const oldest = batch[batch.length - 1]?.id;
    if (!oldest) {
      complete = true;
      break;
    }
    if (
      followUp.messageAt &&
      batch.some(
        (message) =>
          Date.parse(message.timestamp) <= Date.parse(followUp.messageAt!),
      )
    ) {
      complete = true;
      break;
    }
    if (before === oldest) break;
    before = oldest;
  }
  return { messages, complete };
}

function replyFor(
  message: DiscordMessage,
  binding: FeatureDiscord,
): DiscordFollowUpReply {
  return {
    id: message.id,
    authorId: message.author.id,
    author: message.author.username,
    text: message.content,
    at: message.timestamp,
    url: discordPermalink(binding.guildId, binding.channelId, message.id),
  };
}

/**
 * A qualifying reply is an explicit Discord reply to the original message:
 * - individual recipient: authored by that exact Discord user;
 * - role recipient: authored by a non-bot member who currently has that role;
 *   fetched fresh from the guild, not inferred from the channel message.
 * A reply from anyone else does not stop the follow-up. If coverage is
 * incomplete or membership cannot be read, the result is `unverified` and the
 * worker must not send.
 */
export async function evaluateFollowUpReplies(
  binding: FeatureDiscord,
  followUp: DiscordFollowUp,
  messages: DiscordMessage[],
  complete: boolean,
): Promise<ReplyCheck> {
  const direct = messages.filter(
    (message) =>
      message.channel_id === binding.channelId &&
      !message.author.bot &&
      !!message.content.trim() &&
      message.message_reference?.message_id === followUp.messageId,
  );
  const incomplete = !complete
    ? {
        status: "unverified" as const,
        reason:
          "The latest channel history could not be read back to the original message. Follow-up not sent automatically.",
      }
    : null;
  if (followUp.recipientPerson) {
    const match = direct.find(
      (message) => message.author.id === followUp.recipientPerson!.id,
    );
    if (match) return { status: "answered", reply: replyFor(match, binding) };
    return incomplete ?? { status: "none" };
  }
  if (!followUp.recipientRole)
    return {
      status: "unverified",
      reason: "The follow-up has no recipient snapshot.",
    };
  const api = await discordApi();
  const checked = new Set<string>();
  for (const message of direct) {
    if (checked.has(message.author.id)) continue;
    checked.add(message.author.id);
    try {
      const member = z
        .object({ roles: z.array(DiscordSnowflake).max(1000) })
        .parse(
          await api(
            `/guilds/${binding.guildId}/members/${message.author.id}`,
          ),
        );
      if (member.roles.includes(followUp.recipientRole.id))
        return { status: "answered", reply: replyFor(message, binding) };
    } catch (error) {
      // A removed member is not a qualifying role member; anything else means
      // membership could not be verified, so do not send automatically.
      if (error instanceof DiscordApiError && error.status === 404) continue;
      return {
        status: "unverified",
        reason:
          "Could not verify whether a replying member holds the reviewed role. Follow-up not sent automatically.",
      };
    }
  }
  return incomplete ?? { status: "none" };
}

async function failOrUnverify(
  featureId: string,
  questionId: string,
  claimedAt: string,
  error: unknown,
  now: Date,
): Promise<FollowUpProcessResult> {
  const failure = classifyPreSendFailure(error);
  await updateFollowUp(
    featureId,
    questionId,
    claimedAt,
    {
      status: failure.status,
      stoppedAt: nowIso(now),
      lastError: failure.reason,
      reason: failure.reason,
    },
    failure.status === DiscordFollowUpStatus.FAILED
      ? "A Discord follow-up could not be sent; nothing was posted."
      : "A Discord follow-up could not be verified; nothing was posted.",
    now,
  );
  return failure.status === DiscordFollowUpStatus.FAILED ? "failed" : "unverified";
}

async function reconcileClaim(
  featureId: string,
  questionId: string,
  now: Date,
): Promise<FollowUpProcessResult> {
  const feature = await getFeature(featureId);
  const followUp = followUpFor(feature, questionId);
  const binding = feature.data.discord;
  if (!followUp || !binding) return "skipped";
  try {
    const scan = await scanFollowUpMessages(binding, followUp);
    const matches = scan.messages.filter(
      (message) =>
        message.channel_id === binding.channelId &&
        message.author.id === binding.botId &&
        message.content === followUp.content &&
        message.message_reference?.message_id === followUp.messageId,
    );
    if (matches.length === 1) {
      await updateFollowUp(
        featureId,
        questionId,
        followUp.claimedAt,
        {
          status: DiscordFollowUpStatus.SENT,
          followUpMessageId: matches[0]!.id,
          sentAt: matches[0]!.timestamp,
          stoppedAt: null,
          lastError: null,
          reason: "Reconciled by finding exactly one matching follow-up message.",
        },
        "Reconciled an unconfirmed Discord follow-up by finding exactly one matching message.",
        now,
      );
      return "sent";
    }
    if (followUp.status === DiscordFollowUpStatus.SENDING) {
      const reason =
        matches.length > 1
          ? "Multiple matching follow-up messages were found; delivery is uncertain."
          : "The worker stopped before confirming the follow-up. Check the channel; nothing was reposted.";
      await updateFollowUp(
        featureId,
        questionId,
        followUp.claimedAt,
        {
          status: DiscordFollowUpStatus.UNCERTAIN,
          stoppedAt: nowIso(now),
          lastError: reason,
          reason,
        },
        "A Discord follow-up could not be confirmed. It was not reposted.",
        now,
      );
      return "uncertain";
    }
    await updateFollowUp(
      featureId,
      questionId,
      null,
      { lastCheckedAt: nowIso(now) },
      "Rechecked an uncertain Discord follow-up; no matching message was found and nothing was reposted.",
      now,
    );
    return "uncertain";
  } catch (error) {
    if (followUp.status === DiscordFollowUpStatus.SENDING) {
      await updateFollowUp(
        featureId,
        questionId,
        followUp.claimedAt,
        {
          status: DiscordFollowUpStatus.UNCERTAIN,
          stoppedAt: nowIso(now),
          lastError: errorText(error),
          reason:
            "The worker could not read the channel to reconcile the follow-up. Nothing was reposted.",
        },
        "A Discord follow-up could not be reconciled. Nothing was reposted.",
        now,
      );
      return "uncertain";
    }
    await updateFollowUp(
      featureId,
      questionId,
      null,
      { lastCheckedAt: nowIso(now) },
      "Could not recheck an uncertain Discord follow-up. Nothing was reposted.",
      now,
    );
    return "uncertain";
  }
}

async function sendClaimedFollowUp(
  feature: Feature,
  questionId: string,
  claimedAt: string,
  now: Date,
): Promise<FollowUpProcessResult> {
  const followUp = followUpFor(feature, questionId);
  const binding = feature.data.discord;
  if (!followUp || !binding) return "skipped";
  if (
    followUp.status !== DiscordFollowUpStatus.SENDING ||
    followUp.claimedAt !== claimedAt
  )
    return "skipped";
  const problem = snapshotProblem(feature, questionId, followUp);
  if (problem) {
    await updateFollowUp(
      feature.id,
      questionId,
      claimedAt,
      {
        status: DiscordFollowUpStatus.CANCELLED,
        stoppedAt: nowIso(now),
        reason: problem,
      },
      "Cancelled a Discord follow-up because the reviewed question changed. Nothing was sent.",
      now,
    );
    return "cancelled";
  }
  let verified: Awaited<ReturnType<typeof verifyDiscordChannel>>;
  try {
    verified = await verifyDiscordChannel(followUp.guildId, followUp.channelId);
  } catch (error) {
    return failOrUnverify(feature.id, questionId, claimedAt, error, now);
  }
  if (verified.botId !== binding.botId)
    return failOrUnverify(
      feature.id,
      questionId,
      claimedAt,
      new Error("The Discord bot identity changed. Follow-up not sent."),
      now,
    );
  try {
    await assertRecipientNotifiable(binding, followUp);
  } catch (error) {
    return failOrUnverify(feature.id, questionId, claimedAt, error, now);
  }
  let scan: Awaited<ReturnType<typeof scanFollowUpMessages>>;
  try {
    scan = await scanFollowUpMessages(binding, followUp);
  } catch (error) {
    return failOrUnverify(
      feature.id,
      questionId,
      claimedAt,
      Object.assign(new Error(errorText(error)), {
        errorCode: "discord_unavailable",
      }),
      now,
    );
  }
  let check: ReplyCheck;
  try {
    check = await evaluateFollowUpReplies(
      binding,
      followUp,
      scan.messages,
      scan.complete,
    );
  } catch (error) {
    return failOrUnverify(
      feature.id,
      questionId,
      claimedAt,
      Object.assign(new Error(errorText(error)), {
        errorCode: "discord_unavailable",
      }),
      now,
    );
  }
  if (check.status === "answered") {
    await updateFollowUp(
      feature.id,
      questionId,
      claimedAt,
      {
        status: DiscordFollowUpStatus.ANSWERED,
        stoppedAt: nowIso(now),
        answeredBy: check.reply.author,
        answeredAt: check.reply.at,
        replyId: check.reply.id,
        reason: "A qualifying reply arrived before the follow-up was sent.",
      },
      "A Discord reply stopped the scheduled follow-up. Nothing was sent.",
      now,
    );
    return "answered";
  }
  if (check.status === "unverified") {
    await updateFollowUp(
      feature.id,
      questionId,
      claimedAt,
      {
        status: DiscordFollowUpStatus.UNVERIFIED,
        lastError: check.reason,
        reason: check.reason,
      },
      "Could not verify whether a reply exists; no automatic follow-up was sent.",
      now,
    );
    return "unverified";
  }
  // Re-read immediately before POST. A cancellation or edit that lands between
  // this read and Discord's acceptance is still a race we cannot close.
  const latest = await getFeature(feature.id);
  const latestFollowUp = followUpFor(latest, questionId);
  if (
    !latestFollowUp ||
    latestFollowUp.status !== DiscordFollowUpStatus.SENDING ||
    latestFollowUp.claimedAt !== claimedAt
  )
    return "skipped";
  const latestProblem = snapshotProblem(latest, questionId, latestFollowUp);
  if (latestProblem) {
    await updateFollowUp(
      feature.id,
      questionId,
      claimedAt,
      {
        status: DiscordFollowUpStatus.CANCELLED,
        stoppedAt: nowIso(now),
        reason: latestProblem,
      },
      "Cancelled a Discord follow-up because the reviewed question changed. Nothing was sent.",
      now,
    );
    return "cancelled";
  }
  // Final check as late as practical: a reply that arrived during the earlier
  // scan or permission checks still stops the POST. A reply can arrive after
  // this read and before Discord accepts the message; that window is inherent.
  let finalScan: Awaited<ReturnType<typeof scanFollowUpMessages>>;
  try {
    finalScan = await scanFollowUpMessages(binding, followUp);
  } catch (error) {
    return failOrUnverify(
      feature.id,
      questionId,
      claimedAt,
      Object.assign(new Error(errorText(error)), {
        errorCode: "discord_unavailable",
      }),
      now,
    );
  }
  let finalCheck: ReplyCheck;
  try {
    finalCheck = await evaluateFollowUpReplies(
      binding,
      followUp,
      finalScan.messages,
      finalScan.complete,
    );
  } catch (error) {
    return failOrUnverify(
      feature.id,
      questionId,
      claimedAt,
      Object.assign(new Error(errorText(error)), {
        errorCode: "discord_unavailable",
      }),
      now,
    );
  }
  if (finalCheck.status === "answered") {
    await updateFollowUp(
      feature.id,
      questionId,
      claimedAt,
      {
        status: DiscordFollowUpStatus.ANSWERED,
        stoppedAt: nowIso(now),
        answeredBy: finalCheck.reply.author,
        answeredAt: finalCheck.reply.at,
        replyId: finalCheck.reply.id,
        reason: "A qualifying reply arrived before the follow-up was sent.",
      },
      "A Discord reply stopped the scheduled follow-up. Nothing was sent.",
      now,
    );
    return "answered";
  }
  if (finalCheck.status === "unverified") {
    await updateFollowUp(
      feature.id,
      questionId,
      claimedAt,
      {
        status: DiscordFollowUpStatus.UNVERIFIED,
        lastError: finalCheck.reason,
        reason: finalCheck.reason,
      },
      "Could not verify whether a reply exists; no automatic follow-up was sent.",
      now,
    );
    return "unverified";
  }
  const finalFeature = await getFeature(feature.id);
  const finalFollowUp = followUpFor(finalFeature, questionId);
  if (
    !finalFollowUp ||
    finalFollowUp.status !== DiscordFollowUpStatus.SENDING ||
    finalFollowUp.claimedAt !== claimedAt
  )
    return "skipped";
  const finalProblem = snapshotProblem(finalFeature, questionId, finalFollowUp);
  if (finalProblem) {
    await updateFollowUp(
      feature.id,
      questionId,
      claimedAt,
      {
        status: DiscordFollowUpStatus.CANCELLED,
        stoppedAt: nowIso(now),
        reason: finalProblem,
      },
      "Cancelled a Discord follow-up because the reviewed question changed. Nothing was sent.",
      now,
    );
    return "cancelled";
  }
  const api = await discordApi();
  let posted: DiscordMessage;
  try {
    posted = DiscordMessage.parse(
      await api(`/channels/${followUp.channelId}/messages`, {
        content: followUp.content,
        nonce: followUp.nonce,
        enforce_nonce: true,
        allowed_mentions: allowedMentions(followUp),
        message_reference: {
          message_id: followUp.messageId,
          channel_id: followUp.channelId,
          fail_if_not_exists: true,
        },
      }),
    );
  } catch (error) {
    const definite = isDefinitePostFailure(error);
    await updateFollowUp(
      feature.id,
      questionId,
      claimedAt,
      {
        status: definite
          ? DiscordFollowUpStatus.FAILED
          : DiscordFollowUpStatus.UNCERTAIN,
        stoppedAt: nowIso(now),
        lastError: errorText(error),
        reason: definite
          ? "Discord refused the follow-up; nothing was posted."
          : "Discord did not confirm the follow-up. It may have been posted; nothing will be reposted automatically.",
      },
      definite
        ? "Discord refused a follow-up; nothing was posted."
        : "A Discord follow-up is unconfirmed. It will not be reposted automatically.",
      now,
    );
    return definite ? "failed" : "uncertain";
  }
  try {
    const confirmed = DiscordMessage.parse(
      await api(`/channels/${followUp.channelId}/messages/${posted.id}`),
    );
    if (
      confirmed.channel_id !== followUp.channelId ||
      confirmed.author.id !== binding.botId ||
      confirmed.content !== followUp.content ||
      confirmed.message_reference?.message_id !== followUp.messageId
    )
      throw new Error("Follow-up readback mismatch.");
  } catch (error) {
    await updateFollowUp(
      feature.id,
      questionId,
      claimedAt,
      {
        status: DiscordFollowUpStatus.UNCERTAIN,
        followUpMessageId: posted.id,
        stoppedAt: nowIso(now),
        lastError: errorText(error),
        reason:
          "Discord accepted the follow-up but the readback did not confirm it. Nothing will be reposted automatically.",
      },
      "A Discord follow-up was posted but not confirmed by readback. Nothing will be reposted automatically.",
      now,
    );
    return "uncertain";
  }
  await updateFollowUp(
    feature.id,
    questionId,
    claimedAt,
    {
      status: DiscordFollowUpStatus.SENT,
      followUpMessageId: posted.id,
      sentAt: posted.timestamp,
      lastError: null,
      reason: null,
    },
    "Sent one automatic Discord follow-up and confirmed it by readback.",
    now,
  );
  return "sent";
}

/** Process one question. Called inside the owner's request context. */
export async function processFollowUp(
  featureId: string,
  questionId: string,
  now: Date,
): Promise<FollowUpProcessResult> {
  const feature = await getFeature(featureId);
  const followUp = followUpFor(feature, questionId);
  if (!followUp) return "skipped";
  if (
    followUp.status === DiscordFollowUpStatus.SENDING &&
    followUp.claimExpiresAt &&
    Date.parse(followUp.claimExpiresAt) <= now.getTime()
  )
    return reconcileClaim(featureId, questionId, now);
  if (followUp.status === DiscordFollowUpStatus.SENDING) return "skipped";
  if (followUp.status === DiscordFollowUpStatus.UNCERTAIN) {
    if (
      followUp.lastCheckedAt &&
      now.getTime() - Date.parse(followUp.lastCheckedAt) < UncertainRecheckMs
    )
      return "skipped";
    return reconcileClaim(featureId, questionId, now);
  }
  if (followUp.status !== DiscordFollowUpStatus.SCHEDULED) return "skipped";
  if (Date.parse(followUp.dueAt) > now.getTime()) return "skipped";
  const claimed = await claimFollowUp(featureId, questionId, now);
  if (!claimed) return "skipped";
  return sendClaimedFollowUp(
    claimed.feature,
    questionId,
    claimed.claimedAt,
    now,
  );
}

interface Candidate {
  featureId: string;
  questionId: string;
  ownerEmail: string;
  orgId: string | null;
}

/** Due schedules across all features. The JSONB aggregate is the source of
 * truth; a bounded scan is acceptable at this app's scale. */
export async function listFollowUpCandidates(
  now: Date,
): Promise<Candidate[]> {
  const rows = await getDb()
    .select({
      id: schema.features.id,
      status: schema.features.status,
      data: schema.features.data,
      ownerEmail: schema.features.ownerEmail,
      orgId: schema.features.orgId,
    })
    .from(schema.features);
  const candidates: Candidate[] = [];
  for (const row of rows) {
    if (!isQuestionStatus(row.status)) continue;
    const parsed = FeatureDataSchema.safeParse(row.data);
    if (!parsed.success) continue;
    for (const question of getFeatureQuestions(parsed.data, row.status)) {
      const followUp = question.discord?.followUp;
      if (!followUp) continue;
      const due =
        (followUp.status === DiscordFollowUpStatus.SCHEDULED &&
          Date.parse(followUp.dueAt) <= now.getTime()) ||
        (followUp.status === DiscordFollowUpStatus.SENDING &&
          !!followUp.claimExpiresAt &&
          Date.parse(followUp.claimExpiresAt) <= now.getTime()) ||
        (followUp.status === DiscordFollowUpStatus.UNCERTAIN &&
          (!followUp.lastCheckedAt ||
            now.getTime() - Date.parse(followUp.lastCheckedAt) >=
              UncertainRecheckMs));
      if (!due) continue;
      candidates.push({
        featureId: row.id,
        questionId: question.id,
        ownerEmail: row.ownerEmail,
        orgId: row.orgId ?? null,
      });
    }
  }
  return candidates;
}

export async function runDueDiscordFollowUps(options: {
  now?: Date;
  max?: number;
  deadlineMs?: number;
} = {}): Promise<Record<FollowUpProcessResult, number> & { processed: number }> {
  const now = options.now ?? new Date();
  const max = Math.max(1, options.max ?? 5);
  const deadline = Date.now() + Math.max(1000, options.deadlineMs ?? 15_000);
  const counts: Record<FollowUpProcessResult, number> = {
    skipped: 0,
    sent: 0,
    answered: 0,
    unverified: 0,
    cancelled: 0,
    failed: 0,
    uncertain: 0,
  };
  let processed = 0;
  let candidates: Candidate[];
  try {
    candidates = await listFollowUpCandidates(now);
  } catch (error) {
    console.error("[discord-followups] could not list candidates", {
      reason: errorText(error),
    });
    return { ...counts, processed };
  }
  for (const candidate of candidates) {
    if (processed >= max || Date.now() >= deadline) break;
    try {
      const result = await runWithRequestContext(
        {
          userEmail: candidate.ownerEmail,
          ...(candidate.orgId
            ? { orgId: candidate.orgId }
            : { orgScope: "personal" as const }),
        },
        () => processFollowUp(candidate.featureId, candidate.questionId, now),
      );
      counts[result] += 1;
      processed += 1;
    } catch (error) {
      counts.failed += 1;
      processed += 1;
      console.error("[discord-followups] candidate failed", {
        featureId: candidate.featureId,
        questionId: candidate.questionId,
        reason: errorText(error),
      });
    }
  }
  return { ...counts, processed };
}

/** Owner-only, frontend-only schedule creation. No message is sent here. */
export async function scheduleFollowUpForQuestion(
  id: string,
  revision: number,
  hours: number,
  questionId?: string,
) {
  const actor = requireActor();
  await assertAccess(FeatureResource.TYPE, id, "owner");
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
  const targetId = questionId ?? PrimaryQuestionId;
  const feature = await getFeature(id);
  const thread = threadForQuestion(feature.data, targetId);
  if (!thread?.delivery || thread.delivery.status !== "sent" || !thread.delivery.messageId)
    throw featureErrors.noWrite(
      "Send and confirm the question before scheduling a follow-up.",
      "invalid_transition",
    );
  if (!canScheduleFollowUp(thread.followUp))
    throw featureErrors.noWrite(
      "This question already has a follow-up. Wait for its result or cancel it first.",
      "invalid_transition",
    );
  const binding = feature.data.discord;
  if (!binding)
    throw featureErrors.noWrite(
      "Connect a Discord channel first.",
      "invalid_transition",
    );
  const question = questionFor(feature, targetId);
  if (!question)
    throw featureErrors.noWrite("Question not found.", "suggestion_not_found", {
      statusCode: 404,
    });
  if (question.status !== QuestionStatus.OPEN)
    throw featureErrors.noWrite(
      "This question is not open.",
      "invalid_transition",
    );
  if (question.askApproval.status !== QuestionAskApproval.APPROVED)
    throw featureErrors.noWrite(
      "Asking this question is not approved.",
      "invalid_transition",
    );
  const data = structuredClone(feature.data);
  const nextThread = threadForQuestion(data, targetId);
  if (!nextThread) throw featureErrors.noWrite("Question not found.", "suggestion_not_found");
  nextThread.followUp = buildFollowUp({
    featureId: id,
    questionId: targetId,
    questionText: question.text,
    guildId: binding.guildId,
    channelId: thread.delivery.channelId ?? binding.channelId,
    delivery: thread.delivery,
    hours,
    now: new Date(),
    actor,
    messageAt: thread.delivery.requestedAt,
  });
  const saved = await casSave(
    feature,
    data,
    "Scheduled one automatic Discord follow-up. Nothing was sent.",
    new Date(),
  );
  if (!saved)
    throw featureErrors.noWrite(
      "Another edit won the race. Review the latest version.",
      "stale_revision",
      { statusCode: 409 },
    );
  return saved;
}

/** Owner-only, frontend-only cancellation. Never sends. */
export async function cancelFollowUpForQuestion(
  id: string,
  revision: number,
  questionId?: string,
) {
  requireActor();
  await assertAccess(FeatureResource.TYPE, id, "owner");
  const current = await getFeature(id);
  if (current.revision !== revision)
    throw featureErrors.noWrite(
      "This feature changed. Review the latest version.",
      "stale_revision",
      { statusCode: 409 },
    );
  const targetId = questionId ?? PrimaryQuestionId;
  const feature = await getFeature(id);
  const thread = threadForQuestion(feature.data, targetId);
  const followUp = thread?.followUp;
  if (!followUp)
    throw featureErrors.noWrite(
      "This question has no follow-up to cancel.",
      "invalid_transition",
    );
  if (followUp.status === DiscordFollowUpStatus.SENDING)
    throw featureErrors.noWrite(
      "The follow-up is being sent. Wait for the confirmed result before cancelling.",
      "discord_delivery_pending",
      { statusCode: 409 },
    );
  if (
    followUp.status !== DiscordFollowUpStatus.SCHEDULED &&
    followUp.status !== DiscordFollowUpStatus.UNVERIFIED
  )
    throw featureErrors.noWrite(
      "This follow-up already has a final state.",
      "invalid_transition",
    );
  const data = structuredClone(feature.data);
  const nextThread = threadForQuestion(data, targetId);
  if (!nextThread?.followUp)
    throw featureErrors.noWrite("Follow-up not found.", "invalid_transition");
  const now = new Date();
  nextThread.followUp.status = DiscordFollowUpStatus.CANCELLED;
  nextThread.followUp.stoppedAt = nowIso(now);
  nextThread.followUp.reason = "Cancelled by the feature owner. Nothing was sent.";
  const saved = await casSave(
    feature,
    data,
    "Cancelled one automatic Discord follow-up. Nothing was sent.",
    now,
  );
  if (!saved)
    throw featureErrors.noWrite(
      "Another edit won the race. Review the latest version.",
      "stale_revision",
      { statusCode: 409 },
    );
  return saved;
}

/** Owner-triggered recheck; never sends. */
export async function recheckFollowUpForQuestion(
  id: string,
  revision: number,
  questionId?: string,
) {
  requireActor();
  await assertAccess(FeatureResource.TYPE, id, "owner");
  const current = await getFeature(id);
  if (current.revision !== revision)
    throw featureErrors.noWrite(
      "This feature changed. Review the latest version.",
      "stale_revision",
      { statusCode: 409 },
    );
  const targetId = questionId ?? PrimaryQuestionId;
  const feature = await getFeature(id);
  const followUp = followUpFor(feature, targetId);
  const binding = feature.data.discord;
  if (!followUp || !binding)
    throw featureErrors.noWrite(
      "This question has no follow-up.",
      "invalid_transition",
    );
  if (followUp.status === DiscordFollowUpStatus.SENDING) {
    // Never race the worker's live claim; wait for its two-minute lease.
    if (
      followUp.claimExpiresAt &&
      Date.parse(followUp.claimExpiresAt) > Date.now()
    )
      return getFeature(id);
    await reconcileClaim(id, targetId, new Date());
    return getFeature(id);
  }
  if (followUp.status === DiscordFollowUpStatus.UNCERTAIN) {
    await reconcileClaim(id, targetId, new Date());
    return getFeature(id);
  }
  if (
    followUp.status !== DiscordFollowUpStatus.SCHEDULED &&
    followUp.status !== DiscordFollowUpStatus.UNVERIFIED
  )
    throw featureErrors.noWrite(
      "This follow-up already has a final state.",
      "invalid_transition",
    );
  const scan = await scanFollowUpMessages(binding, followUp);
  const check = await evaluateFollowUpReplies(
    binding,
    followUp,
    scan.messages,
    scan.complete,
  );
  const now = new Date();
  if (check.status === "answered") {
    await updateFollowUp(
      id,
      targetId,
      null,
      {
        status: DiscordFollowUpStatus.ANSWERED,
        stoppedAt: nowIso(now),
        answeredBy: check.reply.author,
        answeredAt: check.reply.at,
        replyId: check.reply.id,
        reason: "A qualifying reply arrived before the follow-up was sent.",
      },
      "A Discord reply stopped the scheduled follow-up. Nothing was sent.",
      now,
    );
  } else if (check.status === "unverified") {
    await updateFollowUp(
      id,
      targetId,
      null,
      {
        status: DiscordFollowUpStatus.UNVERIFIED,
        lastError: check.reason,
        reason: check.reason,
      },
      "Could not verify whether a reply exists; no automatic follow-up was sent.",
      now,
    );
  } else {
    await updateFollowUp(
      id,
      targetId,
      null,
      {
        status: DiscordFollowUpStatus.SCHEDULED,
        lastError: null,
        reason: null,
      },
      "Rechecked the channel; no qualifying reply exists yet.",
      now,
    );
  }
  return getFeature(id);
}

export type { DiscordFollowUpReply };
