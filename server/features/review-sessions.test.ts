import { FeatureResource } from "@shared/features/types";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  actor: "owner@example.test",
  org: "org-1",
  getFeature: vi.fn(),
  createThread: vi.fn(),
  getThread: vi.fn(),
  listThreads: vi.fn(),
  assertAccess: vi.fn(),
  setThreadArchived: vi.fn(),
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: () => mocks.org,
}));
vi.mock("@agent-native/core/server", () => ({
  createThread: (...args: unknown[]) => mocks.createThread(...args),
  getThread: (...args: unknown[]) => mocks.getThread(...args),
  listThreads: (...args: unknown[]) => mocks.listThreads(...args),
  setThreadArchived: (...args: unknown[]) => mocks.setThreadArchived(...args),
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => mocks.assertAccess(...args),
}));
vi.mock("./store", () => ({
  requireActor: () => mocks.actor,
  getFeature: (...args: unknown[]) => mocks.getFeature(...args),
}));
import {
  createFeatureReviewSession,
  archiveFeatureReviewSession,
  listFeatureReviewSessions,
  openFeatureReviewSession,
} from "./review-sessions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getFeature.mockResolvedValue({ id: "feature-1", title: "Feature one" });
  mocks.createThread.mockResolvedValue({ id: "thread-1" });
  mocks.listThreads.mockResolvedValue([
    { id: "thread-1", title: "Review", accessBasis: "owner" },
  ]);
  mocks.assertAccess.mockResolvedValue({ role: "owner" });
  mocks.getThread.mockResolvedValue({
    id: "thread-1",
    ownerEmail: mocks.actor,
    orgId: mocks.org,
    scope: { type: FeatureResource.TYPE, id: "feature-1" },
  });
});
it("lists only sessions returned by the framework for the accessible feature scope", async () => {
  expect(await listFeatureReviewSessions("feature-1")).toEqual([
    { threadId: "thread-1", title: "Review", isOwner: true },
  ]);
  expect(mocks.listThreads).toHaveBeenCalledWith(mocks.actor, {
    scope: { type: FeatureResource.TYPE, id: "feature-1" },
    orgId: mocks.org,
    limit: 50,
  });
});
it("archives and restores an owned feature session using verified readback", async () => {
  let archivedAt: number | null = null;
  mocks.getThread.mockImplementation(async () => ({
    id: "thread-1",
    ownerEmail: mocks.actor,
    orgId: mocks.org,
    scope: { type: FeatureResource.TYPE, id: "feature-1" },
    archivedAt,
  }));
  mocks.setThreadArchived.mockImplementation(async (_id, archived) => {
    archivedAt = archived ? 42 : null;
    return true;
  });
  expect(
    await archiveFeatureReviewSession("feature-1", "thread-1", true),
  ).toEqual({ threadId: "thread-1", archived: true });
  expect(
    await archiveFeatureReviewSession("feature-1", "thread-1", false),
  ).toEqual({ threadId: "thread-1", archived: false });
  expect(mocks.assertAccess).toHaveBeenCalledWith(
    "chat_thread",
    "thread-1",
    "owner",
  );
});
it("rejects archiving another feature's session", async () => {
  mocks.getThread.mockResolvedValue({
    id: "thread-1",
    ownerEmail: mocks.actor,
    orgId: mocks.org,
    scope: { type: FeatureResource.TYPE, id: "other" },
  });
  await expect(
    archiveFeatureReviewSession("feature-1", "thread-1", true),
  ).rejects.toThrow("unavailable");
  expect(mocks.setThreadArchived).not.toHaveBeenCalled();
});
it("checks both feature and chat access before reopening the matching session", async () => {
  expect(await openFeatureReviewSession("feature-1", "thread-1")).toEqual({
    threadId: "thread-1",
  });
  expect(mocks.getFeature).toHaveBeenCalledWith("feature-1");
  expect(mocks.assertAccess).toHaveBeenCalledWith(
    "chat_thread",
    "thread-1",
    "viewer",
  );
  mocks.assertAccess.mockRejectedValueOnce(new Error("Forbidden"));
  await expect(
    openFeatureReviewSession("feature-1", "thread-1"),
  ).rejects.toThrow("Forbidden");
});
it("rejects a session from another feature or workspace", async () => {
  mocks.getThread.mockResolvedValueOnce({
    id: "thread-1",
    orgId: mocks.org,
    scope: { type: FeatureResource.TYPE, id: "other" },
    archivedAt: null,
  });
  await expect(
    openFeatureReviewSession("feature-1", "thread-1"),
  ).rejects.toThrow("unavailable");
  mocks.getThread.mockResolvedValueOnce({
    id: "thread-1",
    orgId: "other-org",
    scope: { type: FeatureResource.TYPE, id: "feature-1" },
    archivedAt: null,
  });
  await expect(
    openFeatureReviewSession("feature-1", "thread-1"),
  ).rejects.toThrow("unavailable");
});
it("creates and verifies a private owner-scoped session for an accessible feature", async () => {
  expect(await createFeatureReviewSession("feature-1")).toEqual({
    threadId: "thread-1",
  });
  expect(mocks.getFeature).toHaveBeenCalledWith("feature-1");
  expect(mocks.createThread).toHaveBeenCalledWith(mocks.actor, {
    title: "Review: Feature one",
    scope: {
      type: FeatureResource.TYPE,
      id: "feature-1",
      label: "Feature one",
    },
    orgId: mocks.org,
  });
});
it("does not create a chat if feature access is denied", async () => {
  mocks.getFeature.mockRejectedValue(new Error("Forbidden"));
  await expect(createFeatureReviewSession("feature-1")).rejects.toThrow(
    "Forbidden",
  );
  expect(mocks.createThread).not.toHaveBeenCalled();
});
it.each([
  { ownerEmail: "other@example.test" },
  { orgId: "other-org" },
  { scope: null },
  { scope: { type: FeatureResource.TYPE, id: "other-feature" } },
])("rejects a mismatched persisted session: %j", async (patch) => {
  mocks.getThread.mockResolvedValue({
    id: "thread-1",
    ownerEmail: mocks.actor,
    orgId: mocks.org,
    scope: { type: FeatureResource.TYPE, id: "feature-1" },
    ...patch,
  });
  await expect(createFeatureReviewSession("feature-1")).rejects.toThrow(
    "Could not verify",
  );
});
