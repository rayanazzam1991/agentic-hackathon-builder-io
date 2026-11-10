import {
  DiscordDeliveryStatus,
  DiscordFollowUpStatus,
} from "@shared/features/discord";
import {
  FeatureParticipant,
  FeatureProgress,
  QuestionAskApproval,
  QuestionRecipientState,
  QuestionStatus,
  QuestionSuggestionStatus,
  type Feature,
  type FeatureQuestionItem,
} from "@shared/features/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  row: undefined as unknown as Feature,
  api: vi.fn(),
  access: vi.fn(),
  messages: [] as any[],
  postCalls: 0,
  loseNextSave: false,
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
      select: () => ({ from: async () => [structuredClone(mock.row)] }),
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: () => ({
            returning: async () => {
              if (mock.loseNextSave) {
                mock.loseNextSave = false;
                mock.row.revision++;
                return [];
              }
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
  verifyDiscordChannel: vi.fn(),
}));
vi.mock("./discord-directory", () => ({
  assertBotCanNotifyPerson: vi.fn(),
  loadDiscordDirectory: vi.fn(),
}));

import {
  checkDiscordReplies,
  syncDiscordReplies,
} from "./discord-workflow";
import { buildFollowUp } from "./discord-followup-schedule";
import { createSampleData } from "./sample";

const guild = "1567817386537648188";
const channel = "1567817498597007531";
const bot = "1567641543010025483";
const personId = "1209141438022025307";
const originalId = "1568996273380528220";
const replyId = "1568996350421631138";
const base = new Date("2026-01-01T10:00:00.000Z");
const person = {
  id: personId,
  username: "po",
  displayName: "Product Owner",
  roles: [],
};

function reply(extra: Record<string, unknown> = {}) {
  return {
    id: replyId,
    channel_id: channel,
    content: "ok approve the 48h",
    timestamp: new Date(base.getTime() + 20 * 60 * 1000).toISOString(),
    author: { id: personId, username: "po", bot: false },
    message_reference: { message_id: originalId },
    ...extra,
  };
}

function setup() {
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
  const question: FeatureQuestionItem = {
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
    recipient: { status: QuestionRecipientState.SELECTED, person },
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
        recipientPerson: person,
      },
      replies: [],
      checkedAt: null,
      partial: false,
    },
  };
  question.discord!.followUp = buildFollowUp({
    featureId: "feature-1",
    questionId: question.id,
    questionText: question.text,
    guildId: guild,
    channelId: channel,
    delivery: question.discord!.delivery!,
    hours: 1,
    now: base,
    actor: "owner@example.test",
    messageAt: base.toISOString(),
  });
  data.questions = [question];
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
  return question;
}

const question = () => mock.row.data.questions![0]!;

beforeEach(() => {
  vi.clearAllMocks();
  mock.messages = [];
  mock.postCalls = 0;
  mock.loseNextSave = false;
  mock.access.mockResolvedValue({ role: "owner" });
  mock.api.mockImplementation(async (path: string) => {
    if (path.includes("/messages?")) return mock.messages;
    throw new Error(`unexpected Discord path ${path}`);
  });
  setup();
});

describe("bulk reply refresh", () => {
  it("skips duplicate writes but saves new replies immediately", async () => {
    const initial = await syncDiscordReplies("feature-1");
    const unchanged = await syncDiscordReplies("feature-1");
    expect(unchanged.changed).toBe(false);
    expect(unchanged.feature.revision).toBe(initial.feature.revision);

    mock.messages = [reply()];
    const updated = await syncDiscordReplies("feature-1");
    expect(updated.changed).toBe(true);
    expect(question().discord!.replies.map((item) => item.id)).toEqual([replyId]);
  });
  it("rechecks and saves replies after a concurrent revision change", async () => {
    mock.messages = [reply()];
    mock.loseNextSave = true;
    await syncDiscordReplies("feature-1");
    expect(question().discord!.replies.map((item) => item.id)).toEqual([replyId]);
    expect(mock.api).toHaveBeenCalledTimes(2);
  });
  it("captures replies when another channel message has a null reference", async () => {
    mock.messages = [reply(), reply({ id: "1568996350421631139", message_reference: null })];
    await syncDiscordReplies("feature-1");
    expect(question().discord!.replies.map((item) => item.id)).toEqual([replyId]);
  });
  it("captures replies to the follow-up and retains them outside the next scan", async () => {
    const followUpId = "1568996273380528221";
    question().discord!.followUp!.followUpMessageId = followUpId;
    question().discord!.followUp!.status = DiscordFollowUpStatus.SENT;
    mock.messages = [reply({ message_reference: { message_id: followUpId } })];
    await syncDiscordReplies("feature-1");
    expect(question().discord!.replies.map((item) => item.id)).toEqual([replyId]);
    mock.messages = [];
    await syncDiscordReplies("feature-1");
    expect(question().discord!.replies.map((item) => item.id)).toEqual([replyId]);
  });

  it("shows a qualifying reply and stops the scheduled follow-up without sending", async () => {
    mock.messages = [reply()];
    const activityBefore = mock.row.data.activity.length;
    await syncDiscordReplies("feature-1");
    expect(mock.postCalls).toBe(0);
    expect(question().discord!.replies).toHaveLength(1);
    expect(question().discord!.replies[0]).toMatchObject({
      id: replyId,
      author: "po",
      text: "ok approve the 48h",
    });
    expect(question().discord!.checkedAt).toBeTruthy();
    expect(question().discord!.followUp!.status).toBe(
      DiscordFollowUpStatus.ANSWERED,
    );
    expect(question().discord!.followUp!.replyId).toBe(replyId);
    // Periodic refresh must not exhaust the activity limit.
    expect(mock.row.data.activity).toHaveLength(activityBefore);
  });

  it("does not mark an unrelated non-reply message as a reply", async () => {
    mock.messages = [
      { ...reply(), message_reference: undefined, content: "same channel" },
    ];
    await syncDiscordReplies("feature-1");
    expect(question().discord!.replies).toEqual([]);
    expect(question().discord!.followUp!.status).toBe(
      DiscordFollowUpStatus.SCHEDULED,
    );
  });

  it("leaves a scheduled follow-up alone when no reply exists", async () => {
    mock.messages = [];
    await syncDiscordReplies("feature-1");
    expect(question().discord!.replies).toEqual([]);
    expect(question().discord!.followUp!.status).toBe(
      DiscordFollowUpStatus.SCHEDULED,
    );
  });

  it("stops the follow-up on the existing per-question check too", async () => {
    mock.messages = [reply()];
    await checkDiscordReplies("feature-1", 1, "q-1");
    expect(question().discord!.replies).toHaveLength(1);
    expect(question().discord!.followUp!.status).toBe(
      DiscordFollowUpStatus.ANSWERED,
    );
  });
});
