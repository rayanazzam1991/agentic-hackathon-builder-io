import {
  FeatureParticipant,
  QuestionAskApproval,
  QuestionOrigin,
  QuestionRecipientState,
  QuestionStatus,
  QuestionSuggestionStatus,
  SuggestedQuestionBatchSchema,
  SuggestedQuestionChangeSchema,
  SuggestionChange,
  type FeatureData,
} from "@shared/features/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSampleData } from "./sample";

const state = vi.hoisted(() => ({
  actor: "owner@example.test" as string | undefined,
  row: undefined as unknown,
  loseRace: false,
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
        set: (patch: Record<string, unknown>) => ({
          where: () => ({
            returning: async () => {
              if (state.loseRace) return [];
              state.row = { ...(state.row as object), ...patch };
              return [{ id: "sample" }];
            },
          }),
        }),
      };
    },
  }),
}));
import { getFeature } from "./store";
import {
  changeSuggestedQuestion,
  createSuggestedQuestions,
} from "./suggested-questions";

const jira = {
  source: "jira" as const,
  excerpt: "Hide it when the cancellation window has expired.",
};
const suggestion = (text: string, extra = {}) => ({
  text,
  origin: QuestionOrigin.AGENT_FINDING,
  owner: null,
  evidence: [jira],
  ...extra,
});
const data = () => (state.row as { data: FeatureData }).data;
const role = {
  id: "523456789012345678",
  name: "Backend",
  mentionable: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  state.actor = "owner@example.test";
  state.loseRace = false;
  state.access.mockResolvedValue({ role: "editor" });
  state.row = {
    id: "sample",
    title: "Sample",
    status: QuestionStatus.ANSWERED,
    revision: 1,
    ownerEmail: state.actor,
    orgId: null,
    visibility: "private",
    data: createSampleData(state.actor),
  };
});

describe("suggested question writes", () => {
  it("creates a batch with unresolved owners and leaves legacy state untouched", async () => {
    const before = structuredClone(data());
    const saved = await createSuggestedQuestions("sample", 1, [
      suggestion("Should expired orders be refundable?"),
      suggestion("Is partial cancellation allowed?", {
        origin: QuestionOrigin.SOURCE_QUESTION,
        owner: FeatureParticipant.PO,
      }),
    ]);
    expect(saved.revision).toBe(2);
    expect(saved.status).toBe(QuestionStatus.ANSWERED);
    expect(saved.data.question).toEqual(before.question);
    expect(saved.data.discord).toEqual(before.discord);
    const [a, b] = saved.data.questions ?? [];
    expect(a?.id).not.toBe(b?.id);
    expect(a).toMatchObject({
      owner: null,
      origin: QuestionOrigin.AGENT_FINDING,
      askApproval: { status: QuestionAskApproval.PENDING },
      recipient: { status: QuestionRecipientState.UNSELECTED },
    });
    expect(a?.evidence[0]).toMatchObject({
      source: "jira",
      version: "Sample STORY-101 · revision 2",
    });
    expect(b?.owner).toBe(FeatureParticipant.PO);
  });
  it("requires a captured source and a verbatim excerpt", async () => {
    await expect(
      createSuggestedQuestions("sample", 1, [
        suggestion("Q?", { evidence: [{ source: "stitch", excerpt: "x" }] }),
      ]),
    ).rejects.toThrow("no captured stitch");
    await expect(
      createSuggestedQuestions("sample", 1, [
        suggestion("Q?", {
          evidence: [{ source: "jira", excerpt: "invented" }],
        }),
      ]),
    ).rejects.toThrow("not found in the captured");
    expect(state.update).not.toHaveBeenCalled();
  });
  it("rejects duplicates, overflow, stale revisions and lost races", async () => {
    await expect(
      createSuggestedQuestions("sample", 1, [
        suggestion(data().question.text.toUpperCase()),
      ]),
    ).rejects.toThrow("already exists");
    await expect(
      createSuggestedQuestions("sample", 1, [
        suggestion("A?"),
        suggestion("a?"),
      ]),
    ).rejects.toThrow("already exists");
    await expect(
      createSuggestedQuestions("sample", 2, [suggestion("A?")]),
    ).rejects.toThrow("changed");
    state.loseRace = true;
    await expect(
      createSuggestedQuestions("sample", 1, [suggestion("A?")]),
    ).rejects.toThrow("won the race");
  });
  it("requires editor access", async () => {
    state.access.mockRejectedValue(new Error("Forbidden"));
    await expect(
      createSuggestedQuestions("sample", 1, [suggestion("A?")]),
    ).rejects.toThrow("Forbidden");
    expect(state.update).not.toHaveBeenCalled();
  });
  it("edits, selects only a mapped recipient, dismisses and restores", async () => {
    await createSuggestedQuestions("sample", 1, [suggestion("A?")]);
    const qid = data().questions![0]!.id;
    await expect(
      changeSuggestedQuestion("sample", 2, qid, {
        event: SuggestionChange.EDIT,
        recipient: FeatureParticipant.BE,
      }),
    ).rejects.toThrow("not mapped");
    data().discord = {
      guildId: "123456789012345678",
      channelId: "223456789012345678",
      channelName: "c",
      botId: "323456789012345678",
      roleMappings: { [FeatureParticipant.BE]: role },
      delivery: null,
      replies: [],
      checkedAt: null,
      partial: false,
    };
    let saved = await changeSuggestedQuestion("sample", 2, qid, {
      event: SuggestionChange.EDIT,
      text: "A2?",
      owner: FeatureParticipant.BE,
      recipient: FeatureParticipant.BE,
    });
    expect(saved.data.questions![0]).toMatchObject({
      text: "A2?",
      owner: FeatureParticipant.BE,
      recipient: { status: "selected", role },
    });
    saved = await changeSuggestedQuestion("sample", 3, qid, {
      event: SuggestionChange.DISMISS,
      reason: "Out of scope",
    });
    expect(saved.data.questions![0]?.suggestion).toMatchObject({
      status: QuestionSuggestionStatus.DISMISSED,
      dismissedBy: "owner@example.test",
      reason: "Out of scope",
    });
    await expect(
      changeSuggestedQuestion("sample", 4, qid, {
        event: SuggestionChange.EDIT,
        text: "x",
      }),
    ).rejects.toThrow("Restore");
    saved = await changeSuggestedQuestion("sample", 4, qid, {
      event: SuggestionChange.RESTORE,
    });
    expect(saved.data.questions![0]?.suggestion.status).toBe(
      QuestionSuggestionStatus.SUGGESTED,
    );
    expect(saved.data.activity.map((a) => a.event)).toEqual([
      "Sample created",
      "suggest",
      "edit",
      "dismiss",
      "restore",
    ]);
  });
  it("freezes questions that were already reviewed for asking", async () => {
    await createSuggestedQuestions("sample", 1, [suggestion("A?")]);
    const q = data().questions![0]!;
    q.askApproval.status = QuestionAskApproval.REJECTED;
    await expect(
      changeSuggestedQuestion("sample", 2, q.id, {
        event: SuggestionChange.DISMISS,
      }),
    ).rejects.toThrow("already reviewed");
  });
  it("does not edit the primary question through this action", async () => {
    await expect(
      changeSuggestedQuestion("sample", 1, "primary", {
        event: SuggestionChange.DISMISS,
      }),
    ).rejects.toThrow("not found");
  });
  it("keeps legacy rows readable and the actions bounded", async () => {
    expect((await getFeature("sample")).data.questions).toBeUndefined();
    const many = Array.from({ length: 6 }, (_, i) => suggestion(`Q${i}?`));
    expect(
      SuggestedQuestionBatchSchema.safeParse({
        id: "s",
        revision: 1,
        questions: many,
      }).success,
    ).toBe(false);
    expect(
      SuggestedQuestionChangeSchema.safeParse({ event: "approve" }).success,
    ).toBe(false);
  });
});
