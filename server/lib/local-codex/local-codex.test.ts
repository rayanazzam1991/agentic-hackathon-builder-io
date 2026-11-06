import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/server", () => ({
  getBrowserCookieSession: vi.fn(),
}));
vi.mock("@agent-native/core/code-agents", () => ({}));

import { getBrowserCookieSession } from "@agent-native/core/server";

import { assertLocalCodexRequest, requireLocalCodexSession } from "./access";
import { cancelLocalCodexRun, claimLocalCodexRun } from "./runs";

const url = "http://127.0.0.1:8080/api/local-codex/chat";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("local Codex trust boundary", () => {
  it("refuses production even when authenticated on loopback", () => {
    expect(() =>
      assertLocalCodexRequest("production", url, "http://127.0.0.1:8080"),
    ).toThrow("Not found");
  });
  it("refuses missing environment rather than enabling local execution", () => {
    expect(() => assertLocalCodexRequest(undefined, url, null)).toThrow(
      "Not found",
    );
  });
  it("refuses non-loopback hosts", () => {
    expect(() =>
      assertLocalCodexRequest(
        "development",
        "http://192.168.1.2:8080/api/local-codex/chat",
        null,
      ),
    ).toThrow("loopback");
  });
  it("refuses cross-origin requests", () => {
    expect(() =>
      assertLocalCodexRequest("development", url, "https://example.com"),
    ).toThrow("Cross-origin");
  });
  it("accepts same-origin loopback", () => {
    expect(() =>
      assertLocalCodexRequest("development", url, "http://127.0.0.1:8080"),
    ).not.toThrow();
  });
  it("requires an actual browser-cookie session", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.mocked(getBrowserCookieSession).mockResolvedValue(null);
    const event = {
      req: new Request(url, { headers: { origin: "http://127.0.0.1:8080" } }),
    };
    await expect(requireLocalCodexSession(event as never)).rejects.toThrow(
      "Sign in",
    );
  });
});

describe("native execution slots", () => {
  it("rejects overlapping requests, including different threads owned by the same caller", () => {
    const first = claimLocalCodexRun("first@example.test", "thread-1");
    try {
      expect(() =>
        claimLocalCodexRun("first@example.test", "thread-2"),
      ).toThrow("already running");
      const other = claimLocalCodexRun("second@example.test", "thread-1");
      other.release();
    } finally {
      first.release();
    }
  });
  it("does not cancel another caller or a different thread", () => {
    const first = claimLocalCodexRun("first@example.test", "thread-1");
    try {
      expect(cancelLocalCodexRun("second@example.test", "thread-1")).toBe(
        false,
      );
      expect(cancelLocalCodexRun("first@example.test", "thread-2")).toBe(false);
      expect(first.controller.signal.aborted).toBe(false);
    } finally {
      first.release();
    }
  });
  it("cancels without freeing the slot before the child actually exits", () => {
    const first = claimLocalCodexRun("first@example.test", "thread-1");
    expect(cancelLocalCodexRun("first@example.test", "thread-1")).toBe(true);
    expect(first.controller.signal.aborted).toBe(true);
    expect(() => claimLocalCodexRun("first@example.test", "thread-1")).toThrow(
      "already running",
    );
    first.release();
    const next = claimLocalCodexRun("first@example.test", "thread-2");
    first.release();
    expect(() => claimLocalCodexRun("first@example.test", "thread-3")).toThrow(
      "already running",
    );
    next.release();
  });
});
