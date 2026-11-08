import { expect, it } from "vitest";

import { cancelLocalCodexRun, claimLocalCodexRun } from "./runs";

it("rejects overlapping turns and releases the slot only after cancellation finishes", () => {
  const owner = "runs-test@example.test";
  const first = claimLocalCodexRun(owner, "thread-1");
  try {
    expect(() => claimLocalCodexRun(owner, "thread-2")).toThrow();
    expect(cancelLocalCodexRun(owner, "thread-2")).toBe(false);
    expect(first.controller.signal.aborted).toBe(false);
    expect(cancelLocalCodexRun(owner, "thread-1")).toBe(true);
    expect(first.controller.signal.aborted).toBe(true);
    expect(() => claimLocalCodexRun(owner, "thread-2")).toThrow();
  } finally {
    first.release();
  }
  const next = claimLocalCodexRun(owner, "thread-2");
  next.release();
});
