import { DiscordChange, DiscordDeliveryStatus } from "@shared/features/discord";
import {
  FeatureParticipant,
  QuestionStatus,
  type Feature,
} from "@shared/features/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSampleData } from "./sample";
const mock = vi.hoisted(() => ({
  row: undefined as unknown,
  access: vi.fn(),
  api: vi.fn(),
  verify: vi.fn(),
  reply: vi.fn(),
  roles: vi.fn(),
  setup: vi.fn(),
  setupRoles: vi.fn(),
}));
vi.mock("./discord-settings", () => ({
  readDiscordSetup: () => mock.setup(),
  readSetupRoles: () => mock.setupRoles(),
  setupToBinding: (setup: Record<string, unknown>) => ({ ...setup, delivery: null, replies: [], checkedAt: null, partial: false }),
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mock.access(...args),
}));
vi.mock("./store", () => ({
  requireActor: () => "owner@example.test",
  getFeature: async () => structuredClone(mock.row),
  changeQuestion: (...args: unknown[]) => mock.reply(...args),
}));
vi.mock("./discord-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./discord-api")>()),
  discordApi: async () => mock.api,
  listDiscordRoles: (...args: unknown[]) => mock.roles(...args),
  verifyDiscordChannel: (...args: unknown[]) => mock.verify(...args),
}));
vi.mock("../db", async () => ({
  schema: await import("../db/schema"),
  getDb: () => ({
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            // SQL compare-and-set: the revision in a patch belongs to its observed predecessor.
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
  applyDiscordSetup,
  sendDiscordQuestion,
  updateDiscord,
} from "./discord-workflow";
const guild = "1567817386537648188",
  channel = "1567817498597007531",
  bot = "1567641543010025483",
  messageId = "1567817498597007532";
function feature() {
  return mock.row as Feature;
}
function message(extra: Record<string, unknown> = {}) {
  return {
    id: messageId,
    channel_id: channel,
    content: feature().data.discord!.delivery!.content,
    timestamp: new Date().toISOString(),
    author: { id: bot, username: "Coordinator", bot: true },
    ...extra,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.access.mockResolvedValue({ role: "owner" });
  mock.roles.mockResolvedValue([
    {
      id: "1567817498597007599",
      name: "PO",
      mentionable: true,
      mentionPermission: "allowed",
    },
  ]);
  mock.verify.mockResolvedValue({
    guildId: guild,
    channelId: channel,
    channelName: "feature-review",
    botId: bot,
  });
  mock.row = {
    id: "feature-test",
    title: "Cancellation",
    revision: 1,
    status: QuestionStatus.OPEN,
    ownerEmail: "owner@example.test",
    canEdit: true,
    canApprove: true,
    data: {
      ...createSampleData("owner@example.test"),
      sample: false,
      discord: {
        guildId: guild,
        channelId: channel,
        channelName: "feature-review",
        botId: bot,
        delivery: {
          status: DiscordDeliveryStatus.DRAFT,
          nonce: "unique",
          content:
            "Use 24 or 48 hours?\n\nFeature Coordinator reference: feature-test/unique",
          requestedAt: null,
          messageId: null,
        },
        replies: [],
        checkedAt: null,
        partial: false,
      },
    },
  };
  mock.api.mockImplementation(async (_path, body) => message());
});
describe("Discord delivery and reply boundaries", () => {
  it("never overwrites an existing Discord channel or history with defaults", async () => {
    const before = structuredClone(feature());
    await expect(applyDiscordSetup("feature-test", 1)).rejects.toThrow("already has a Discord channel");
    expect(feature()).toEqual(before);
    expect(mock.setup).not.toHaveBeenCalled();
  });
  it("applies verified defaults only to an owned feature without a channel", async () => {
    delete feature().data.discord;
    mock.setup.mockResolvedValue({ guildId: guild, channelId: channel, channelName: "feature-review", botId: bot, roleMappings: {} });
    mock.setupRoles.mockResolvedValue([]);
    const result = await applyDiscordSetup("feature-test", 1);
    expect(mock.access).toHaveBeenCalledWith("coordination-feature", "feature-test", "owner");
    expect(result.data.discord?.channelId).toBe(channel);
    expect(result.data.discord?.delivery).toBeNull();
    expect(mock.api).not.toHaveBeenCalled();
  });
  it("blocks agent/tool posting before any provider request", async () => {
    await expect(
      sendAction.run({ id: "feature-test", revision: 1 }, { caller: "tool" }),
    ).rejects.toThrow("feature screen");
    expect(mock.api).not.toHaveBeenCalled();
    expect(mock.verify).not.toHaveBeenCalled();
  });
  it("checks ownership and rejects stale writes before provider requests", async () => {
    mock.access.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(sendDiscordQuestion("feature-test", 1)).rejects.toThrow(
      "Forbidden",
    );
    await expect(sendDiscordQuestion("feature-test", 2)).rejects.toThrow(
      "changed",
    );
    expect(mock.verify).not.toHaveBeenCalled();
  });
  it("posts exact reviewed content once and confirms it with GET", async () => {
    const result = await sendDiscordQuestion("feature-test", 1);
    expect(result.feature.data.discord!.delivery!.status).toBe(
      DiscordDeliveryStatus.SENT,
    );
    expect(result.feature.revision).toBe(3);
    expect(mock.api).toHaveBeenCalledWith(`/channels/${channel}/messages`, {
      content: feature().data.discord!.delivery!.content,
      nonce: "unique",
      enforce_nonce: true,
      allowed_mentions: { parse: [] },
    });
    expect(mock.api).toHaveBeenCalledWith(
      `/channels/${channel}/messages/${messageId}`,
    );
    const again = await sendDiscordQuestion("feature-test", 3);
    expect(again.changed).toBe(false);
    expect(
      mock.api.mock.calls.filter((call) => call[1] !== undefined),
    ).toHaveLength(1);
  });
  it("allows only one send when two requests share a revision", async () => {
    const result = await Promise.allSettled([
      sendDiscordQuestion("feature-test", 1),
      sendDiscordQuestion("feature-test", 1),
    ]);
    expect(result.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(
      mock.api.mock.calls.filter((call) => call[1] !== undefined),
    ).toHaveLength(1);
  });
  it("preserves uncertainty after a POST timeout and refuses a repost", async () => {
    mock.api.mockRejectedValueOnce(new Error("timeout"));
    const result = await sendDiscordQuestion("feature-test", 1);
    expect(result.feature.data.discord!.delivery!.status).toBe(
      DiscordDeliveryStatus.UNCERTAIN,
    );
    await expect(sendDiscordQuestion("feature-test", 3)).rejects.toThrow(
      "pending",
    );
    expect(mock.api).toHaveBeenCalledTimes(1);
  });
  it("refuses changed bot identity before reserving or posting", async () => {
    mock.verify.mockResolvedValueOnce({ botId: "1567641543010025484" });
    await expect(sendDiscordQuestion("feature-test", 1)).rejects.toThrow(
      "identity changed",
    );
    expect(feature().revision).toBe(1);
    expect(mock.api).not.toHaveBeenCalled();
  });
  it("does not claim a mismatched readback as confirmed", async () => {
    mock.api
      .mockResolvedValueOnce(message())
      .mockResolvedValueOnce(message({ content: "different" }));
    const result = await sendDiscordQuestion("feature-test", 1);
    expect(result.feature.data.discord!.delivery!.status).toBe(
      DiscordDeliveryStatus.UNCERTAIN,
    );
  });
  it("reconciles the exact bot question and captures only direct human replies", async () => {
    feature().data.discord!.delivery!.status = DiscordDeliveryStatus.UNCERTAIN;
    const reply = message({
      id: "1567817498597007533",
      author: { id: "1567817498597007534", username: "PO" },
      content: "Use 48 hours",
      message_reference: { message_id: messageId },
    });
    mock.api.mockResolvedValueOnce([
      message(),
      reply,
      message({
        id: "1567817498597007535",
        author: { id: "1567817498597007534", username: "PO" },
        content: "Unrelated",
      }),
      message({
        id: "1567817498597007536",
        content: "A bot answer",
        message_reference: { message_id: messageId },
      }),
    ]);
    const result = await checkDiscordReplies("feature-test", 1);
    expect(result.data.discord!.delivery!.status).toBe(
      DiscordDeliveryStatus.SENT,
    );
    expect(result.data.discord!.replies.map((r) => r.text)).toEqual([
      "Use 48 hours",
    ]);
    expect(mock.reply).not.toHaveBeenCalled();
    expect(mock.api.mock.calls.every((call) => call[1] === undefined)).toBe(
      true,
    );
  });
  it("rejects reconciliation while the outbound request may still be active", async () => {
    feature().data.discord!.delivery!.status = DiscordDeliveryStatus.SENDING;
    feature().data.discord!.delivery!.requestedAt = new Date().toISOString();
    await expect(checkDiscordReplies("feature-test", 1)).rejects.toThrow(
      "in progress",
    );
    expect(mock.api).not.toHaveBeenCalled();
  });
  it("rechecks a selected reply and records actual message provenance", async () => {
    feature().data.discord!.delivery!.messageId = messageId;
    const id = "1567817498597007533";
    const url = `https://discord.com/channels/${guild}/${channel}/${id}`;
    feature().data.discord!.replies = [
      {
        id,
        authorId: "1567817498597007534",
        author: "PO",
        text: "Use 48 hours",
        at: new Date().toISOString(),
        url,
      },
    ];
    mock.api.mockResolvedValueOnce(
      message({
        id,
        author: { id: "1567817498597007534", username: "PO" },
        content: "Use 48 hours",
        message_reference: { message_id: messageId },
      }),
    );
    await updateDiscord("feature-test", 1, {
      event: DiscordChange.RECORD,
      messageId: id,
    });
    expect(mock.reply).toHaveBeenCalledWith(
      "feature-test",
      1,
      {
        event: "reply",
        text: "Use 48 hours",
        respondent: "PO (1567817498597007534)",
      },
      url,
    );
  });
  it("does not record an edited reply", async () => {
    feature().data.discord!.delivery!.messageId = messageId;
    const id = "1567817498597007533";
    feature().data.discord!.replies = [
      {
        id,
        authorId: "1567817498597007534",
        author: "PO",
        text: "old",
        at: "now",
        url: `https://discord.com/channels/${guild}/${channel}/${id}`,
      },
    ];
    mock.api.mockResolvedValueOnce(
      message({
        id,
        author: { id: "1567817498597007534", username: "PO" },
        content: "new",
        message_reference: { message_id: messageId },
      }),
    );
    await expect(
      updateDiscord("feature-test", 1, {
        event: DiscordChange.RECORD,
        messageId: id,
      }),
    ).rejects.toThrow("changed");
    expect(mock.reply).not.toHaveBeenCalled();
  });
});

describe("Discord role mappings and targeted notifications", () => {
  const roleId = "1567817498597007599";
  it("saves only roles verified against the connected guild and preserves the existing draft", async () => {
    const original = structuredClone(feature().data.discord!.delivery);
    const result = await updateDiscord("feature-test", 1, {
      event: DiscordChange.ROLES,
      mappings: { [FeatureParticipant.PO]: roleId },
    });
    expect(result.data.discord!.roleMappings?.[FeatureParticipant.PO]).toEqual({
      id: roleId,
      name: "PO",
      mentionable: true,
      mentionPermission: "allowed",
    });
    expect(mock.roles).toHaveBeenCalledWith(guild);
    expect(result.data.discord!.delivery).toEqual(original);
    expect(mock.api).not.toHaveBeenCalled();
  });
  it("rejects an unknown role and does not overwrite saved state", async () => {
    await expect(
      updateDiscord("feature-test", 1, {
        event: DiscordChange.ROLES,
        mappings: { [FeatureParticipant.PO]: "1567817498597007588" },
      }),
    ).rejects.toThrow("no longer available");
    expect(feature().revision).toBe(1);
  });
  it("checks ownership and stale revision before listing provider roles", async () => {
    mock.access.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(
      updateDiscord("feature-test", 1, {
        event: DiscordChange.ROLES,
        mappings: {},
      }),
    ).rejects.toThrow("Forbidden");
    await expect(
      updateDiscord("feature-test", 2, {
        event: DiscordChange.ROLES,
        mappings: {},
      }),
    ).rejects.toThrow("changed");
    expect(mock.roles).not.toHaveBeenCalled();
  });
  it("snapshots the question owner's role and only permits that role at send time", async () => {
    feature().data.discord!.roleMappings = {
      [FeatureParticipant.PO]: {
        id: roleId,
        name: "PO",
        mentionable: true,
        mentionPermission: "allowed",
      },
    };
    const drafted = await updateDiscord("feature-test", 1, {
      event: DiscordChange.DRAFT,
      text: "@everyone Confirm the window?",
    });
    expect(drafted.data.discord!.delivery!.content).toMatch(
      /^<@&1567817498597007599> @everyone/,
    );
    expect(drafted.data.discord!.delivery!.recipientRole!.id).toBe(roleId);
    // Changing mapping after preview cannot redirect this already reviewed draft.
    feature().data.discord!.roleMappings = {};
    await sendDiscordQuestion("feature-test", 2);
    const body = mock.api.mock.calls.find((call) => call[1] !== undefined)![1];
    expect(body.allowed_mentions).toEqual({
      parse: [],
      roles: [roleId],
      users: [],
      replied_user: false,
    });
  });
  it("saves a targeted draft without notification checks even when a role is not mentionable", async () => {
    feature().data.discord!.roleMappings = {
      [FeatureParticipant.PO]: { id: roleId, name: "PO", mentionable: false },
    };
    const saved = await updateDiscord("feature-test", 1, {
      event: DiscordChange.DRAFT,
      text: "Confirm?",
    });
    expect(saved.data.discord!.delivery!.recipientRole!.id).toBe(roleId);
    expect(saved.data.discord!.delivery!.content).toContain(`<@&${roleId}>`);
    expect(mock.roles).not.toHaveBeenCalled();
    expect(mock.api).not.toHaveBeenCalled();
  });
  it.each(["denied", "unknown"] as const)(
    "blocks %s permission before reservation without losing the draft",
    async (permission) => {
      feature().data.discord!.delivery!.recipientRole = {
        id: roleId,
        name: "PO",
        mentionable: false,
      };
      mock.roles.mockResolvedValueOnce([
        {
          id: roleId,
          name: "PO",
          mentionable: false,
          mentionPermission: permission,
        },
      ]);
      await expect(sendDiscordQuestion("feature-test", 1)).rejects.toThrow(
        permission === "denied" ? "Discord denies" : "Could not verify",
      );
      expect(feature().revision).toBe(1);
      expect(feature().data.discord!.delivery!.status).toBe(
        DiscordDeliveryStatus.DRAFT,
      );
      expect(mock.api).not.toHaveBeenCalled();
    },
  );
  it("sends a non-mentionable role when effective permissions allow it", async () => {
    feature().data.discord!.delivery!.recipientRole = {
      id: roleId,
      name: "PO",
      mentionable: false,
    };
    mock.roles.mockResolvedValueOnce([
      {
        id: roleId,
        name: "PO",
        mentionable: false,
        mentionPermission: "allowed",
      },
    ]);
    await sendDiscordQuestion("feature-test", 1);
    expect(mock.roles).toHaveBeenCalledWith(
      guild,
      expect.objectContaining({ channelId: channel, botId: bot }),
    );
    expect(mock.api.mock.calls[0]![1].allowed_mentions.roles).toEqual([roleId]);
  });
  it("refuses a role removed after preview before posting", async () => {
    feature().data.discord!.delivery!.recipientRole = {
      id: roleId,
      name: "PO",
      mentionable: true,
    };
    mock.roles.mockResolvedValueOnce([]);
    await expect(sendDiscordQuestion("feature-test", 1)).rejects.toThrow(
      "no longer exists",
    );
    expect(mock.api).not.toHaveBeenCalled();
    expect(feature().revision).toBe(1);
  });
});
