import type { FeatureDiscord } from "@shared/features/discord";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  api: vi.fn(),
  roles: vi.fn(),
}));
vi.mock("./discord-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./discord-api")>()),
  discordApi: async () => mock.api,
  listDiscordRoles: (...args: unknown[]) => mock.roles(...args),
}));
import { DiscordApiError } from "./discord-api";
import {
  assertBotCanNotifyPerson,
  loadDiscordDirectory,
  verifyDiscordPerson,
  verifyDiscordRole,
} from "./discord-directory";

const guild = "1567817386537648188",
  channel = "1567817498597007531",
  bot = "1567641543010025483",
  owner = "1567641543010025400",
  alice = "1567641543010025401",
  bob = "1567641543010025402",
  carol = "1567641543010025403",
  helper = "1567641543010025404",
  backend = "1567817498597007501",
  ghost = "1567817498597007599";
const VIEW = 1024n,
  SEND = 2048n;
const binding: FeatureDiscord = {
  guildId: guild,
  channelId: channel,
  channelName: "feature-review",
  botId: bot,
  delivery: null,
  replies: [],
  checkedAt: null,
  partial: false,
};
const member = (id: string, name: string, roles: string[], extra = {}) => ({
  user: { id, username: name, global_name: null },
  nick: null,
  roles,
  ...extra,
});
let members: unknown[];
let overwrites: unknown[];
let botRoles: string[];
let everyone: bigint;
let memberList: () => unknown;
function route(path: string, body?: unknown) {
  if (body !== undefined) throw new Error("no write expected");
  if (path === `/guilds/${guild}/roles`)
    return [
      {
        id: guild,
        name: "@everyone",
        permissions: String(everyone),
        managed: false,
      },
      { id: backend, name: "Backend", permissions: "0", managed: false },
      {
        id: "1567817498597007502",
        name: "Bot role",
        permissions: "0",
        managed: true,
      },
    ];
  if (path === `/channels/${channel}`)
    return {
      id: channel,
      guild_id: guild,
      type: 0,
      permission_overwrites: overwrites,
    };
  if (path === `/guilds/${guild}`) return { owner_id: owner };
  if (path.startsWith(`/guilds/${guild}/members?`)) return memberList();
  if (path === `/guilds/${guild}/members/${bot}`)
    return member(bot, "bot", botRoles, {
      user: { id: bot, username: "bot", bot: true },
    });
  const one = /\/members\/(\d+)$/.exec(path);
  const found = members.find(
    (item) => (item as { user: { id: string } }).user.id === one?.[1],
  );
  if (!found) throw new DiscordApiError("Unknown member", 404);
  return found;
}
beforeEach(() => {
  vi.clearAllMocks();
  everyone = VIEW | SEND;
  // The channel hides itself from everyone; only Backend may view it.
  overwrites = [
    { id: guild, type: 0, allow: "0", deny: String(VIEW) },
    { id: backend, type: 0, allow: String(VIEW), deny: "0" },
  ];
  botRoles = [backend];
  members = [
    member(owner, "olivia", []),
    member(alice, "alice", [backend, "1567817498597007502"], {
      nick: "Alice A.",
    }),
    member(bob, "bob", []),
    member(carol, "carol", [ghost]),
    member(helper, "helper", [backend], {
      user: { id: helper, username: "helper", bot: true },
    }),
  ];
  memberList = () => members;
  mock.api.mockImplementation(async (path: string, body?: unknown) =>
    route(path, body),
  );
  mock.roles.mockResolvedValue([
    {
      id: backend,
      name: "Backend",
      mentionable: true,
      mentionPermission: "allowed",
    },
  ]);
});

describe("Discord people directory", () => {
  it("lists people with role associations and verified channel visibility", async () => {
    const directory = await loadDiscordDirectory(binding);
    const byName = Object.fromEntries(
      directory.people.map((p) => [p.username, p]),
    );
    expect(byName.alice).toMatchObject({
      displayName: "Alice A.",
      visibility: "visible",
      roles: [{ id: backend, name: "Backend" }],
    });
    expect(byName.bob?.visibility).toBe("hidden");
    expect(byName.olivia?.visibility).toBe("visible");
    expect(byName.carol?.visibility).toBe("unknown");
    expect(byName.helper).toBeUndefined();
    expect(directory.coverage).toMatchObject({
      members: "complete",
      listed: 4,
      visible: 2,
      hidden: 1,
      unknown: 1,
    });
    expect(directory.coverage.limitations.join(" ")).toContain(
      "could not be verified",
    );
    expect(directory.people[0]?.visibility).toBe("visible");
    expect(directory.roles.map((r) => r.id)).toEqual([backend]);
  });
  it("only performs reads", async () => {
    await loadDiscordDirectory(binding);
    expect(mock.api.mock.calls.every((call) => call.length === 1)).toBe(true);
  });
  it("reports an unavailable member list instead of an empty server", async () => {
    memberList = () => {
      throw new DiscordApiError("The bot cannot access this channel.", 403);
    };
    const directory = await loadDiscordDirectory(binding);
    expect(directory.people).toEqual([]);
    expect(directory.roles).toHaveLength(1);
    expect(directory.coverage.members).toBe("unavailable");
    expect(directory.coverage.limitations.join(" ")).toContain(
      "Server Members Intent",
    );
  });
  it("marks a later failing page as partial and an oversized server as partial", async () => {
    const page = Array.from({ length: 500 }, (_, index) =>
      member(String(2_000_000_000_000_000_000n + BigInt(index)), `u${index}`, [
        backend,
      ]),
    );
    let calls = 0;
    memberList = () => {
      if (++calls > 1)
        throw new DiscordApiError("The bot cannot access this channel.", 403);
      return page;
    };
    const failing = await loadDiscordDirectory(binding);
    expect(failing.coverage.members).toBe("partial");
    expect(failing.people).toHaveLength(500);
    memberList = () => page;
    const huge = await loadDiscordDirectory(binding);
    expect(huge.coverage.members).toBe("partial");
    expect(huge.coverage.limitations.join(" ")).toContain("first 2000");
  });
  it("does not swallow other Discord failures", async () => {
    memberList = () => {
      throw new DiscordApiError("Discord is rate limited.", 429);
    };
    await expect(loadDiscordDirectory(binding)).rejects.toThrow("rate limited");
  });
});

describe("verifying recipients", () => {
  it("accepts a member who can view the channel", async () => {
    await expect(verifyDiscordPerson(binding, alice)).resolves.toMatchObject({
      id: alice,
      displayName: "Alice A.",
    });
    await expect(verifyDiscordPerson(binding, owner)).resolves.toMatchObject({
      id: owner,
    });
  });
  it("refuses non-members, hidden people, bots and unverifiable people", async () => {
    await expect(
      verifyDiscordPerson(binding, "1567641543010099999"),
    ).rejects.toThrow("not a member");
    await expect(verifyDiscordPerson(binding, bob)).rejects.toThrow(
      "cannot view the linked channel",
    );
    await expect(verifyDiscordPerson(binding, helper)).rejects.toThrow("Bots");
    await expect(verifyDiscordPerson(binding, carol)).rejects.toThrow(
      "Could not verify",
    );
  });
  it("verifies an existing role and never substitutes a missing one", async () => {
    await expect(verifyDiscordRole(binding, backend)).resolves.toMatchObject({
      id: backend,
    });
    await expect(verifyDiscordRole(binding, ghost)).rejects.toThrow(
      "nothing was substituted",
    );
  });
  it("requires the bot to view and post in the channel to notify a person", async () => {
    await expect(
      assertBotCanNotifyPerson(binding, alice),
    ).resolves.toBeUndefined();
    everyone = 0n;
    overwrites = [{ id: backend, type: 0, allow: String(VIEW), deny: "0" }];
    await expect(assertBotCanNotifyPerson(binding, alice)).rejects.toThrow(
      "denies this bot permission to post",
    );
  });
  it("reports unverifiable bot permissions without sending", async () => {
    botRoles = [ghost];
    await expect(assertBotCanNotifyPerson(binding, alice)).rejects.toThrow(
      "Could not verify the bot",
    );
  });
});
