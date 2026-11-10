import {
  deletePrivateBlob,
  putPrivateBlob,
  readPrivateBlob,
  type PrivateBlobHandle,
} from "@agent-native/core/private-blob";
import {
  MaxScreenshotBytes,
  ScreenshotMediaTypes,
  type FeatureData,
  type FeatureScreenshot,
} from "@shared/features/types";

// Screenshots are import-time snapshots of one selected Stitch screen. Bytes
// live in configured private blob storage; SQL keeps only this opaque handle
// plus capture metadata. Every read/delete below is called after a feature
// access check, never from an unauthenticated route.
export class FeatureScreenshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeatureScreenshotError";
  }
}

const STORAGE_GUIDANCE =
  "Screenshot storage is not configured. Connect private file storage in Settings and import again; no review was created.";

function extensionFor(mimeType: FeatureScreenshot["storage"]["mimeType"]) {
  return mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1];
}

// Accept only real image bytes. A provider or compromised download URL must not
// turn HTML or an error page into a "screenshot" that the UI or agent trusts.
export function detectImageMediaType(
  bytes: Uint8Array,
): (typeof ScreenshotMediaTypes)[number] | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
    return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  return null;
}

export function assertScreenshotBytes(bytes: Uint8Array) {
  if (bytes.byteLength === 0)
    throw new FeatureScreenshotError(
      "Stitch returned an empty screenshot. No review was created.",
    );
  if (bytes.byteLength > MaxScreenshotBytes)
    throw new FeatureScreenshotError(
      "Stitch returned a screenshot larger than 1 MB. No review was created.",
    );
  const mimeType = detectImageMediaType(bytes);
  if (!mimeType)
    throw new FeatureScreenshotError(
      "Stitch returned a screenshot that is not a supported PNG, JPEG or WebP image. No review was created.",
    );
  return mimeType;
}

export function screenshotStorageHandle(
  screenshot: FeatureScreenshot,
): PrivateBlobHandle {
  return {
    id: screenshot.storage.id,
    provider: screenshot.storage.provider,
    opaque: true,
    encrypted: screenshot.storage.encrypted,
    mimeType: screenshot.storage.mimeType,
    size: screenshot.storage.size,
    ...(screenshot.storage.createdAt
      ? { createdAt: screenshot.storage.createdAt }
      : {}),
  };
}

export async function storeStitchScreenshot(input: {
  featureId: string;
  projectId: string;
  screenId: string;
  title: string;
  capturedAt: string;
  bytes: Uint8Array;
  ownerEmail: string;
}): Promise<FeatureScreenshot> {
  const mimeType = assertScreenshotBytes(input.bytes);
  let handle: PrivateBlobHandle | null;
  try {
    handle = await putPrivateBlob({
      data: input.bytes,
      // Feature-scoped key so storage listings and cleanup audits line up with
      // the owning review even though access is enforced by SQL, not the key.
      key: `features/${input.featureId}/stitch/${input.screenId}.${extensionFor(mimeType)}`,
      filename: `stitch-${input.screenId}.${extensionFor(mimeType)}`,
      mimeType,
      ownerEmail: input.ownerEmail,
      metadata: {
        featureId: input.featureId,
        kind: "stitch-screen-screenshot",
        projectId: input.projectId,
        screenId: input.screenId,
      },
    });
  } catch (error) {
    console.warn("[feature-screenshot] store failed", {
      featureId: input.featureId,
      reason: error instanceof Error ? error.name : "unknown",
    });
    throw new FeatureScreenshotError(STORAGE_GUIDANCE);
  }
  if (!handle) throw new FeatureScreenshotError(STORAGE_GUIDANCE);
  if ((handle.size ?? input.bytes.byteLength) > MaxScreenshotBytes) {
    await deleteScreenshotHandle(handle).catch(() => undefined);
    throw new FeatureScreenshotError(
      "The stored screenshot exceeded the 1 MB limit. No review was created.",
    );
  }
  return {
    storage: {
      id: handle.id,
      provider: handle.provider,
      encrypted: handle.encrypted,
      mimeType,
      size: handle.size ?? input.bytes.byteLength,
      ...(handle.createdAt ? { createdAt: handle.createdAt } : {}),
    },
    capturedAt: input.capturedAt,
    label: input.title.trim().slice(0, 200) || "Stitch screen",
    projectId: input.projectId,
    screenId: input.screenId,
    scope:
      "Screenshot of the selected screen as exported at import time. It does not prove interactions, responsive behaviour, other screens, or the design's state after import.",
  };
}

async function deleteScreenshotHandle(handle: PrivateBlobHandle) {
  const result = await deletePrivateBlob(handle);
  if (result.deleted) return;
  // A missing object is not a failure: cleanup is retry-safe. Every other
  // reason means bytes may still exist and the caller must not report success.
  if (result.reason && /not.?found|gone/i.test(result.reason)) return;
  throw new FeatureScreenshotError(
    "The stored screenshot could not be deleted. The review was not removed; retry cleanup.",
  );
}

export async function readScreenshotBytes(
  screenshot: FeatureScreenshot,
): Promise<{ bytes: Uint8Array; mimeType: FeatureScreenshot["storage"]["mimeType"] }> {
  let result;
  try {
    result = await readPrivateBlob(screenshotStorageHandle(screenshot));
  } catch (error) {
    console.warn("[feature-screenshot] read failed", {
      provider: screenshot.storage.provider,
      reason: error instanceof Error ? error.name : "unknown",
    });
    throw new FeatureScreenshotError(
      "The stored screenshot could not be read. The captured text evidence is still available.",
    );
  }
  assertScreenshotBytes(result.data);
  if (result.data.byteLength !== screenshot.storage.size) {
    // Storage that returns a different byte count is not the captured snapshot.
    throw new FeatureScreenshotError(
      "The stored screenshot does not match its capture metadata.",
    );
  }
  return { bytes: result.data, mimeType: screenshot.storage.mimeType };
}

export function featureScreenshots(
  sources: FeatureData["sources"] | undefined,
): FeatureScreenshot[] {
  return (sources ?? []).flatMap((source) =>
    source.screenshot ? [source.screenshot] : [],
  );
}

/**
 * Removes every stored screenshot for the supplied reviews. Throws before any
 * SQL deletion when storage cleanup fails so a caller never reports a deleted
 * review whose image is still reachable.
 */
export async function removeFeatureScreenshots(
  sourcesList: Array<FeatureData["sources"] | undefined>,
): Promise<number> {
  const screenshots = sourcesList.flatMap((sources) =>
    featureScreenshots(sources),
  );
  for (const screenshot of screenshots) {
    await deleteScreenshotHandle(screenshotStorageHandle(screenshot));
  }
  return screenshots.length;
}
