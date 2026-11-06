import { describe, expect, it } from "vitest";

import { parseFeatureAgentResponse } from "./agent-protocol";

describe("local action protocol", () => {
  it("rejects approval even when the model asks for it", () => {
    expect(() =>
      parseFeatureAgentResponse(
        '{"type":"action","name":"approve-feature-decision","args":{"id":"sample","revision":1}}',
      ),
    ).toThrow();
  });
  it("rejects shell execution and undeclared actions", () => {
    expect(() =>
      parseFeatureAgentResponse(
        '{"type":"action","name":"exec","args":{"command":"echo unsafe"}}',
      ),
    ).toThrow();
  });
  it("accepts one structured feature read, including a fenced JSON reply", () => {
    expect(
      parseFeatureAgentResponse(
        '```json\n{"type":"action","name":"get-feature","args":{"id":"sample"}}\n```',
      ),
    ).toEqual({ type: "action", name: "get-feature", args: { id: "sample" } });
  });
  it("refuses malformed output rather than guessing an action", () => {
    expect(() => parseFeatureAgentResponse("Sure, I approved it.")).toThrow();
  });
});
