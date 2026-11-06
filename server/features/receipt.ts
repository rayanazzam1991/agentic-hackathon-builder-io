import type { Feature } from "@shared/features/types";

// Call only after a persisted readback, never optimistically before SQL succeeds.
export function featureWriteReceipt(feature: Feature, summary: string) {
  return {
    ...feature,
    _receipt: { changed: true, verified: true, subject: feature.id, summary },
  };
}
