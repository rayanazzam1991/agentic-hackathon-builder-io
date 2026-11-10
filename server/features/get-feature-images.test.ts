import {
  registerPrivateBlobProvider,
  unregisterPrivateBlobProvider,
} from "@agent-native/core/private-blob";
import type { PrivateBlobHandle } from "@agent-native/core/private-blob";
import { FeatureSource } from "@shared/features/types";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ getFeature: vi.fn() }));
vi.mock("./store", () => ({ getFeature: store.getFeature }));

import readFeature from "../../actions/get-feature";
import { createSampleData } from "./sample";
import { storeStitchScreenshot } from "./screenshots";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const blobs = new Map<string, Uint8Array>();
const providerId = "get-feature-image-test";
const provider = {
  id: providerId,
  name: "Test",
  isConfigured: () => true,
  put: async (input: { data: Uint8Array; mimeType?: string; metadata?: import("@agent-native/core/private-blob").PrivateBlobMetadata }): Promise<PrivateBlobHandle> => {
    const id = `blob-${blobs.size + 1}`;
    blobs.set(id, new Uint8Array(input.data));
    return {
      id,
      provider: providerId,
      opaque: true,
      encrypted: false,
      mimeType: input.mimeType ?? "application/octet-stream",
      size: input.data.byteLength,
      metadata: input.metadata ?? {},
    };
  },
  read: async (handle: PrivateBlobHandle) => {
    const data = blobs.get(handle.id);
    if (!data) throw new Error("missing");
    return { data, mimeType: handle.mimeType ?? "application/octet-stream", handle };
  },
  delete: async (handle: PrivateBlobHandle) => ({
    deleted: blobs.delete(handle.id),
    provider: handle.provider,
    reason: "not_found",
  }),
};

beforeAll(() => registerPrivateBlobProvider(provider));
afterAll(() => unregisterPrivateBlobProvider(providerId));

async function featureWithScreenshot() {
  const data = createSampleData("owner@example.test");
  const screenshot = await storeStitchScreenshot({
    featureId: "11111111-1111-4111-8111-111111111111",
    projectId: "123",
    screenId: "screen1",
    title: "Order details — eligible",
    capturedAt: "2026-11-08T10:00:00.000Z",
    bytes: png,
    ownerEmail: "owner@example.test",
  });
  data.sources[0] = {
    kind: FeatureSource.STITCH,
    version: "v1",
    excerpt: "Order details\nCancel within 48 hours",
    capturedAt: "2026-11-08T10:00:00.000Z",
    screenshot,
  };
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Live · order cancellation",
    revision: 1,
    status: "open",
    featureStatus: "not_started",
    data,
    ownerEmail: "owner@example.test",
    canEdit: true,
    canApprove: true,
  };
}

it("attaches the stored screenshot as a vision image for agent tool calls", async () => {
  store.getFeature.mockResolvedValue(await featureWithScreenshot());
  const result = (await readFeature.run({ id: "f1" }, {
    caller: "tool",
  } as never)) as unknown as { _agentImages?: Array<{ data: string; mediaType: string }> };
  expect(result._agentImages).toHaveLength(1);
  expect(result._agentImages?.[0]?.mediaType).toBe("image/png");
  expect(Buffer.from(result._agentImages![0]!.data, "base64").equals(png)).toBe(
    true,
  );
});

it("keeps the browser query text-only", async () => {
  store.getFeature.mockResolvedValue(await featureWithScreenshot());
  const result = (await readFeature.run({ id: "f1" }, {
    caller: "frontend",
  } as never)) as unknown as { _agentImages?: unknown };
  expect(result._agentImages).toBeUndefined();
});
