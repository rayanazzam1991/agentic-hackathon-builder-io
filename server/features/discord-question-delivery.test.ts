import { DiscordChange, DiscordDeliveryStatus } from "@shared/features/discord";
import {
  FeatureParticipant,
  QuestionAskApproval,
  QuestionRecipientState,
  QuestionStatus,
  type Feature,
  type FeatureQuestionItem,
} from "@shared/features/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSampleData } from "./sample";
const mock = vi.hoisted(() => ({
  row: undefined as unknown,
  access: vi.fn(),
  api: vi.fn(),
  verify: vi.fn(),
  roles: vi.fn(),
  posted: [] as { id: string; content: string; body: any }[],
  notifyPerson: vi.fn(),
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mock.access(...args),
}));
vi.mock("./store", () => ({
  requireActor: () => "owner@example.test",
  getFeature: async () => structuredClone(mock.row),
  changeQuestion: vi.fn(),
}));
vi.mock("./discord-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./discord-api")>()),
  discordApi: async () => mock.api,
  listDiscordRoles: (...args: unknown[]) => mock.roles(...args),
  verifyDiscordChannel: (...args: unknown[]) => mock.verify(...args),
}));
vi.mock("./discord-directory", () => ({
  assertBotCanNotifyPerson: (...args: unknown[]) => mock.notifyPerson(...args),
  loadDiscordDirectory: vi.fn(),
}));
vi.mock("../db", async () => ({
  schema: await import("../db/schema"),
  getDb: () => ({
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            const row = mock.row as Feature;
            if (patch.revision !== row.revision + 1) return [];
            mock.row = { ...row, ...structuredClone(patch) };
            return [{ id: row.id }];
          },
        }),
      }),
    }),
  }),
}));
import sendAction from "../../actions/send-feature-discord-question";
import {
  checkDiscordReplies,
  sendDiscordQuestion,
  updateDiscord,
} from "./discord-workflow";

const guild = "1567817386537648188",
  channel = "1567817498597007531",
  bot = "1567641543010025483",
  poRole = "1567817498597007599",
  feRole = "1567817498597007598";
const role = (id: string, name: string) => ({
  id,
  name,
  mentionable: true,
  mentionPermission: "allowed" as const,
});
const feature = () => mock.row as Feature;
const question = (id: string) =>
  feature().data.questions!.find((q) => q.id === id)!;

function suggested(
  id: string,
  text: string,
  participant: FeatureParticipant,
  roleValue: ReturnType<typeof role>,
): FeatureQuestionItem {
  return {
    id,
    text,
    owner: participant,
    ownerReason: "Test",
    origin: "agent_finding",
    evidence: [],
    suggestion: {
      status: "suggested",
      dismissedBy: null,
      dismissedAt: null,
      reason: null,
    },
    recipient: {
      status: QuestionRecipientState.SELECTED,
      participant,
      role: roleValue,
    },
    status: QuestionStatus.OPEN,
    askApproval: {
      status: QuestionAskApproval.APPROVED,
      by: "owner@example.test",
      at: "2026-01-01T00:00:00.000Z",
      provenance: "owner_confirmed",
    },
    reply: null,
    replyBy: null,
    proposal: null,
    rationale: null,
    approvedBy: null,
    approvedAt: null,
  };
}
async function draft(id: string) {
  await updateDiscord("feature-test", feature().revision, {
    event: DiscordChange.QUESTION_DRAFT,
    questionId: id,
  });
}
const sends = () =>
  mock.api.mock.calls.filter(
    (call) => call[1] !== undefined && /\/messages$/.test(call[0]),
  );

beforeEach(() => {
  vi.clearAllMocks();
  mock.posted = [];
  mock.notifyPerson.mockResolvedValue(undefined);
  mock.access.mockResolvedValue({ role: "owner" });
  mock.roles.mockResolvedValue([role(poRole, "PO"), role(feRole, "Frontend")]);
  mock.verify.mockResolvedValue({
    guildId: guild,
    channelId: channel,
    channelName: "feature-review",
    botId: bot,
  });
  const data = createSampleData("owner@example.test");
  mock.row = {
    id: "feature-test",
    title: "Cancellation",
    revision: 1,
    status: QuestionStatus.OPEN,
    ownerEmail: "owner@example.test",
    canEdit: true,
    canApprove: true,
    data: {
      ...data,
      sample: false,
      discord: {
        guildId: guild,
        channelId: channel,
        channelName: "feature-review",
        botId: bot,
        roleMappings: {
          [FeatureParticipant.PO]: role(poRole, "PO"),
          [FeatureParticipant.FE]: role(feRole, "Frontend"),
        },
        delivery: null,
        replies: [],
        checkedAt: null,
        partial: false,
      },
      questions: [
        suggested(
          "q-a",
          "Which refund window applies?",
          FeatureParticipant.PO,
          role(poRole, "PO"),
        ),
        suggested(
          "q-b",
          "Where does the banner appear?",
          FeatureParticipant.FE,
          role(feRole, "Frontend"),
        ),
      ],
    },
  };
  let counter = 0;
  mock.api.mockImplementation(async (path: string, body?: any) => {
    if (body) {
      const id = `15678174985970076${String(10 + counter++)}`;
      mock.posted.push({ id, content: body.content, body });
      return message(id, body.content);
    }
    const found = mock.posted.find((m) => path.endsWith(`/${m.id}`));
    if (found) return message(found.id, found.content);
    return mock.posted.map((m) => message(m.id, m.content));
  });
});
function message(id: string, content: string, extra = {}) {
  return {
    id,
    channel_id: channel,
    content,
    timestamp: new Date().toISOString(),
    author: { id: bot, username: "Coordinator", bot: true },
    ...extra,
  };
}

describe("individual approved question delivery", () => {
  it("snapshots exact text, recipient and channel without sending", async () => {
    await draft("q-a");
    const delivery = question("q-a").discord!.delivery!;
    expect(delivery).toMatchObject({
      status: DiscordDeliveryStatus.DRAFT,
      questionText: "Which refund window applies?",
      channelId: channel,
      recipientRole: { id: poRole },
    });
    expect(delivery.content).toMatch(
      new RegExp(
        `^<@&${poRole}> Which refund window applies\\?\\n\\n.*feature-test/q-a/`,
      ),
    );
    expect(question("q-b").discord).toBeUndefined();
    expect(mock.api).not.toHaveBeenCalled();
  });
  it("quotes the cited evidence and sources, within Discord's limit", async () => {
    question("q-a").evidence = [
      {
        source: "jira",
        excerpt: "Refunds within 14 days.",
        version: "PROJ-1",
        url: "https://example.atlassian.net/browse/PROJ-1",
      },
      {
        source: "confluence",
        excerpt: "x".repeat(600),
        version: "7",
        url: "https://example.atlassian.net/wiki/spaces/A/pages/7",
      },
      {
        source: "figma",
        excerpt: "Refund window: 30 days",
        version: "v3",
        url: "https://www.figma.com/design/abc",
      },
    ];
    await draft("q-a");
    const { content } = question("q-a").discord!.delivery!;
    expect(content).toContain("Possible conflict between sources:");
    expect(content).toContain('• Jira (PROJ-1): "Refunds within 14 days."');
    expect(content).toContain(
      "<https://example.atlassian.net/wiki/spaces/A/pages/7>",
    );
    expect(content).toContain("<https://www.figma.com/design/abc>");
    expect(content).toContain("feature-test/q-a/");
    expect(content.length).toBeLessThanOrEqual(2000);
    expect(mock.api).not.toHaveBeenCalled();
  });
  it("labels a single source as evidence, not a conflict", async () => {
    question("q-a").evidence = [
      { source: "jira", excerpt: "Refunds within 14 days.", version: "P-1" },
    ];
    await draft("q-a");
    const { content } = question("q-a").discord!.delivery!;
    expect(content).toContain("Evidence:");
    expect(content).not.toContain("conflict");
  });
  it("requires owner approval, a selected recipient and ownership before drafting", async () => {
    question("q-a").askApproval = { status: "pending", by: null, at: null };
    await expect(draft("q-a")).rejects.toThrow("approve");
    mock.access.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(draft("q-b")).rejects.toThrow("Forbidden");
    expect(mock.api).not.toHaveBeenCalled();
  });
  it("sends one question with targeted mentions and leaves others untouched", async () => {
    await draft("q-a");
    await draft("q-b");
    const result = await sendDiscordQuestion(
      "feature-test",
      feature().revision,
      "q-a",
    );
    expect(result.changed).toBe(true);
    expect(question("q-a").discord!.delivery!.status).toBe(
      DiscordDeliveryStatus.SENT,
    );
    expect(question("q-a").discord!.delivery!.messageId).toBe(
      mock.posted[0]!.id,
    );
    expect(question("q-b").discord!.delivery!.status).toBe(
      DiscordDeliveryStatus.DRAFT,
    );
    expect(feature().data.discord!.delivery).toBeNull();
    expect(sends()).toHaveLength(1);
    expect(sends()[0]![1].allowed_mentions).toEqual({
      parse: [],
      roles: [poRole],
      users: [],
      replied_user: false,
    });
    expect(mock.api).toHaveBeenCalledWith(
      `/channels/${channel}/messages/${mock.posted[0]!.id}`,
    );
  });
  it("delivers two questions independently, each exactly once", async () => {
    await draft("q-a");
    await draft("q-b");
    await sendDiscordQuestion("feature-test", feature().revision, "q-a");
    await sendDiscordQuestion("feature-test", feature().revision, "q-b");
    expect(sends()).toHaveLength(2);
    expect(mock.posted[1]!.body.allowed_mentions.roles).toEqual([feRole]);
    // A second send of either question is a no-op.
    const again = await sendDiscordQuestion(
      "feature-test",
      feature().revision,
      "q-a",
    );
    expect(again.changed).toBe(false);
    expect(sends()).toHaveLength(2);
  });
  it("records the outcome of an in-flight send even when another question is reserved meanwhile", async () => {
    await draft("q-a");
    await draft("q-b");
    const base = mock.api.getMockImplementation()!;
    let released = false;
    mock.api.mockImplementation(async (path: string, body?: any) => {
      const result = await base(path, body);
      if (body && !released) {
        released = true;
        // Another question is sent while A is mid-flight.
        await sendDiscordQuestion("feature-test", feature().revision, "q-b");
      }
      return result;
    });
    await sendDiscordQuestion("feature-test", feature().revision, "q-a");
    expect(question("q-a").discord!.delivery!.status).toBe(
      DiscordDeliveryStatus.SENT,
    );
    expect(question("q-b").discord!.delivery!.status).toBe(
      DiscordDeliveryStatus.SENT,
    );
    expect(sends()).toHaveLength(2);
  });
  it("allows only one send when two requests share a revision", async () => {
    await draft("q-a");
    const revision = feature().revision;
    const settled = await Promise.allSettled([
      sendDiscordQuestion("feature-test", revision, "q-a"),
      sendDiscordQuestion("feature-test", revision, "q-a"),
    ]);
    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(sends()).toHaveLength(1);
  });
  it("refuses unapproved, undrafted and stale-snapshot sends before any request", async () => {
    await expect(sendDiscordQuestion("feature-test", 1, "q-a")).rejects.toThrow(
      "draft",
    );
    await draft("q-a");
    question("q-a").text = "Edited after review?";
    await expect(
      sendDiscordQuestion("feature-test", feature().revision, "q-a"),
    ).rejects.toThrow("changed after review");
    question("q-a").text = "Which refund window applies?";
    question("q-a").recipient.role = role(feRole, "Frontend");
    await expect(
      sendDiscordQuestion("feature-test", feature().revision, "q-a"),
    ).rejects.toThrow("changed after review");
    question("q-a").recipient.role = role(poRole, "PO");
    question("q-a").askApproval = { status: "pending", by: null, at: null };
    await expect(
      sendDiscordQuestion("feature-test", feature().revision, "q-a"),
    ).rejects.toThrow("approve");
    expect(mock.api).not.toHaveBeenCalled();
  });
  it("does not retarget a reviewed draft when role mappings change", async () => {
    await draft("q-a");
    feature().data.discord!.roleMappings = {
      [FeatureParticipant.PO]: role(feRole, "Frontend"),
    };
    await sendDiscordQuestion("feature-test", feature().revision, "q-a");
    expect(sends()[0]![1].allowed_mentions.roles).toEqual([poRole]);
    expect(question("q-a").discord!.delivery!.recipientRole!.id).toBe(poRole);
  });
  it("blocks a missing or non-notifiable role before reserving", async () => {
    await draft("q-a");
    mock.roles.mockResolvedValueOnce([]);
    await expect(
      sendDiscordQuestion("feature-test", feature().revision, "q-a"),
    ).rejects.toThrow("no longer exists");
    mock.roles.mockResolvedValueOnce([
      { ...role(poRole, "PO"), mentionPermission: "denied" },
    ]);
    await expect(
      sendDiscordQuestion("feature-test", feature().revision, "q-a"),
    ).rejects.toThrow("Discord denies");
    mock.roles.mockResolvedValueOnce([
      { ...role(poRole, "PO"), mentionPermission: "unknown" },
    ]);
    await expect(
      sendDiscordQuestion("feature-test", feature().revision, "q-a"),
    ).rejects.toThrow("Could not verify");
    expect(question("q-a").discord!.delivery!.status).toBe(
      DiscordDeliveryStatus.DRAFT,
    );
    expect(sends()).toHaveLength(0);
  });
  it("preserves uncertainty after a timeout, refuses a repost and leaves siblings sendable", async () => {
    await draft("q-a");
    await draft("q-b");
    mock.api.mockRejectedValueOnce(new Error("timeout"));
    const result = await sendDiscordQuestion(
      "feature-test",
      feature().revision,
      "q-a",
    );
    expect(
      result.feature.data.questions!.find((q) => q.id === "q-a")!.discord!
        .delivery!.status,
    ).toBe(DiscordDeliveryStatus.UNCERTAIN);
    await expect(
      sendDiscordQuestion("feature-test", feature().revision, "q-a"),
    ).rejects.toThrow("pending");
    // Only the original (timed-out) POST was attempted.
    expect(sends()).toHaveLength(1);
    await sendDiscordQuestion("feature-test", feature().revision, "q-b");
    expect(question("q-b").discord!.delivery!.status).toBe(
      DiscordDeliveryStatus.SENT,
    );
  });
  it("marks a mismatched readback uncertain, then reconciles it from the channel without reposting", async () => {
    await draft("q-a");
    const base = mock.api.getMockImplementation()!;
    mock.api
      .mockImplementationOnce(base)
      .mockImplementationOnce(async () =>
        message(mock.posted[0]!.id, "different"),
      );
    await sendDiscordQuestion("feature-test", feature().revision, "q-a");
    expect(question("q-a").discord!.delivery!.status).toBe(
      DiscordDeliveryStatus.UNCERTAIN,
    );
    const reply = message("1567817498597007700", "48 hours", {
      author: { id: "1567817498597007701", username: "PO" },
      message_reference: { message_id: mock.posted[0]!.id },
    });
    mock.api.mockImplementation(async () => [
      message(mock.posted[0]!.id, mock.posted[0]!.content),
      reply,
    ]);
    const checked = await checkDiscordReplies(
      "feature-test",
      feature().revision,
      "q-a",
    );
    const thread = checked.data.questions!.find(
      (q) => q.id === "q-a",
    )!.discord!;
    expect(thread.delivery!.status).toBe(DiscordDeliveryStatus.SENT);
    expect(thread.delivery!.messageId).toBe(mock.posted[0]!.id);
    expect(thread.replies.map((r) => r.text)).toEqual(["48 hours"]);
    expect(feature().data.discord!.replies).toEqual([]);
    expect(sends()).toHaveLength(1);
  });
  it("keeps delivery uncertain when the message is not found, and rejects checks while in progress", async () => {
    await draft("q-a");
    mock.api.mockRejectedValueOnce(new Error("timeout"));
    await sendDiscordQuestion("feature-test", feature().revision, "q-a");
    mock.api.mockImplementation(async () => []);
    const checked = await checkDiscordReplies(
      "feature-test",
      feature().revision,
      "q-a",
    );
    expect(checked.data.questions![0]!.discord!.delivery!.status).toBe(
      DiscordDeliveryStatus.UNCERTAIN,
    );
    question("q-a").discord!.delivery!.status = DiscordDeliveryStatus.SENDING;
    question("q-a").discord!.delivery!.requestedAt = new Date().toISOString();
    await expect(
      checkDiscordReplies("feature-test", feature().revision, "q-a"),
    ).rejects.toThrow("in progress");
  });
  it("rejects checks on an undrafted question and unknown ids", async () => {
    await expect(checkDiscordReplies("feature-test", 1, "q-a")).rejects.toThrow(
      "Send the reviewed",
    );
    await expect(
      sendDiscordQuestion("feature-test", 1, "missing"),
    ).rejects.toThrow("not found");
  });
  it("refuses a changed bot identity before reserving", async () => {
    await draft("q-a");
    const revision = feature().revision;
    mock.verify.mockResolvedValueOnce({ botId: "1567641543010025484" });
    await expect(
      sendDiscordQuestion("feature-test", revision, "q-a"),
    ).rejects.toThrow("identity changed");
    expect(feature().revision).toBe(revision);
    expect(mock.api).not.toHaveBeenCalled();
  });
  it("blocks agent/tool callers and reconnecting a channel after a question was sent", async () => {
    await expect(
      sendAction.run({ id: "feature-test", revision: 1, questionId: "q-a" }, {
        caller: "tool",
      } as any),
    ).rejects.toThrow("feature screen");
    await draft("q-a");
    await sendDiscordQuestion("feature-test", feature().revision, "q-a");
    await expect(
      updateDiscord("feature-test", feature().revision, {
        event: DiscordChange.CONNECT,
        channelUrl: `https://discord.com/channels/${guild}/${channel}`,
      }),
    ).rejects.toThrow("cannot be replaced");
  });
});

describe("individual recipients", () => {
  const dana = {
    id: "1567641543010025401",
    username: "dana",
    displayName: "Dana",
    roles: [{ id: poRole, name: "PO" }],
  };
  const erin = { ...dana, id: "1567641543010025402", displayName: "Erin" };
  const toPerson = (id: string, person: typeof dana) => {
    const q = question(id);
    delete q.recipient.role;
    q.recipient = { status: QuestionRecipientState.SELECTED, person };
  };

  it("snapshots the exact person and mentions only them", async () => {
    toPerson("q-a", dana);
    await draft("q-a");
    const delivery = question("q-a").discord!.delivery!;
    expect(delivery.recipientPerson).toEqual(dana);
    expect(delivery.recipientRole).toBeUndefined();
    expect(delivery.content).toMatch(
      new RegExp(`^<@${dana.id}> Which refund window applies\\?`),
    );
    expect(mock.api).not.toHaveBeenCalled();
    await sendDiscordQuestion("feature-test", feature().revision, "q-a");
    expect(mock.notifyPerson).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: channel }),
      dana.id,
    );
    expect(sends()[0]![1].allowed_mentions).toEqual({
      parse: [],
      roles: [],
      users: [dana.id],
      replied_user: false,
    });
    expect(question("q-a").discord!.delivery!.status).toBe(
      DiscordDeliveryStatus.SENT,
    );
  });
  it("sends a person and a role question independently", async () => {
    toPerson("q-a", dana);
    await draft("q-a");
    await draft("q-b");
    await sendDiscordQuestion("feature-test", feature().revision, "q-a");
    expect(question("q-b").discord!.delivery!.status).toBe(
      DiscordDeliveryStatus.DRAFT,
    );
    await sendDiscordQuestion("feature-test", feature().revision, "q-b");
    expect(mock.posted.map((m) => m.body.allowed_mentions)).toEqual([
      { parse: [], roles: [], users: [dana.id], replied_user: false },
      { parse: [], roles: [feRole], users: [], replied_user: false },
    ]);
    expect(mock.notifyPerson).toHaveBeenCalledTimes(1);
  });
  it("stops before reserving when the person can no longer be notified", async () => {
    toPerson("q-a", dana);
    await draft("q-a");
    mock.notifyPerson.mockRejectedValue(new Error("cannot view the channel"));
    await expect(
      sendDiscordQuestion("feature-test", feature().revision, "q-a"),
    ).rejects.toThrow("cannot view");
    expect(sends()).toHaveLength(0);
    expect(question("q-a").discord!.delivery!.status).toBe(
      DiscordDeliveryStatus.DRAFT,
    );
    mock.notifyPerson.mockResolvedValue(undefined);
    await sendDiscordQuestion("feature-test", feature().revision, "q-a");
    expect(sends()).toHaveLength(1);
  });
  it("refuses a reviewed draft after the recipient changed to another person or a role", async () => {
    toPerson("q-a", dana);
    await draft("q-a");
    toPerson("q-a", erin);
    await expect(
      sendDiscordQuestion("feature-test", feature().revision, "q-a"),
    ).rejects.toThrow("changed after review");
    question("q-a").recipient = {
      status: QuestionRecipientState.SELECTED,
      role: role(poRole, "PO"),
    };
    await expect(
      sendDiscordQuestion("feature-test", feature().revision, "q-a"),
    ).rejects.toThrow("changed after review");
    expect(sends()).toHaveLength(0);
    expect(question("q-a").discord!.delivery!.recipientPerson).toEqual(dana);
  });
});

describe("opt-in follow-up schedule", () => {
  it("schedules one follow-up only after the send is confirmed, without another POST", async () => {
    await draft("q-a");
    const result = await sendDiscordQuestion(
      "feature-test",
      feature().revision,
      "q-a",
      2,
    );
    expect(result.changed).toBe(true);
    const scheduled = question("q-a").discord!.followUp!;
    expect(scheduled.status).toBe("scheduled");
    expect(scheduled.hours).toBe(2);
    expect(
      Date.parse(scheduled.dueAt) - Date.parse(scheduled.createdAt),
    ).toBe(2 * 60 * 60 * 1000);
    expect(scheduled.messageId).toBe(mock.posted[0]!.id);
    expect(Number.isNaN(Date.parse(scheduled.messageAt!))).toBe(false);
    expect(scheduled.content).toContain(`<@&${poRole}>`);
    expect(sends()).toHaveLength(1);
  });
});
