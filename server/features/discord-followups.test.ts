import {
  DiscordDeliveryStatus,
  DiscordFollowUpStatus,
  DiscordMentionPermission,
  type DiscordFollowUp,
} from "@shared/features/discord";
import {
  FeatureParticipant,
  FeatureProgress,
  PrimaryQuestionId,
  QuestionAskApproval,
  QuestionRecipientState,
  QuestionStatus,
  QuestionSuggestionStatus,
  type Feature,
  type FeatureQuestionItem,
} from "@shared/features/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  row: undefined as unknown as Feature,
  api: vi.fn(),
  verify: vi.fn(),
  notify: vi.fn(),
  access: vi.fn(),
  messages: [] as any[],
  posted: [] as any[],
  memberRoles: [] as string[],
  postFails: false,
  counter: 0,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mock.access(...args),
}));
vi.mock("./store", () => ({
  requireActor: () => "owner@example.test",
  getFeature: async () => structuredClone(mock.row),
}));
vi.mock("../db", async () => {
  const schema = await import("../db/schema");
  return {
    schema,
    getDb: () => ({
      select: () => ({
        from: async () => [structuredClone(mock.row)],
      }),
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: () => ({
            returning: async () => {
              if (patch.revision !== mock.row.revision + 1) return [];
              mock.row = {
                ...mock.row,
                ...(patch as Partial<Feature>),
                data: structuredClone(patch.data) as Feature["data"],
              };
              return [{ id: mock.row.id }];
            },
          }),
        }),
      }),
    }),
  };
});
vi.mock("./discord-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./discord-api")>()),
  discordApi: async () => mock.api,
  verifyDiscordChannel: (...args: unknown[]) => mock.verify(...args),
}));
vi.mock("./discord-workflow", () => ({
  assertRecipientNotifiable: (...args: unknown[]) => mock.notify(...args),
  allowedMentions: (delivery: {
    recipientRole?: { id: string };
    recipientPerson?: { id: string };
  }) =>
    delivery.recipientPerson
      ? {
          parse: [],
          roles: [],
          users: [delivery.recipientPerson.id],
          replied_user: false,
        }
      : {
          parse: [],
          roles: [delivery.recipientRole?.id],
          users: [],
          replied_user: false,
        },
  discordPermalink: (guild: string, channel: string, message: string) =>
    `https://discord.com/channels/${guild}/${channel}/${message}`,
}));

import { DiscordApiError } from "./discord-api";
import {
  cancelFollowUpForQuestion,
  recheckFollowUpForQuestion,
  runDueDiscordFollowUps,
  scheduleFollowUpForQuestion,
} from "./discord-followups";
import { buildFollowUp } from "./discord-followup-schedule";
import { createSampleData } from "./sample";

const guild = "1567817386537648188";
const channel = "1567817498597007531";
const bot = "1567641543010025483";
const roleId = "1567817498597007599";
const personId = "1209141438022025307";
const originalId = "1568996273380528220";
const id = (n: number) => String(1568996273380528000 + n);
const base = new Date("2026-01-01T10:00:00.000Z");
const due = new Date(base.getTime() + 60 * 60 * 1000 + 1000);

const role = {
  id: roleId,
  name: "PO",
  mentionable: true,
  mentionPermission: DiscordMentionPermission.ALLOWED,
};
const person = { id: personId, username: "po", displayName: "Product Owner", roles: [] };

function message(
  id: string,
  content: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    channel_id: channel,
    content,
    timestamp: new Date(base.getTime() + 30 * 60 * 1000).toISOString(),
    author: { id: bot, username: "Coordinator", bot: true },
    ...extra,
  };
}

function question(): FeatureQuestionItem {
  return {
    id: "q-1",
    text: "Which refund window applies?",
    owner: FeatureParticipant.PO,
    ownerReason: "Test",
    origin: "agent_finding",
    evidence: [],
    suggestion: {
      status: QuestionSuggestionStatus.SUGGESTED,
      dismissedBy: null,
      dismissedAt: null,
      reason: null,
    },
    recipient: { status: QuestionRecipientState.SELECTED, role },
    status: QuestionStatus.OPEN,
    askApproval: {
      status: QuestionAskApproval.APPROVED,
      by: "owner@example.test",
      at: base.toISOString(),
      provenance: "owner_confirmed",
    },
    reply: null,
    replyBy: null,
    proposal: null,
    rationale: null,
    approvedBy: null,
    approvedAt: null,
    discord: {
      delivery: {
        status: DiscordDeliveryStatus.SENT,
        nonce: "delivery-nonce",
        content: "Which refund window applies?",
        requestedAt: base.toISOString(),
        messageId: originalId,
      },
      replies: [],
      checkedAt: null,
      partial: false,
    },
  };
}

function setup(options: { recipient?: "role" | "person" } = {}) {
  const data = createSampleData("owner@example.test");
  data.sample = false;
  data.discord = {
    guildId: guild,
    channelId: channel,
    channelName: "feature-review",
    botId: bot,
    delivery: null,
    replies: [],
    checkedAt: null,
    partial: false,
  };
  const q = question();
  const delivery = q.discord!.delivery!;
  if (options.recipient === "person") {
    q.recipient = { status: QuestionRecipientState.SELECTED, person };
    delivery.recipientPerson = person;
    delete delivery.recipientRole;
  } else {
    delivery.recipientRole = role;
  }
  data.questions = [q];
  mock.row = {
    id: "feature-1",
    title: "Cancellation review",
    revision: 1,
    status: QuestionStatus.OPEN,
    featureStatus: FeatureProgress.NOT_STARTED,
    data,
    ownerEmail: "owner@example.test",
    canEdit: true,
    canApprove: true,
  };
  return q;
}

function schedule(q: FeatureQuestionItem, hours = 1) {
  q.discord!.followUp = buildFollowUp({
    featureId: "feature-1",
    questionId: q.id,
    questionText: q.text,
    guildId: guild,
    channelId: channel,
    delivery: q.discord!.delivery!,
    hours,
    now: base,
    actor: "owner@example.test",
    messageAt: base.toISOString(),
  });
  return q.discord!.followUp;
}

function followUp(): DiscordFollowUp {
  return mock.row.data.questions![0]!.discord!.followUp!;
}

function posts() {
  return mock.api.mock.calls.filter(
    (call) => call[1] !== undefined && /\/messages$/.test(call[0]),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(base);
  mock.messages = [];
  mock.posted = [];
  mock.memberRoles = [];
  mock.postFails = false;
  mock.verify.mockResolvedValue({
    guildId: guild,
    channelId: channel,
    channelName: "feature-review",
    botId: bot,
  });
  mock.notify.mockResolvedValue(undefined);
  mock.access.mockResolvedValue({ role: "owner" });
  mock.api.mockImplementation(async (path: string, body?: any) => {
    if (body) {
      if (mock.postFails) throw new Error("network timeout");
      const createdId = id(100 + ++mock.counter);
      const created = message(createdId, body.content, {
        message_reference: body.message_reference,
      });
      mock.posted.push(created);
      return created;
    }
    if (/\/members\/\d+$/.test(path))
      return { roles: mock.memberRoles };
    if (/\/messages\/[^/?]+$/.test(path)) {
      const id = path.split("/").pop();
      const found = mock.posted.find((item) => item.id === id);
      if (!found) throw new DiscordApiError("not found", 404);
      return found;
    }
    if (path.includes("/messages?")) return mock.messages;
    throw new Error(`unexpected Discord path ${path}`);
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Discord follow-up worker", () => {
  it("does not send before the deadline", async () => {
    const q = setup();
    schedule(q);
    await runDueDiscordFollowUps({
      now: new Date(base.getTime() + 30 * 60 * 1000),
    });
    expect(posts()).toHaveLength(0);
    expect(followUp().status).toBe(DiscordFollowUpStatus.SCHEDULED);
  });

  it("sends exactly one follow-up after the deadline with the same recipient", async () => {
    const q = setup();
    schedule(q);
    await runDueDiscordFollowUps({ now: due });
    expect(posts()).toHaveLength(1);
    expect(posts()[0]![1].content).toBe(followUp().content);
    expect(posts()[0]![1].allowed_mentions.roles).toEqual([roleId]);
    expect(posts()[0]![1].message_reference).toMatchObject({
      message_id: originalId,
      channel_id: channel,
    });
    expect(followUp().status).toBe(DiscordFollowUpStatus.SENT);
    expect(followUp().followUpMessageId).toBe(mock.posted[0]!.id);
  });

  it("stops before sending when the selected individual replied", async () => {
    const q = setup({ recipient: "person" });
    schedule(q);
    mock.messages = [
      message(id(1), "48 hours please", {
        author: { id: personId, username: "po", bot: false },
        message_reference: { message_id: originalId },
      }),
    ];
    await runDueDiscordFollowUps({ now: due });
    expect(posts()).toHaveLength(0);
    expect(followUp().status).toBe(DiscordFollowUpStatus.ANSWERED);
    expect(followUp().replyId).toBe(id(1));
  });

  it("stops for a direct reply by a current member of the reviewed role", async () => {
    const q = setup();
    schedule(q);
    mock.memberRoles = [roleId];
    mock.messages = [
      message(id(1), "We agreed on 48 hours", {
        author: { id: personId, username: "po", bot: false },
        message_reference: { message_id: originalId },
      }),
    ];
    await runDueDiscordFollowUps({ now: due });
    expect(posts()).toHaveLength(0);
    expect(followUp().status).toBe(DiscordFollowUpStatus.ANSWERED);
  });

  it("does not treat a non-member reply as an answer", async () => {
    const q = setup();
    schedule(q);
    mock.memberRoles = [];
    mock.messages = [
      message(id(1), "I think 48 hours", {
        author: { id: "999999999999999999", username: "bystander", bot: false },
        message_reference: { message_id: originalId },
      }),
    ];
    await runDueDiscordFollowUps({ now: due });
    expect(posts()).toHaveLength(1);
    expect(followUp().status).toBe(DiscordFollowUpStatus.SENT);
  });

  it("cancels without sending and is idempotent", async () => {
    const q = setup();
    schedule(q);
    await cancelFollowUpForQuestion("feature-1", 1, "q-1");
    expect(followUp().status).toBe(DiscordFollowUpStatus.CANCELLED);
    await runDueDiscordFollowUps({ now: due });
    expect(posts()).toHaveLength(0);
    await expect(
      cancelFollowUpForQuestion("feature-1", mock.row.revision, "q-1"),
    ).rejects.toThrow("final state");
  });

  it("schedules without sending and requires owner access", async () => {
    setup();
    delete mock.row.data.questions![0]!.discord!.followUp;
    // The delivery is already sent, so a follow-up may be scheduled after the fact.
    await scheduleFollowUpForQuestion("feature-1", 1, 2, "q-1");
    expect(followUp().status).toBe(DiscordFollowUpStatus.SCHEDULED);
    expect(followUp().hours).toBe(2);
    expect(followUp().content).toContain(`<@&${roleId}>`);
    expect(mock.api).not.toHaveBeenCalled();
  });

  it("does not send when reply coverage is incomplete", async () => {
    const q = setup();
    schedule(q);
    mock.messages = Array.from({ length: 100 }, (_, index) =>
      message(id(200 + index), "channel chatter", {
        author: { id: "999999999999999999", username: "bystander", bot: false },
      }),
    );
    await runDueDiscordFollowUps({ now: due });
    expect(posts()).toHaveLength(0);
    expect(followUp().status).toBe(DiscordFollowUpStatus.UNVERIFIED);
  });

  it("marks a missing notification permission as failed and sends nothing", async () => {
    const q = setup();
    schedule(q);
    mock.notify.mockRejectedValue(
      Object.assign(new Error("Discord denies this bot permission."), {
        errorCode: "invalid_transition",
      }),
    );
    await runDueDiscordFollowUps({ now: due });
    expect(posts()).toHaveLength(0);
    expect(followUp().status).toBe(DiscordFollowUpStatus.FAILED);
  });

  it("marks an unavailable verification as unverified instead of sending", async () => {
    const q = setup();
    schedule(q);
    mock.notify.mockRejectedValue(
      Object.assign(new Error("Could not verify the bot permission."), {
        errorCode: "discord_unavailable",
      }),
    );
    await runDueDiscordFollowUps({ now: due });
    expect(posts()).toHaveLength(0);
    expect(followUp().status).toBe(DiscordFollowUpStatus.UNVERIFIED);
  });

  it("records an uncertain POST once and never reposts it", async () => {
    const q = setup();
    schedule(q);
    mock.postFails = true;
    await runDueDiscordFollowUps({ now: due });
    expect(posts()).toHaveLength(1);
    expect(followUp().status).toBe(DiscordFollowUpStatus.UNCERTAIN);
    await runDueDiscordFollowUps({
      now: new Date(due.getTime() + 10 * 60 * 1000),
    });
    expect(posts()).toHaveLength(1);
    expect(followUp().status).toBe(DiscordFollowUpStatus.UNCERTAIN);
    // A later reconciliation finds the message and confirms it; no second POST.
    mock.postFails = false;
    const content = followUp().content;
    mock.messages = [
      message(id(2), content, {
        message_reference: { message_id: originalId },
      }),
    ];
    await runDueDiscordFollowUps({
      now: new Date(due.getTime() + 20 * 60 * 1000),
    });
    expect(posts()).toHaveLength(1);
    expect(followUp().status).toBe(DiscordFollowUpStatus.SENT);
    expect(followUp().followUpMessageId).toBe(id(2));
  });

  it("reconciles a crashed claim by reading the channel, not reposting", async () => {
    const q = setup();
    const f = schedule(q);
    f.status = DiscordFollowUpStatus.SENDING;
    f.claimedAt = base.toISOString();
    f.claimExpiresAt = new Date(base.getTime() + 2 * 60 * 1000).toISOString();
    mock.messages = [
      message(id(3), f.content, {
        message_reference: { message_id: originalId },
      }),
    ];
    await runDueDiscordFollowUps({
      now: new Date(base.getTime() + 5 * 60 * 1000),
    });
    expect(posts()).toHaveLength(0);
    expect(followUp().status).toBe(DiscordFollowUpStatus.SENT);
    expect(followUp().followUpMessageId).toBe(id(3));
  });

  it("treats an expired claim with no matching message as uncertain, never reposting", async () => {
    const q = setup();
    const f = schedule(q);
    f.status = DiscordFollowUpStatus.SENDING;
    f.claimedAt = base.toISOString();
    f.claimExpiresAt = new Date(base.getTime() + 2 * 60 * 1000).toISOString();
    mock.messages = [];
    await runDueDiscordFollowUps({
      now: new Date(base.getTime() + 5 * 60 * 1000),
    });
    expect(posts()).toHaveLength(0);
    expect(followUp().status).toBe(DiscordFollowUpStatus.UNCERTAIN);
    await runDueDiscordFollowUps({
      now: new Date(base.getTime() + 20 * 60 * 1000),
    });
    expect(posts()).toHaveLength(0);
  });

  it("cancels when the reviewed question changed after scheduling", async () => {
    const q = setup();
    schedule(q);
    mock.row.data.questions![0]!.text = "A changed question";
    await runDueDiscordFollowUps({ now: due });
    expect(posts()).toHaveLength(0);
    expect(followUp().status).toBe(DiscordFollowUpStatus.CANCELLED);
  });

  it("does not produce two sends when workers run concurrently", async () => {
    const q = setup();
    schedule(q);
    await Promise.all([
      runDueDiscordFollowUps({ now: due }),
      runDueDiscordFollowUps({ now: due }),
    ]);
    expect(posts()).toHaveLength(1);
    await runDueDiscordFollowUps({ now: due });
    expect(posts()).toHaveLength(1);
  });

  it("rechecks an unverified follow-up without posting and resumes the schedule", async () => {
    const q = setup();
    schedule(q);
    followUp().status = DiscordFollowUpStatus.UNVERIFIED;
    followUp().lastError = "coverage incomplete";
    mock.messages = [];
    await recheckFollowUpForQuestion("feature-1", mock.row.revision, "q-1");
    expect(posts()).toHaveLength(0);
    expect(followUp().status).toBe(DiscordFollowUpStatus.SCHEDULED);
    expect(followUp().lastError).toBeNull();
  });

  it("rejects an ownerless schedule", async () => {
    setup();
    delete mock.row.data.questions![0]!.discord!.followUp;
    mock.access.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(
      scheduleFollowUpForQuestion("feature-1", 1, 1),
    ).rejects.toThrow("Forbidden");
    expect(posts()).toHaveLength(0);
  });
});
