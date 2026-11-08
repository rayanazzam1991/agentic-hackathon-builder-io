import { FeatureParticipant } from "@shared/features/types";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  values: new Map<string, Record<string, unknown>>(),
  actor: "owner@example.test",
  org: "workspace-a",
  roles: [{ id: "123456789012345679", name: "Product", mentionable: true }],
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: () => state.org,
  getRequestUserEmail: () => state.actor,
}));
vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: async (email: string, key: string) =>
    state.values.get(`${email}:${key}`) ?? null,
  deleteUserSetting: async (email: string, key: string) =>
    state.values.delete(`${email}:${key}`),
  mutateUserSetting: async (
    email: string,
    key: string,
    update: (
      current: Record<string, unknown> | null,
    ) => Record<string, unknown>,
  ) => {
    const id = `${email}:${key}`;
    state.values.set(id, update(state.values.get(id) ?? null));
  },
}));
vi.mock("./discord-api", () => ({
  DiscordApiError: class extends Error {},
  parseDiscordChannel: () => ({
    guildId: "123456789012345671",
    channelId: "123456789012345672",
  }),
  verifyDiscordChannel: async () => ({
    guildId: "123456789012345671",
    channelId: "123456789012345672",
    channelName: "features",
    botId: "123456789012345673",
  }),
  listDiscordRoles: async () => state.roles,
}));
import {
  connectDiscordSetup,
  readDiscordSetup,
  resetDiscordSetup,
  saveSetupRoles,
  setupToBinding,
} from "./discord-settings";

beforeEach(() => {
  state.values.clear();
  state.actor = "owner@example.test";
  state.org = "workspace-a";
});
it("verifies and isolates defaults by account and workspace", async () => {
  await connectDiscordSetup(
    "https://discord.com/channels/123456789012345671/123456789012345672",
  );
  await saveSetupRoles({ [FeatureParticipant.PO]: "123456789012345679" });
  const setup = await readDiscordSetup();
  expect(setup?.roleMappings[FeatureParticipant.PO]?.name).toBe("Product");
  expect(setupToBinding(setup!).delivery).toBeNull();
  state.actor = "other@example.test";
  expect(await readDiscordSetup()).toBeNull();
  state.actor = "owner@example.test";
  state.org = "workspace-b";
  expect(await readDiscordSetup()).toBeNull();
});
it("rejects a role that Discord did not return", async () => {
  await connectDiscordSetup(
    "https://discord.com/channels/123456789012345671/123456789012345672",
  );
  await expect(
    saveSetupRoles({ [FeatureParticipant.PO]: "123456789012345670" }),
  ).rejects.toThrow("no longer available");
  expect((await readDiscordSetup())?.roleMappings).toEqual({});
});
it("resets only the caller's defaults in the current workspace", async () => {
  const url =
    "https://discord.com/channels/123456789012345671/123456789012345672";
  await connectDiscordSetup(url);
  await saveSetupRoles({ [FeatureParticipant.PO]: "123456789012345679" });
  state.org = "workspace-b";
  await connectDiscordSetup(url);
  state.org = "workspace-a";
  state.actor = "other@example.test";
  await connectDiscordSetup(url);
  state.actor = "owner@example.test";
  expect(await resetDiscordSetup()).toEqual({ reset: true });
  expect(await readDiscordSetup()).toBeNull();
  state.actor = "other@example.test";
  expect(await readDiscordSetup()).not.toBeNull();
  state.actor = "owner@example.test";
  state.org = "workspace-b";
  expect(await readDiscordSetup()).not.toBeNull();
});
