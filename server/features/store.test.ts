import {
  FeatureParticipant,
  FeatureProgress,
  FeatureProgressEvent,
  QuestionEvent,
  QuestionStatus,
  type FeatureData,
} from "@shared/features/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSampleData } from "./sample";

const state = vi.hoisted(() => ({
  actor: "owner@example.test" as string | undefined,
  row: undefined as unknown,
  loseRace: false,
  set: vi.fn(),
  update: vi.fn(),
  access: vi.fn(),
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => state.actor,
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: (...args: unknown[]) => state.access(...args),
}));
vi.mock("../db", async () => ({
  schema: await import("../db/schema"),
  getDb: () => ({
    select: () => ({ from: () => ({ where: async () => [state.row] }) }),
    update: (...args: unknown[]) => {
      state.update(...args);
      return {
        set: (patch: Record<string, unknown>) => {
          state.set(patch);
          return {
            where: () => ({
              returning: async () => {
                if (state.loseRace) return [];
                state.row = {
                  ...(state.row as Record<string, unknown>),
                  ...patch,
                };
                return [{ id: "sample" }];
              },
            }),
          };
        },
      };
    },
  }),
}));
import approve from "../../actions/approve-feature-decision";
import { featureProgressMachine, questionMachine } from "./lifecycle";
import { changeFeatureProgress, changeQuestion, getFeature } from "./store";

beforeEach(() => {
  vi.clearAllMocks();
  state.actor = "owner@example.test";
  state.loseRace = false;
  state.access.mockResolvedValue({ role: "owner" });
  state.row = {
    id: "sample",
    title: "Sample",
    status: QuestionStatus.OPEN,
    revision: 1,
    ownerEmail: state.actor,
    orgId: null,
    visibility: "private",
    data: createSampleData(state.actor),
  };
});
describe("feature progress", () => {
  it("defaults legacy reads without inferring progress from a question", async () => {
    (state.row as { status: string }).status = QuestionStatus.APPROVED;
    expect((await getFeature("sample")).featureStatus).toBe(FeatureProgress.NOT_STARTED);
  });
  it("pins the permitted lifecycle transitions", () => {
    expect(featureProgressMachine.transition(FeatureProgress.NOT_STARTED, FeatureProgressEvent.START)).toBe(FeatureProgress.IN_PROGRESS);
    expect(featureProgressMachine.transition(FeatureProgress.IN_PROGRESS, FeatureProgressEvent.COMPLETE)).toBe(FeatureProgress.DONE);
    expect(featureProgressMachine.transition(FeatureProgress.DONE, FeatureProgressEvent.REOPEN)).toBe(FeatureProgress.IN_PROGRESS);
    expect(featureProgressMachine.transition(FeatureProgress.IN_PROGRESS, FeatureProgressEvent.RESET)).toBe(FeatureProgress.NOT_STARTED);
    expect(featureProgressMachine.can(FeatureProgress.NOT_STARTED, FeatureProgressEvent.COMPLETE)).toBe(false);
    expect(featureProgressMachine.can(FeatureProgress.DONE, FeatureProgressEvent.RESET)).toBe(false);
  });
  it("updates only progress and revision, retaining questions and delivery data", async () => {
    const before = structuredClone(state.row);
    const saved = await changeFeatureProgress("sample", 1, FeatureProgressEvent.START);
    expect(saved.featureStatus).toBe(FeatureProgress.IN_PROGRESS);
    expect(saved.status).toBe((before as { status: string }).status);
    expect(saved.data).toEqual((before as { data: unknown }).data);
    expect(saved.revision).toBe(2);
    expect(state.access).toHaveBeenCalledWith("coordination-feature", "sample", "editor");
  });
  it("rejects forbidden, stale, illegal and raced updates", async () => {
    state.access.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(changeFeatureProgress("sample", 1, FeatureProgressEvent.START)).rejects.toThrow("Forbidden");
    await expect(changeFeatureProgress("sample", 2, FeatureProgressEvent.START)).rejects.toThrow("changed");
    await expect(changeFeatureProgress("sample", 1, FeatureProgressEvent.COMPLETE)).rejects.toThrow("not available");
    state.loseRace = true;
    await expect(changeFeatureProgress("sample", 1, FeatureProgressEvent.START)).rejects.toThrow("race");
  });
});
describe("question review boundaries", () => {
  it("requires authentication before reading a feature", async () => {
    state.actor = undefined;
    await expect(getFeature("sample")).rejects.toThrow("Sign in");
    expect(state.access).not.toHaveBeenCalled();
  });
  it("enforces resource access before any mutation", async () => {
    state.access.mockRejectedValue(new Error("Forbidden"));
    await expect(
      changeQuestion("sample", 1, {
        event: QuestionEvent.ASSIGN,
        owner: FeatureParticipant.BE,
      }),
    ).rejects.toThrow("Forbidden");
    expect(state.update).not.toHaveBeenCalled();
  });
  it("rejects stale revisions without writing", async () => {
    await expect(
      changeQuestion("sample", 2, {
        event: QuestionEvent.REPLY,
        text: "Use 48 hours",
        respondent: "PO",
      }),
    ).rejects.toThrow("changed");
    expect(state.update).not.toHaveBeenCalled();
  });
  it("does not treat a reply as approval", async () => {
    const saved = await changeQuestion("sample", 1, {
      event: QuestionEvent.REPLY,
      text: "Use 48 hours",
      respondent: "PO",
    });
    expect(saved.status).toBe(QuestionStatus.ANSWERED);
    expect(saved.data.question.approvedBy).toBeNull();
    expect(saved.revision).toBe(2);
  });
  it("invalidates the old proposal when a corrected reply arrives", async () => {
    const row = state.row as { status: string; data: FeatureData };
    row.status = QuestionStatus.PROPOSED;
    row.data.question = {
      ...row.data.question,
      reply: "Old reply",
      proposal: "Old policy",
      rationale: "Old evidence",
    };
    const saved = await changeQuestion("sample", 1, {
      event: QuestionEvent.REPLY,
      text: "Use 72 hours",
      respondent: "PO",
    });
    expect(saved.status).toBe(QuestionStatus.ANSWERED);
    expect(saved.data.question.proposal).toBeNull();
    expect(saved.data.question.rationale).toBeNull();
  });
  it("rejects a lost compare-and-set race instead of reporting success", async () => {
    state.loseRace = true;
    await expect(
      changeQuestion("sample", 1, {
        event: QuestionEvent.ASSIGN,
        owner: FeatureParticipant.BE,
      }),
    ).rejects.toThrow("won the race");
  });
  it("blocks approval through local agent action composition", async () => {
    await expect(
      approve.run(
        { id: "sample", revision: 1 },
        { caller: "tool", userEmail: "owner@example.test" },
      ),
    ).rejects.toThrow("review screen");
    expect(state.update).not.toHaveBeenCalled();
  });
  it("requires a reply before a proposal and locks approved decisions", () => {
    expect(
      questionMachine.can(QuestionStatus.OPEN, QuestionEvent.PROPOSE),
    ).toBe(false);
    expect(
      questionMachine.can(QuestionStatus.OPEN, QuestionEvent.APPROVE),
    ).toBe(false);
    for (const event of Object.values(QuestionEvent))
      expect(questionMachine.can(QuestionStatus.APPROVED, event)).toBe(false);
  });
});
