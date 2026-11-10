import {
  registerPrivateBlobProvider,
  unregisterPrivateBlobProvider,
} from "@agent-native/core/private-blob";
import type { PrivateBlobHandle, PrivateBlobPutInput } from "@agent-native/core/private-blob";
import { FeatureScreenshotSchema } from "@shared/features/types";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  detectImageMediaType,
  FeatureScreenshotError,
  readScreenshotBytes,
  removeFeatureScreenshots,
  storeStitchScreenshot,
} from "./screenshots";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const blobs = new Map<string, Uint8Array>();
const providerId = "screenshot-test-provider";
const provider = {
  id: providerId,
  name: "Screenshot test storage",
  isConfigured: () => true,
  put: async (input: PrivateBlobPutInput): Promise<PrivateBlobHandle> => {
    const id = `blob-${blobs.size + 1}`;
    blobs.set(id, new Uint8Array(input.data));
    return {
      id,
      provider: providerId,
      opaque: true,
      encrypted: false,
      mimeType: input.mimeType ?? "application/octet-stream",
      size: input.data.byteLength,
      createdAt: "2026-11-08T10:00:00.000Z",
      metadata: input.metadata ?? {},
    };
  },
  read: async (handle: PrivateBlobHandle) => {
    const data = blobs.get(handle.id);
    if (!data) throw new Error("missing");
    return { data, mimeType: handle.mimeType ?? "application/octet-stream", handle };
  },
  delete: async (handle: PrivateBlobHandle) =>
    blobs.delete(handle.id)
      ? { deleted: true, provider: handle.provider }
      : { deleted: false, provider: handle.provider, reason: "not_found" },
};

const input = {
  featureId: "11111111-1111-4111-8111-111111111111",
  projectId: "123",
  screenId: "screen1",
  title: "Order details — eligible",
  capturedAt: "2026-11-08T10:00:00.000Z",
  bytes: png,
  ownerEmail: "owner@example.test",
};

beforeEach(() => {
  blobs.clear();
  registerPrivateBlobProvider(provider);
});
afterAll(() => unregisterPrivateBlobProvider(providerId));

describe("Stitch screenshot storage", () => {
  it("stores image bytes under the feature with capture metadata", async () => {
    const saved = await storeStitchScreenshot(input);
    expect(saved.storage.provider).toBe(providerId);
    expect(saved.storage.size).toBe(png.byteLength);
    expect(saved.capturedAt).toBe(input.capturedAt);
    expect(saved.label).toContain("Order details");
    expect(saved.scope).toContain("does not prove interactions");
    expect(FeatureScreenshotSchema.parse(saved)).toEqual(saved);
    const { bytes } = await readScreenshotBytes(saved);
    expect(Buffer.from(bytes).equals(png)).toBe(true);
  });

  it("rejects non-image bytes instead of saving them as a screenshot", async () => {
    await expect(
      storeStitchScreenshot({
        ...input,
        bytes: Buffer.from("<html>not an image</html>"),
      }),
    ).rejects.toBeInstanceOf(FeatureScreenshotError);
    expect(blobs.size).toBe(0);
  });

  it("rejects images over the 1 MB bound", async () => {
    const huge = Buffer.concat([png, Buffer.alloc(1024 * 1024)]);
    await expect(
      storeStitchScreenshot({ ...input, bytes: huge }),
    ).rejects.toThrow("larger than 1 MB");
    expect(blobs.size).toBe(0);
  });

  it("detects only PNG, JPEG and WebP signatures", () => {
    expect(detectImageMediaType(png)).toBe("image/png");
    expect(detectImageMediaType(Buffer.from([0xff, 0xd8, 0xff, 0x00]))).toBe(
      "image/jpeg",
    );
    expect(
      detectImageMediaType(Buffer.from("RIFF0000WEBP", "ascii")),
    ).toBe("image/webp");
    expect(detectImageMediaType(Buffer.from("GIF89a"))).toBeNull();
    expect(detectImageMediaType(Buffer.from("<html>"))).toBeNull();
  });

  it("removes stored screenshots and treats an already-missing blob as success", async () => {
    const saved = await storeStitchScreenshot(input);
    const sources = [
      { kind: "stitch", version: "v1", excerpt: "text", screenshot: saved },
    ];
    expect(await removeFeatureScreenshots([sources as never])).toBe(1);
    expect(blobs.size).toBe(0);
    // Retry is safe: nothing remains, and no error is reported.
    expect(await removeFeatureScreenshots([sources as never])).toBe(1);
  });

  it("reports a cleanup failure instead of claiming success", async () => {
    const saved = await storeStitchScreenshot(input);
    blobs.delete(saved.storage.id);
    const failing = {
      ...provider,
      delete: async () => ({ deleted: false, provider: providerId, reason: "denied" }),
    };
    registerPrivateBlobProvider(failing);
    await expect(
      removeFeatureScreenshots([
        [{ kind: "stitch", version: "v1", excerpt: "text", screenshot: saved }] as never,
      ]),
    ).rejects.toThrow("could not be deleted");
    registerPrivateBlobProvider(provider);
  });
});
