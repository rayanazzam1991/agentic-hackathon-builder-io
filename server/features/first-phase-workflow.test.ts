import { DiscordChange, DiscordDeliveryStatus } from "@shared/features/discord";
import {
  AskReviewChange,
  FeatureParticipant,
  QuestionAskApproval,
  QuestionOrigin,
  QuestionStatus,
  SuggestionChange,
  type FeatureData,
} from "@shared/features/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSampleData } from "./sample";

// Real store, suggestion and Discord workflow code over a mocked database and
// Discord API: the whole first-phase path, with no network access.
const mock = vi.hoisted(() => ({
  row: undefined as unknown,
  api: vi.fn(),
  posted: [] as { id: string; content: string }[],
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "owner@example.test",
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: async () => ({ role: "owner" }),
}));
vi.mock("./discord-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./discord-api")>()),
  discordApi: async () => mock.api,
  listDiscordRoles: async () => [role(poRole, "PO"), role(feRole, "Frontend")],
  verifyDiscordChannel: async () => ({
    guildId: guild,
    channelId: channel,
    channelName: "feature-review",
    botId: bot,
  }),
}));
vi.mock("./discord-directory", () => ({
  assertBotCanNotifyPerson: vi.fn(),
  loadDiscordDirectory: vi.fn(),
  verifyDiscordPerson: vi.fn(),
  verifyDiscordRole: vi.fn(),
}));
vi.mock("../db", async () => ({
  schema: await import("../db/schema"),
  getDb: () => ({
    select: () => ({ from: () => ({ where: async () => [mock.row] }) }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            const row = mock.row as { revision: number; id: string };
            if (patch.revision !== row.revision + 1) return [];
            mock.row = { ...row, ...structuredClone(patch) };
            return [{ id: row.id }];
          },
        }),
      }),
    }),
  }),
}));
import {
  checkDiscordReplies,
  sendDiscordQuestion,
  updateDiscord,
} from "./discord-workflow";
import { getFeature } from "./store";
import {
  changeSuggestedQuestion,
  createSuggestedQuestions,
  reviewSuggestedQuestionAsk,
} from "./suggested-questions";

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
const data = () => (mock.row as { data: FeatureData }).data;
const revision = () => (mock.row as { revision: number }).revision;
const questions = () => data().questions!;
const sends = () =>
  mock.api.mock.calls.filter(
    (call) => call[1] !== undefined && /\/messages$/.test(call[0]),
  );
const finding = (text: string, extra = {}) => ({
  text,
  origin: QuestionOrigin.AGENT_FINDING,
  owner: null,
  ownerReason: null,
  evidence: [
    {
      source: "jira" as const,
      excerpt: "Hide it when the cancellation window has expired.",
    },
  ],
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  mock.posted = [];
  mock.row = {
    id: "feature-test",
    title: "Cancellation",
    revision: 1,
    status: QuestionStatus.ANSWERED,
    ownerEmail: "owner@example.test",
    orgId: null,
    visibility: "private",
    data: {
      ...createSampleData("owner@example.test"),
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
    },
  };
  let counter = 0;
  mock.api.mockImplementation(async (path: string, body?: any) => {
    const message = (id: string, content: string) => ({
      id,
      channel_id: channel,
      content,
      timestamp: new Date().toISOString(),
      author: { id: bot, username: "Coordinator", bot: true },
    });
    if (body) {
      const id = `15678174985970076${String(10 + counter++)}`;
      mock.posted.push({ id, content: body.content });
      return message(id, body.content);
    }
    const found = mock.posted.find((m) => path.endsWith(`/${m.id}`));
    if (found) return message(found.id, found.content);
    return mock.posted.map((m) => message(m.id, m.content));
  });
});

describe("first-phase workflow", () => {
  it("runs review → edit → approve → draft → send, and repeat reviews cannot repost", async () => {
    const saved = (await getFeature("feature-test"))!;
    expect(saved.data.discord!.channelId).toBe(channel);

    // The agent review saves several evidence-backed suggestions at once.
    const first = await createSuggestedQuestions("feature-test", revision(), [
      finding("Which refund window applies?", {
        owner: FeatureParticipant.PO,
        ownerReason: "Policy is a product decision.",
        evidence: [
          {
            source: "jira",
            excerpt: "Hide it when the cancellation window has expired.",
          },
          {
            source: "confluence",
            excerpt: "After that, cancellation is unavailable.",
          },
        ],
      }),
      finding("Where does the banner appear?", {
        owner: FeatureParticipant.FE,
        ownerReason: "The UI placement is a frontend concern.",
      }),
      finding("Who pays for return shipping?"),
    ]);
    expect(first.created).toHaveLength(3);
    const [qa, qb, qc] = questions().map((q) => q.id);
    expect(sends()).toHaveLength(0);
    expect(questions().every((q) => q.askApproval.status === "pending")).toBe(
      true,
    );

    // Edit and approve only the selected questions; the unresolved owner stays out.
    await changeSuggestedQuestion("feature-test", revision(), qa!, {
      event: SuggestionChange.EDIT,
      text: "Which refund window applies to partial shipments?",
      recipient: FeatureParticipant.PO,
    });
    await changeSuggestedQuestion("feature-test", revision(), qb!, {
      event: SuggestionChange.EDIT,
      recipient: FeatureParticipant.FE,
    });
    await expect(
      reviewSuggestedQuestionAsk("feature-test", revision(), qc!, {
        event: AskReviewChange.APPROVE,
      }),
    ).rejects.toThrow();
    for (const id of [qa!, qb!])
      await reviewSuggestedQuestionAsk("feature-test", revision(), id, {
        event: AskReviewChange.APPROVE,
      });

    // Review each prepared delivery without sending anything.
    for (const id of [qa!, qb!])
      await updateDiscord("feature-test", revision(), {
        event: DiscordChange.QUESTION_DRAFT,
        questionId: id,
      });
    const draftA = questions()[0]!.discord!.delivery!;
    expect(draftA.status).toBe(DiscordDeliveryStatus.DRAFT);
    expect(draftA.content).toContain(`<@&${poRole}>`);
    expect(draftA.content).toContain(
      "Which refund window applies to partial shipments?",
    );
    expect(draftA.content).toContain("Possible conflict between sources");
    expect(questions()[1]!.discord!.delivery!.content).toContain(
      `<@&${feRole}>`,
    );
    expect(questions()[2]!.discord).toBeUndefined();
    expect(sends()).toHaveLength(0);

    // Send one; the other stays an unsent draft.
    await sendDiscordQuestion("feature-test", revision(), qa!);
    expect(sends()).toHaveLength(1);
    expect(questions()[0]!.discord!.delivery!.status).toBe(
      DiscordDeliveryStatus.SENT,
    );
    expect(questions()[1]!.discord!.delivery!.status).toBe(
      DiscordDeliveryStatus.DRAFT,
    );

    // A repeat review keeps all prior work and skips the sent question.
    const before = structuredClone(questions());
    const again = await createSuggestedQuestions("feature-test", revision(), [
      finding("Which refund window applies to partial shipments?"),
      finding("Where does the banner appear?"),
      finding("Should the banner be dismissible?"),
    ]);
    expect(again.created).toHaveLength(1);
    expect(again.skipped).toHaveLength(2);
    expect(questions().slice(0, 3)).toEqual(before);

    // The sent question cannot be re-drafted, re-edited, re-approved or resent.
    await expect(
      updateDiscord("feature-test", revision(), {
        event: DiscordChange.QUESTION_DRAFT,
        questionId: qa!,
      }),
    ).rejects.toThrow();
    await expect(
      changeSuggestedQuestion("feature-test", revision(), qa!, {
        event: SuggestionChange.EDIT,
        text: "Changed after sending?",
      }),
    ).rejects.toThrow();
    expect(
      (await sendDiscordQuestion("feature-test", revision(), qa!)).changed,
    ).toBe(false);
    expect(sends()).toHaveLength(1);

    // Reading replies never posts and never changes what was sent.
    await checkDiscordReplies("feature-test", revision(), qa!);
    expect(sends()).toHaveLength(1);
    expect(questions()[0]!.discord!.delivery!.status).toBe(
      DiscordDeliveryStatus.SENT,
    );

    // The second question then sends exactly once, independently.
    await sendDiscordQuestion("feature-test", revision(), qb!);
    expect(sends()).toHaveLength(2);
    expect(data().question.approvedBy).toBeNull();
  });
});
