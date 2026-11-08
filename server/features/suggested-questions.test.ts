import { DiscordDeliveryStatus } from "@shared/features/discord";
import {
  FeatureParticipant,
  ProposalDecision,
  ProposalStatus,
  QuestionAskApproval,
  QuestionOrigin,
  QuestionRecipientState,
  QuestionStatus,
  QuestionSuggestionStatus,
  SuggestedQuestionBatchSchema,
  SuggestedQuestionInput,
  SuggestedQuestionChangeSchema,
  AskReviewChange,
  QuestionAskProvenance,
  SuggestionChange,
  type FeatureData,
} from "@shared/features/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  FeatureAgentAction,
  parseFeatureAgentResponse,
} from "./agent-protocol";
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
const directory = vi.hoisted(() => ({ person: vi.fn(), role: vi.fn() }));
vi.mock("./discord-directory", () => ({
  verifyDiscordPerson: (...args: unknown[]) => directory.person(...args),
  verifyDiscordRole: (...args: unknown[]) => directory.role(...args),
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
import reviewProposal from "../../actions/review-feature-question-proposal";
import review from "../../actions/review-feature-suggested-question-ask";
import { getFeature } from "./store";
import {
  changeSuggestedQuestion,
  proposeQuestions,
  reviewQuestionProposal,
  createSuggestedQuestions as createRaw,
  reviewSuggestedQuestionAsk,
} from "./suggested-questions";

const createSuggestedQuestions = async (
  ...args: Parameters<typeof createRaw>
) => (await createRaw(...args)).feature;
const jira = {
  source: "jira" as const,
  excerpt: "Hide it when the cancellation window has expired.",
};
const suggestion = (text: string, extra = {}) => ({
  text,
  origin: QuestionOrigin.AGENT_FINDING,
  owner: null,
  ownerReason: null,
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
        ownerReason: "Jira states the PO owns cancellation policy.",
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
  it("rejects overflow, stale revisions and lost races", async () => {
    await expect(
      createSuggestedQuestions("sample", 2, [suggestion("A?")]),
    ).rejects.toThrow("changed");
    state.loseRace = true;
    await expect(
      createSuggestedQuestions("sample", 1, [suggestion("A?")]),
    ).rejects.toThrow("won the race");
    state.loseRace = false;
    await createSuggestedQuestions("sample", 1, [suggestion("Seed gap?")]);
    data().questions = Array.from({ length: 20 }, (_, i) => ({
      ...data().questions![0]!,
      id: `q${i}`,
      text: `Distinct${"x".repeat(i)} wording number ${i} alpha${i}?`,
    }));
    await expect(
      createSuggestedQuestions("sample", 2, [suggestion("Brand new gap?")]),
    ).rejects.toThrow("at most 20");
  });
  it("requires ownerReason whenever a role is suggested", async () => {
    expect(
      SuggestedQuestionInput.safeParse(
        suggestion("A?", { owner: FeatureParticipant.PO }),
      ).success,
    ).toBe(false);
    await createSuggestedQuestions("sample", 1, [suggestion("A?")]);
    await expect(
      changeSuggestedQuestion("sample", 2, data().questions![0]!.id, {
        event: SuggestionChange.EDIT,
        owner: FeatureParticipant.PO,
      }),
    ).rejects.toThrow("ownerReason");
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
      ownerReason: "Backend enforces the window.",
      recipient: FeatureParticipant.BE,
    });
    expect(saved.data.questions![0]).toMatchObject({
      text: "A2?",
      owner: FeatureParticipant.BE,
      ownerReason: "Backend enforces the window.",
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

describe("question proposals", () => {
  const propose = (rev: number, text = "A?") =>
    proposeQuestions("sample", rev, [suggestion(text)]);
  it("never touch the pool until the owner accepts", async () => {
    await createSuggestedQuestions("sample", 1, [suggestion("Pool?")]);
    await propose(2, "Brand new?");
    expect(data().questions).toHaveLength(1);
    const pid = data().proposals![0]!.id;
    const again = await propose(3, "Brand new?");
    expect(again.skipped).toHaveLength(1);
    const saved = await reviewQuestionProposal(
      "sample",
      3,
      pid,
      ProposalDecision.ACCEPT,
      false,
    );
    const added = saved.data.questions![1]!;
    expect(added.text).toBe("Brand new?");
    expect(added.recipient.status).toBe(QuestionRecipientState.UNSELECTED);
    expect(saved.data.proposals![0]!.status).toBe(ProposalStatus.ACCEPTED);
    await expect(
      reviewQuestionProposal("sample", 4, pid, ProposalDecision.REJECT, false),
    ).rejects.toThrow("already reviewed");
  });
  it("reject leaves the pool alone; duplicates need allowDuplicate", async () => {
    await createSuggestedQuestions("sample", 1, [suggestion("Same?")]);
    const before = structuredClone(data().questions);
    await propose(2, "Same?");
    const pid = data().proposals![0]!.id;
    await expect(
      reviewQuestionProposal("sample", 3, pid, ProposalDecision.ACCEPT, false),
    ).rejects.toThrow("similar question");
    await reviewQuestionProposal(
      "sample",
      3,
      pid,
      ProposalDecision.REJECT,
      false,
    );
    expect(data().questions).toEqual(before);
    expect(data().proposals![0]!.status).toBe(ProposalStatus.REJECTED);
    await propose(4, "Same?");
    const second = data().proposals![1]!.id;
    await reviewQuestionProposal(
      "sample",
      5,
      second,
      ProposalDecision.ACCEPT,
      true,
    );
    expect(data().questions).toHaveLength(2);
  });
  it("is owner-only and frontend-only", async () => {
    await propose(1);
    const pid = data().proposals![0]!.id;
    for (const caller of ["tool", undefined])
      await expect(
        reviewProposal.run(
          {
            id: "sample",
            revision: 2,
            proposalId: pid,
            decision: ProposalDecision.ACCEPT,
            allowDuplicate: false,
          },
          { caller } as never,
        ),
      ).rejects.toThrow("review screen");
    state.access.mockImplementation(async (_t, _i, r) => {
      if (r === "owner") throw new Error("Forbidden");
      return { role: "editor" };
    });
    await expect(
      reviewQuestionProposal("sample", 2, pid, ProposalDecision.ACCEPT, false),
    ).rejects.toThrow("Forbidden");
    state.access.mockImplementation(async () => ({ role: "owner" }));
  });
});

describe("ask approval review", () => {
  const seed = async () => {
    await createSuggestedQuestions("sample", 1, [suggestion("A?")]);
    data().discord = {
      guildId: "123456789012345678",
      channelId: "223456789012345678",
      channelName: "c",
      botId: "323456789012345678",
      roleMappings: {
        [FeatureParticipant.BE]: role,
        [FeatureParticipant.PO]: { ...role, id: "623456789012345678" },
      },
      delivery: null,
      replies: [],
      checkedAt: null,
      partial: false,
    };
    const q = data().questions![0]!;
    await changeSuggestedQuestion("sample", 2, q.id, {
      event: SuggestionChange.EDIT,
      recipient: FeatureParticipant.BE,
    });
    return q.id;
  };
  const approveAsk = (qid: string, rev: number) =>
    reviewSuggestedQuestionAsk("sample", rev, qid, {
      event: AskReviewChange.APPROVE,
    });

  it("is owner-only", async () => {
    const qid = await seed();
    state.access.mockImplementation(async (_t, _i, r) => {
      if (r === "owner") throw new Error("Forbidden");
      return { role: "editor" };
    });
    await expect(approveAsk(qid, 3)).rejects.toThrow("Forbidden");
    expect(data().questions![0]?.askApproval.status).toBe(
      QuestionAskApproval.PENDING,
    );
  });
  it("cannot be called by agents or direct composition", async () => {
    const qid = await seed();
    for (const caller of ["tool", undefined])
      await expect(
        review.run(
          {
            id: "sample",
            revision: 3,
            questionId: qid,
            change: { event: AskReviewChange.APPROVE },
          },
          { caller } as never,
        ),
      ).rejects.toThrow("review screen");
    expect(data().questions![0]?.askApproval.status).toBe(
      QuestionAskApproval.PENDING,
    );
  });
  it("approves with provenance, without touching the business decision", async () => {
    const qid = await seed();
    const before = structuredClone(data().question);
    const saved = await approveAsk(qid, 3);
    expect(saved.data.questions![0]?.askApproval).toMatchObject({
      status: QuestionAskApproval.APPROVED,
      by: "owner@example.test",
      provenance: QuestionAskProvenance.OWNER_CONFIRMED,
    });
    expect(saved.data.questions![0]).toMatchObject({
      approvedBy: null,
      status: QuestionStatus.OPEN,
    });
    expect(saved.data.question).toEqual(before);
    expect(saved.status).toBe(QuestionStatus.ANSWERED);
  });
  it("requires a recipient, a pending state and a fresh revision", async () => {
    await createSuggestedQuestions("sample", 1, [suggestion("A?")]);
    const qid = data().questions![0]!.id;
    await expect(approveAsk(qid, 2)).rejects.toThrow("recipient");
  });
  it("rejects stale revisions and double approval", async () => {
    const qid = await seed();
    await expect(approveAsk(qid, 2)).rejects.toThrow("changed");
    await approveAsk(qid, 3);
    await expect(approveAsk(qid, 4)).rejects.toThrow("pending");
  });
  it("invalidates approval when text, responsibility or recipient changes, not for evidence", async () => {
    const qid = await seed();
    await approveAsk(qid, 3);
    let saved = await changeSuggestedQuestion("sample", 4, qid, {
      event: SuggestionChange.EDIT,
      evidence: [jira],
    });
    expect(saved.data.questions![0]?.askApproval.status).toBe(
      QuestionAskApproval.APPROVED,
    );
    saved = await changeSuggestedQuestion("sample", 5, qid, {
      event: SuggestionChange.EDIT,
      owner: FeatureParticipant.DESIGN,
      ownerReason: "The design shows the window.",
    });
    expect(saved.data.questions![0]?.askApproval.status).toBe(
      QuestionAskApproval.PENDING,
    );
    await approveAsk(qid, 6);
    saved = await changeSuggestedQuestion("sample", 7, qid, {
      event: SuggestionChange.EDIT,
      text: "A changed?",
    });
    expect(saved.data.questions![0]?.askApproval).toEqual({
      status: QuestionAskApproval.PENDING,
      by: null,
      at: null,
    });
    await approveAsk(qid, 8);
    saved = await changeSuggestedQuestion("sample", 9, qid, {
      event: SuggestionChange.EDIT,
      recipient: FeatureParticipant.PO,
    });
    expect(saved.data.questions![0]?.askApproval.status).toBe(
      QuestionAskApproval.PENDING,
    );
  });
  it("drops an unsent Discord draft when approval is revoked, and when its quoted evidence changes, but keeps it for an identical evidence edit", async () => {
    const qid = await seed();
    await approveAsk(qid, 3);
    data().questions![0]!.discord = {
      delivery: {
        status: DiscordDeliveryStatus.DRAFT,
        nonce: "n",
        content: "A?",
        requestedAt: null,
        messageId: null,
      },
      replies: [],
      checkedAt: null,
      partial: false,
    };
    let saved = await changeSuggestedQuestion("sample", 4, qid, {
      event: SuggestionChange.EDIT,
      evidence: [jira],
    });
    expect(saved.data.questions![0]?.discord?.delivery).toBeTruthy();
    saved = await changeSuggestedQuestion("sample", 5, qid, {
      event: SuggestionChange.EDIT,
      evidence: [],
    });
    expect(saved.data.questions![0]?.discord).toBeUndefined();
    data().questions![0]!.discord = {
      delivery: {
        status: DiscordDeliveryStatus.DRAFT,
        nonce: "n",
        content: "A?",
        requestedAt: null,
        messageId: null,
      },
      replies: [],
      checkedAt: null,
      partial: false,
    };
    saved = await changeSuggestedQuestion("sample", 6, qid, {
      event: SuggestionChange.EDIT,
      text: "A changed?",
    });
    expect(saved.data.questions![0]?.discord).toBeUndefined();
  });
  it("rejects, blocks editing, and reopens only to pending", async () => {
    const qid = await seed();
    let saved = await reviewSuggestedQuestionAsk("sample", 3, qid, {
      event: AskReviewChange.REJECT,
      reason: "Not needed",
    });
    expect(saved.data.questions![0]?.askApproval).toMatchObject({
      status: QuestionAskApproval.REJECTED,
      reason: "Not needed",
    });
    await expect(approveAsk(qid, 4)).rejects.toThrow("pending");
    await expect(
      changeSuggestedQuestion("sample", 4, qid, {
        event: SuggestionChange.EDIT,
        text: "x?",
      }),
    ).rejects.toThrow("reopen");
    await expect(
      reviewSuggestedQuestionAsk("sample", 4, qid, {
        event: AskReviewChange.REJECT,
      }),
    ).rejects.toThrow("already rejected");
    saved = await reviewSuggestedQuestionAsk("sample", 4, qid, {
      event: AskReviewChange.RESTORE,
    });
    expect(saved.data.questions![0]?.askApproval).toEqual({
      status: QuestionAskApproval.PENDING,
      by: null,
      at: null,
    });
    await expect(
      reviewSuggestedQuestionAsk("sample", 5, qid, {
        event: AskReviewChange.RESTORE,
      }),
    ).rejects.toThrow("rejected question");
  });
  it("dismissal revokes approval and needs restore before review", async () => {
    const qid = await seed();
    await approveAsk(qid, 3);
    await changeSuggestedQuestion("sample", 4, qid, {
      event: SuggestionChange.DISMISS,
    });
    expect(data().questions![0]?.askApproval.status).toBe(
      QuestionAskApproval.PENDING,
    );
    await expect(approveAsk(qid, 5)).rejects.toThrow("Restore");
  });
  it("freezes sent questions and keeps their history", async () => {
    const qid = await seed();
    await approveAsk(qid, 3);
    const q = data().questions![0]!;
    q.discord = {
      delivery: {
        status: DiscordDeliveryStatus.SENT,
        nonce: "n",
        content: "A?",
        requestedAt: null,
        messageId: "723456789012345678",
      },
      replies: [],
      checkedAt: null,
      partial: false,
    };
    const snapshot = structuredClone(q);
    for (const run of [
      () =>
        reviewSuggestedQuestionAsk("sample", 4, qid, {
          event: AskReviewChange.REJECT,
        }),
      () =>
        reviewSuggestedQuestionAsk("sample", 4, qid, {
          event: AskReviewChange.RESTORE,
        }),
      () =>
        changeSuggestedQuestion("sample", 4, qid, {
          event: SuggestionChange.EDIT,
          text: "x?",
        }),
      () =>
        changeSuggestedQuestion("sample", 4, qid, {
          event: SuggestionChange.DISMISS,
        }),
    ])
      await expect(run()).rejects.toThrow("already sent");
    expect(data().questions![0]).toEqual(snapshot);
  });
  it("is not available to the local agent", () => {
    expect(Object.values(FeatureAgentAction)).not.toContain(
      "review-feature-suggested-question-ask",
    );
  });
});

describe("agent review persistence", () => {
  const review = async (revision: number, questions: unknown[]) =>
    createRaw(
      "sample",
      revision,
      SuggestedQuestionBatchSchema.parse({ id: "sample", revision, questions })
        .questions,
    );
  const batch = [
    suggestion("Does Jira allow cancelling after partial shipment?", {
      origin: QuestionOrigin.SOURCE_QUESTION,
      owner: FeatureParticipant.BE,
      ownerReason: "Order shipment rules live in the backend.",
      evidence: [
        { source: "jira", excerpt: "Show a confirmation before cancellation." },
      ],
    }),
    suggestion("Which refund method applies when an order is cancelled?", {
      evidence: [
        {
          source: "confluence",
          excerpt: "After that, cancellation is unavailable.",
        },
      ],
    }),
    suggestion("Should helper text show 24 or 48 hours?", {
      evidence: [
        {
          source: "figma",
          excerpt: "You can cancel this order within 48 hours.",
        },
        jira,
      ],
      owner: FeatureParticipant.DESIGN,
      ownerReason: "The helper text is a design artifact.",
    }),
  ];
  it("persists several evidence-backed suggestions and leaves unresolved owners null", async () => {
    const result = await review(1, batch);
    expect(result.created).toHaveLength(3);
    expect(result.skipped).toEqual([]);
    const saved = result.feature.data.questions!;
    expect(saved.map((q) => q.owner)).toEqual([
      FeatureParticipant.BE,
      null,
      FeatureParticipant.DESIGN,
    ]);
    expect(saved[1]?.ownerReason).toBeNull();
    expect(saved.every((q) => q.evidence.length > 0)).toBe(true);
    expect(saved.every((q) => q.askApproval.status === "pending")).toBe(true);
    expect(saved[0]?.origin).toBe(QuestionOrigin.SOURCE_QUESTION);
    expect(result.limitations.join(" ")).toContain("synthetic");
    expect(data().question.approvedBy).toBeNull();
  });
  it("preserves existing work on a repeated review and explains duplicates", async () => {
    const first = await review(1, batch);
    const [a, b] = data().questions!;
    a!.askApproval = {
      status: QuestionAskApproval.APPROVED,
      by: "owner@example.test",
      at: "2026-01-01T00:00:00Z",
    };
    b!.discord = {
      delivery: {
        status: DiscordDeliveryStatus.SENT,
        nonce: "n",
        content: "x",
        requestedAt: null,
        messageId: "723456789012345678",
      },
      replies: [],
      checkedAt: null,
      partial: false,
    };
    const before = structuredClone(data().questions);
    const again = await review(2, [
      suggestion("Does Jira allow cancelling after a partial shipment?"),
      suggestion("Which refund method applies when an order is cancelled?"),
      suggestion(data().question.text),
      suggestion("Who pays for return shipping?"),
      suggestion("Who pays for return shipping?"),
    ]);
    expect(again.created).toHaveLength(1);
    expect(again.skipped.map((s) => s.duplicateOf)).toEqual([
      a!.id,
      b!.id,
      "primary",
      expect.stringMatching(/^batch:/),
    ]);
    expect(again.skipped[0]?.reason).toContain("approved");
    expect(again.skipped[1]?.reason).toContain("sent");
    expect(again.skipped[2]?.reason).toContain("primary");
    expect(data().questions!.slice(0, 3)).toEqual(before);
    expect(data().questions).toHaveLength(4);
  });
  it("writes nothing when every suggestion is a duplicate", async () => {
    const result = await review(1, [suggestion(data().question.text)]);
    expect(result.created).toEqual([]);
    expect(result.feature.revision).toBe(1);
    expect(state.update).not.toHaveBeenCalled();
  });
  it("reports capture limitations from the stored sources", async () => {
    data().sample = false;
    data().sources = data().sources.filter((s) => s.kind !== "figma");
    const { limitations } = await review(1, [batch[0]]);
    const text = limitations.join(" ");
    expect(text).toContain("one-time captured");
    expect(text).toContain("No design source");
    expect(text).toContain("Comments, attachments");
  });
});

describe("agent protocol validation", () => {
  const call = (name: string, args: unknown) =>
    parseFeatureAgentResponse(JSON.stringify({ type: "action", name, args }));
  it("applies defaults and accepts a valid suggestion batch", () => {
    const parsed = call(FeatureAgentAction.SUGGEST, {
      id: "sample",
      revision: 1,
      questions: [{ text: "A?", origin: "agent_finding", evidence: [jira] }],
    });
    expect(parsed).toMatchObject({
      args: { questions: [{ owner: null, ownerReason: null }] },
    });
  });
  it("rejects invented origins, empty evidence, unreasoned owners and oversize batches", () => {
    const base = { id: "sample", revision: 1 };
    const q = { text: "A?", origin: "agent_finding", evidence: [jira] };
    for (const questions of [
      [{ ...q, origin: "guess" }],
      [{ ...q, evidence: [] }],
      [{ ...q, owner: "Product owner" }],
      [{ ...q, owner: "CEO", ownerReason: "x" }],
      Array.from({ length: 6 }, () => q),
      [],
    ])
      expect(() =>
        call(FeatureAgentAction.SUGGEST, { ...base, questions }),
      ).toThrow();
  });
  it("rejects approval-style changes to suggestions", () => {
    expect(() =>
      call(FeatureAgentAction.UPDATE_SUGGESTION, {
        id: "sample",
        revision: 1,
        questionId: "q",
        change: { event: "approve_ask" },
      }),
    ).toThrow();
  });
});

describe("direct Discord recipients", () => {
  const person = {
    id: "623456789012345678",
    username: "dana",
    displayName: "Dana",
    roles: [{ id: role.id, name: "Backend" }],
  };
  const connect = () => {
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
  };
  const seedQuestion = async () => {
    connect();
    await createSuggestedQuestions("sample", 1, [suggestion("A?")]);
    return data().questions![0]!.id;
  };

  it("selects a verified person without inventing a responsibility", async () => {
    const qid = await seedQuestion();
    directory.person.mockResolvedValue(person);
    state.access.mockClear();
    const saved = await changeSuggestedQuestion("sample", 2, qid, {
      event: SuggestionChange.EDIT,
      recipient: { discordUserId: person.id },
    });
    expect(directory.person).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: "223456789012345678" }),
      person.id,
    );
    expect(state.access).toHaveBeenCalledWith(
      expect.anything(),
      "sample",
      "owner",
    );
    const question = saved.data.questions![0]!;
    expect(question.recipient).toEqual({ status: "selected", person });
    expect(question.owner).toBeNull();
  });
  it("selects an existing role directly, separate from the responsibility mapping", async () => {
    const qid = await seedQuestion();
    const other = {
      id: "723456789012345678",
      name: "Support",
      mentionable: true,
    };
    directory.role.mockResolvedValue(other);
    const saved = await changeSuggestedQuestion("sample", 2, qid, {
      event: SuggestionChange.EDIT,
      recipient: { discordRoleId: other.id },
    });
    expect(saved.data.questions![0]?.recipient).toEqual({
      status: "selected",
      role: other,
    });
  });
  it("never substitutes a recipient when verification fails", async () => {
    const qid = await seedQuestion();
    await changeSuggestedQuestion("sample", 2, qid, {
      event: SuggestionChange.EDIT,
      recipient: FeatureParticipant.BE,
    });
    directory.person.mockRejectedValue(new Error("cannot view the channel"));
    await expect(
      changeSuggestedQuestion("sample", 3, qid, {
        event: SuggestionChange.EDIT,
        recipient: { discordUserId: person.id },
      }),
    ).rejects.toThrow("cannot view");
    expect(data().questions![0]?.recipient).toMatchObject({ role });
    expect(data().questions![0]?.recipient.person).toBeUndefined();
  });
  it("requires an owner and a connected channel for direct selection", async () => {
    const qid = await seedQuestion();
    state.access.mockImplementation(async (_t, _i, r) => {
      if (r === "owner") throw new Error("Forbidden");
      return { role: "editor" };
    });
    await expect(
      changeSuggestedQuestion("sample", 2, qid, {
        event: SuggestionChange.EDIT,
        recipient: { discordUserId: person.id },
      }),
    ).rejects.toThrow("Forbidden");
    expect(directory.person).not.toHaveBeenCalled();
    state.access.mockResolvedValue({ role: "owner" });
    delete data().discord;
    await expect(
      changeSuggestedQuestion("sample", 2, qid, {
        event: SuggestionChange.EDIT,
        recipient: { discordUserId: person.id },
      }),
    ).rejects.toThrow("Connect a Discord channel");
  });
  it("revokes approval and the draft when the recipient changes to a person", async () => {
    const qid = await seedQuestion();
    await changeSuggestedQuestion("sample", 2, qid, {
      event: SuggestionChange.EDIT,
      recipient: FeatureParticipant.BE,
    });
    await reviewSuggestedQuestionAsk("sample", 3, qid, {
      event: AskReviewChange.APPROVE,
    });
    directory.person.mockResolvedValue(person);
    const saved = await changeSuggestedQuestion("sample", 4, qid, {
      event: SuggestionChange.EDIT,
      recipient: { discordUserId: person.id },
    });
    expect(saved.data.questions![0]?.askApproval.status).toBe(
      QuestionAskApproval.PENDING,
    );
    // Re-selecting the same person is not a change.
    await reviewSuggestedQuestionAsk("sample", 5, qid, {
      event: AskReviewChange.APPROVE,
    });
    const again = await changeSuggestedQuestion("sample", 6, qid, {
      event: SuggestionChange.EDIT,
      recipient: { discordUserId: person.id },
    });
    expect(again.data.questions![0]?.askApproval.status).toBe(
      QuestionAskApproval.APPROVED,
    );
  });
});
