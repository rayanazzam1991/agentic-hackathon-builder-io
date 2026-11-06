import { describe, it, expect } from "vitest";

import { localCodexFailureMessage } from "./failure";
describe("safe local failure reporting", () => {
  const event = (message: string) => ({
    message,
    metadata: { source: "codex-cli", type: "error" },
  });
  it("reports model rejection separately from login failures", () => {
    expect(
      localCodexFailureMessage([event("model_not_found private-secret")]),
    ).toContain("rejected gpt-6.1-sol");
    expect(
      localCodexFailureMessage([event("model_not_found private-secret")]),
    ).not.toContain("private-secret");
  });
  it("reports exhausted quota without suggesting login", () => {
    expect(
      localCodexFailureMessage([event("You've hit your usage limit")]),
    ).toContain("usage limit");
  });
  it("does not expose arbitrary process logs", () => {
    expect(
      localCodexFailureMessage([
        event("private-secret"),
        { message: "model_not_found", metadata: { source: "runner-stderr" } },
      ]),
    ).not.toContain("private-secret");
    expect(localCodexFailureMessage([])).toContain("native run log");
  });
});
