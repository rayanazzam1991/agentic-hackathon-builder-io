import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ secret: vi.fn(), fetch: vi.fn() }));
vi.mock("@agent-native/core/server", () => ({
  resolveSecretDetailed: (...args: unknown[]) => mock.secret(...args),
}));
vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: (...args: unknown[]) => mock.fetch(...args),
}));
import {
  discordApi,
  listDiscordRoles,
  parseDiscordChannel,
  verifyDiscordChannel,
} from "./discord-api";
const channel = "1567817498597007531",
  guild = "1567817386537648188";
beforeEach(() => {
  vi.clearAllMocks();
  mock.secret.mockResolvedValue({
    value: "test-secret-never-output",
    source: "user",
  });
  mock.fetch.mockResolvedValue(new Response('{"ok":true}'));
});
describe("Discord API boundary", () => {
  it("parses the supplied channel and rejects other origins and DM URLs", () => {
    expect(
      parseDiscordChannel(`https://discord.com/channels/${guild}/${channel}`),
    ).toEqual({ guildId: guild, channelId: channel });
    for (const url of [
      `https://discord.com.evil.test/channels/${guild}/${channel}`,
      `http://discord.com/channels/${guild}/${channel}`,
      `https://user:pass@discord.com/channels/${guild}/${channel}`,
      `https://discord.com/channels/@me/${channel}`,
    ])
      expect(() => parseDiscordChannel(url)).toThrow();
  });
  it("distinguishes failed vault lookup from missing credentials and rejects env fallback", async () => {
    mock.secret.mockResolvedValueOnce({ lookupFailed: true });
    await expect(discordApi()).rejects.toThrow("storage is unavailable");
    mock.secret.mockResolvedValueOnce({ value: null });
    await expect(discordApi()).rejects.toThrow("Settings");
    mock.secret.mockResolvedValueOnce({ value: "env-value", source: "env" });
    await expect(discordApi()).rejects.toThrow("Settings");
    expect(mock.fetch).not.toHaveBeenCalled();
  });
  it("pins API origin, validates paths, disables redirects and uses bot authentication", async () => {
    const api = await discordApi();
    await expect(api("https://evil.test")).rejects.toThrow("Unsupported");
    expect(mock.fetch).not.toHaveBeenCalled();
    await api(`/channels/${channel}/messages?limit=100`);
    const [url, options, safety] = mock.fetch.mock.calls[0]!;
    expect(url).toBe(
      `https://discord.com/api/v10/channels/${channel}/messages?limit=100`,
    );
    expect(options.method).toBe("GET");
    expect(options.headers.Authorization).toBe("Bot test-secret-never-output");
    expect(safety.followRedirects).toBe(false);
    expect(() => safety.assertUrlAllowed("https://evil.test")).toThrow(
      "destination mismatch",
    );
  });
  it("sanitizes provider errors without leaking response bodies or tokens", async () => {
    const api = await discordApi();
    mock.fetch.mockResolvedValueOnce(
      new Response("test-secret-never-output", { status: 401 }),
    );
    await expect(api("/users/@me")).rejects.toThrow("rejected the bot token");
    mock.fetch.mockResolvedValueOnce(
      new Response("private payload", { status: 429 }),
    );
    await expect(api("/users/@me")).rejects.toThrow("rate limited");
  });
  it("bounds provider responses", async () => {
    const api = await discordApi();
    mock.fetch.mockResolvedValueOnce(new Response("x".repeat(512 * 1024 + 1)));
    await expect(api("/users/@me")).rejects.toThrow("exceeds");
  });
  it("requires the expected server and a standard text channel", async () => {
    mock.fetch.mockImplementation(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith("/users/@me")
              ? { id: "1567641543010025483", bot: true }
              : {
                  id: channel,
                  guild_id: guild,
                  type: 0,
                  name: "feature-review",
                },
          ),
        ),
    );
    expect(await verifyDiscordChannel(guild, channel)).toEqual({
      guildId: guild,
      channelId: channel,
      channelName: "feature-review",
      botId: "1567641543010025483",
    });
    await expect(
      verifyDiscordChannel("1567817386537648189", channel),
    ).rejects.toThrow("expected Discord server");
  });
});

describe("bounded Discord role discovery", () => {
  it("filters everyone and managed bot roles while preserving notification eligibility", async () => {
    mock.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify([
          { id: guild, name: "@everyone", mentionable: false, managed: false },
          {
            id: "1567817498597007599",
            name: "PO",
            mentionable: true,
            managed: false,
          },
          {
            id: "1567817498597007598",
            name: "Bot",
            mentionable: true,
            managed: true,
          },
          {
            id: "1567817498597007597",
            name: "Frontend",
            mentionable: false,
            managed: false,
          },
        ]),
      ),
    );
    expect(await listDiscordRoles(guild)).toEqual([
      { id: "1567817498597007597", name: "Frontend", mentionable: false },
      { id: "1567817498597007599", name: "PO", mentionable: true },
    ]);
    expect(mock.fetch.mock.calls[0]![0]).toBe(
      `https://discord.com/api/v10/guilds/${guild}/roles`,
    );
  });
  it("rejects malformed guild IDs before any credential lookup", async () => {
    await expect(listDiscordRoles("../../evil")).rejects.toThrow();
    expect(mock.secret).not.toHaveBeenCalled();
    expect(mock.fetch).not.toHaveBeenCalled();
  });
});

describe("effective role notification permissions", () => {
  const bot = "1567641543010025483",
    role = "1567957468196110518",
    botRole = "1567957468196110519";
  const mention = 1n << 17n,
    access = (1n << 10n) | (1n << 11n);
  function fixtures(
    bits: bigint,
    overwrites: unknown[] = [],
    mentionable = false,
    failMember = false,
  ) {
    mock.fetch.mockImplementation(async (url: string) => {
      if (url.includes("/members/"))
        return failMember
          ? new Response("private", { status: 403 })
          : Response.json({ user: { id: bot }, roles: [botRole] });
      if (url.includes("/channels/"))
        return Response.json({
          id: channel,
          guild_id: guild,
          type: 0,
          permission_overwrites: overwrites,
        });
      return Response.json([
        {
          id: guild,
          name: "@everyone",
          mentionable: false,
          managed: false,
          permissions: String(access),
        },
        {
          id: botRole,
          name: "Bot",
          mentionable: false,
          managed: true,
          permissions: String(bits),
        },
        { id: role, name: "PO", mentionable, managed: false, permissions: "0" },
      ]);
    });
  }
  async function status() {
    return (
      await listDiscordRoles(guild, { channelId: channel, botId: bot })
    )[0]!.mentionPermission;
  }
  it("allows a non-mentionable role with guild mention permission", async () => {
    fixtures(mention);
    expect(await status()).toBe("allowed");
  });
  it("allows a role channel grant and applies a member denial last", async () => {
    const grant = { id: botRole, type: 0, allow: String(mention), deny: "0" };
    fixtures(0n, [grant]);
    expect(await status()).toBe("allowed");
    fixtures(mention, [
      grant,
      { id: bot, type: 1, allow: "0", deny: String(mention) },
    ]);
    expect(await status()).toBe("denied");
  });
  it("combines role overwrites before applying the member grant", async () => {
    fixtures(0n, [
      { id: guild, type: 0, allow: "0", deny: String(mention) },
      { id: botRole, type: 0, allow: "0", deny: String(mention) },
      { id: bot, type: 1, allow: String(mention), deny: "0" },
    ]);
    expect(await status()).toBe("allowed");
  });
  it("aggregates role allows over role denies, regardless of overwrite order", async () => {
    const secondRole = "1567957468196110520";
    fixtures(0n, [
      { id: botRole, type: 0, allow: String(mention), deny: "0" },
      { id: secondRole, type: 0, allow: "0", deny: String(mention) },
    ]);
    const original = mock.fetch.getMockImplementation()!;
    mock.fetch.mockImplementation(async (url: string, ...args: unknown[]) => {
      if (url.includes("/members/"))
        return Response.json({
          user: { id: bot },
          roles: [botRole, secondRole],
        });
      const response = await original(url, ...args);
      if (!url.endsWith("/roles")) return response;
      const roles = await response.json();
      return Response.json([
        ...roles,
        {
          id: secondRole,
          name: "Extra",
          managed: true,
          mentionable: false,
          permissions: "0",
        },
      ]);
    });
    expect(await status()).toBe("allowed");
  });
  it("administrator bypasses channel denials", async () => {
    fixtures(8n, [
      { id: bot, type: 1, allow: "0", deny: String(access | mention) },
    ]);
    expect(await status()).toBe("allowed");
  });
  it("accepts mentionable roles but still requires channel access and send permission", async () => {
    fixtures(0n, [], true);
    expect(await status()).toBe("allowed");
    fixtures(
      mention,
      [{ id: bot, type: 1, allow: "0", deny: String(1n << 11n) }],
      true,
    );
    expect(await status()).toBe("denied");
  });
  it("distinguishes denied permission from unavailable or malformed permission data", async () => {
    fixtures(0n);
    expect(await status()).toBe("denied");
    fixtures(mention, [], false, true);
    expect(await status()).toBe("unknown");
    fixtures(mention, [{ id: bot, type: 1, allow: "invalid", deny: "0" }]);
    expect(await status()).toBe("unknown");
  });
});
