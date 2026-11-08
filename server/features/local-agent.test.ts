import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/server/request-context", () => ({
  runWithRequestContext: (_context: unknown, run: () => unknown) => run(),
}));
vi.mock("../lib/local-codex/runs", () => ({ executeLocalCodex: vi.fn() }));
vi.mock("../../actions/propose-feature-questions", () => ({
  default: { run: vi.fn() },
}));
vi.mock("../../actions/get-feature", () => ({ default: { run: vi.fn() } }));
vi.mock("../../actions/create-sample-feature", () => ({
  default: { run: vi.fn() },
}));
vi.mock("../../actions/list-features", () => ({ default: { run: vi.fn() } }));
vi.mock("../../actions/show-feature-questions", () => ({
  default: { run: vi.fn() },
}));
vi.mock("../../actions/update-feature-question", () => ({
  default: { run: vi.fn() },
}));
vi.mock("../../actions/update-feature-suggested-question", () => ({
  default: { run: vi.fn() },
}));

import readFeature from "../../actions/get-feature";
import proposeQuestions from "../../actions/propose-feature-questions";
import { LocalCodexFailure } from "../lib/local-codex/failure";
import { executeLocalCodex } from "../lib/local-codex/runs";
import { runFeatureAgent } from "./local-agent";

const suggestion = (count: number) =>
  JSON.stringify({
    type: "action",
    name: "propose-feature-questions",
    args: {
      id: "19d7760d-d95c-4a24-8d7a-e1752f072571",
      revision: 1,
      questions: [
        {
          text: "Which deadline applies?",
          origin: "agent_finding",
          owner: null,
          evidence: Array.from({ length: count }, () => ({
            source: "jira",
            excerpt: "Deadline",
          })),
        },
      ],
    },
  });
const input = () => ({
  owner: "test@example.test",
  orgId: null,
  threadId: "test",
  prompt: "Review and save questions",
  signal: new AbortController().signal,
  onTool: vi.fn(),
});
const execute = vi.mocked(executeLocalCodex);
beforeEach(() => vi.resetAllMocks());

it("repairs excess evidence before dispatch without repeating a completed read", async () => {
  execute
    .mockResolvedValueOnce(
      JSON.stringify({
        type: "action",
        name: "get-feature",
        args: { id: "test" },
      }),
    )
    .mockResolvedValueOnce(suggestion(4))
    .mockResolvedValueOnce(suggestion(3))
    .mockResolvedValueOnce(JSON.stringify({ type: "message", text: "Saved" }));
  vi.mocked(readFeature.run).mockResolvedValue({ revision: 1 } as never);
  vi.mocked(proposeQuestions.run).mockResolvedValue({ revision: 2 } as never);
  await expect(runFeatureAgent(input())).resolves.toBe("Saved");
  expect(readFeature.run).toHaveBeenCalledTimes(1);
  expect(proposeQuestions.run).toHaveBeenCalledTimes(1);
  expect(execute.mock.calls[2]?.[0].prompt).toContain('questions",0,"evidence');
  expect(execute.mock.calls[2]?.[0].prompt).toContain("not executed");
  expect(execute.mock.calls[0]?.[0].prompt).toContain("1-3 evidence excerpts");
});

it("stops after one failed correction with a specific safe error and no write", async () => {
  execute.mockResolvedValue(suggestion(4));
  await expect(runFeatureAgent(input())).rejects.toThrow(LocalCodexFailure);
  expect(execute).toHaveBeenCalledTimes(2);
  expect(proposeQuestions.run).not.toHaveBeenCalled();
});

it("repairs malformed JSON without exposing raw output in the correction", async () => {
  execute
    .mockResolvedValueOnce("invalid secret-like output")
    .mockResolvedValueOnce(JSON.stringify({ type: "message", text: "Done" }));
  await expect(runFeatureAgent(input())).resolves.toBe("Done");
  expect(execute.mock.calls[1]?.[0].prompt).not.toContain("secret-like");
});

it("does not retry runtime failures", async () => {
  execute.mockRejectedValueOnce(new LocalCodexFailure("Usage limit"));
  await expect(runFeatureAgent(input())).rejects.toThrow("Usage limit");
  expect(execute).toHaveBeenCalledTimes(1);
});

it("honors cancellation before starting a correction", async () => {
  const controller = new AbortController();
  execute.mockImplementationOnce(async () => {
    controller.abort();
    return suggestion(4);
  });
  await expect(
    runFeatureAgent({ ...input(), signal: controller.signal }),
  ).rejects.toThrow();
  expect(execute).toHaveBeenCalledTimes(1);
  expect(proposeQuestions.run).not.toHaveBeenCalled();
});
