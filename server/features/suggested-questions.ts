import { assertAccess } from "@agent-native/core/sharing";
import { DiscordDeliveryStatus } from "@shared/features/discord";
import {
  DuplicateSimilarityThreshold,
  findSimilarQuestion,
  getFeatureQuestions,
  questionSimilarity,
  recipientKey,
  sourceCaptureLimitations,
} from "@shared/features/questions";
import {
  AskReviewChange,
  FeatureParticipant,
  FeatureResource,
  MaxQuestionProposals,
  MaxSuggestedQuestions,
  ProposalDecision,
  ProposalStatus,
  PrimaryQuestionId,
  QuestionAskApproval,
  QuestionAskProvenance,
  QuestionOrigin,
  QuestionRecipientState,
  QuestionStatus,
  QuestionSuggestionStatus,
  SuggestionChange,
  type AskReviewChangeInput,
  type FeatureData,
  type FeatureQuestionItem,
  type QuestionProposal,
  type SuggestedQuestionChange,
  type SuggestedQuestionInput,
} from "@shared/features/types";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../db";
import { verifyDiscordPerson, verifyDiscordRole } from "./discord-directory";
import { featureErrors } from "./errors";
import { getFeature, requireActor } from "./store";

type Evidence = FeatureQuestionItem["evidence"];

const normalize = (text: string) =>
  text.replace(/\s+/g, " ").trim().toLowerCase();
const invalid = (message: string) =>
  featureErrors.noWrite(message, "invalid_suggestion", { statusCode: 422 });

// Evidence must cite a source already captured on this feature and quote it.
function resolveEvidence(
  data: FeatureData,
  evidence: SuggestedQuestionInput["evidence"],
): Evidence {
  return evidence.map(({ source, excerpt }) => {
    const captured = data.sources.find((s) => s.kind === source);
    if (!captured)
      throw invalid(`This feature has no captured ${source} source to cite.`);
    if (!normalize(captured.excerpt).includes(normalize(excerpt)))
      throw invalid(
        `The excerpt was not found in the captured ${source} source. Quote it exactly.`,
      );
    return {
      source,
      excerpt: excerpt.trim(),
      version: captured.version,
      ...(captured.url ? { url: captured.url } : {}),
    };
  });
}

type RecipientInput = NonNullable<
  Extract<SuggestedQuestionChange, { event: "edit" }>["recipient"]
>;
function selectRecipient(
  data: FeatureData,
  participant: FeatureParticipant,
): FeatureQuestionItem["recipient"] {
  const role = data.discord?.roleMappings?.[participant];
  if (!role)
    throw invalid(
      `${participant} is not mapped to a Discord role. Map it in People and roles first.`,
    );
  return { status: QuestionRecipientState.SELECTED, participant, role };
}
// Direct selections are verified against Discord now and never fall back to a
// responsibility mapping or another person. Directory reads are owner-only.
async function resolveRecipient(
  id: string,
  data: FeatureData,
  input: RecipientInput,
): Promise<FeatureQuestionItem["recipient"]> {
  if (typeof input === "string") return selectRecipient(data, input);
  if (!data.discord)
    throw invalid("Connect a Discord channel before selecting a recipient.");
  await assertAccess(FeatureResource.TYPE, id, "owner");
  if ("discordRoleId" in input)
    return {
      status: QuestionRecipientState.SELECTED,
      role: await verifyDiscordRole(data.discord, input.discordRoleId),
    };
  return {
    status: QuestionRecipientState.SELECTED,
    person: await verifyDiscordPerson(data.discord, input.discordUserId),
  };
}
const pendingAsk = (): FeatureQuestionItem["askApproval"] => ({
  status: QuestionAskApproval.PENDING,
  by: null,
  at: null,
});
// A reviewed Discord draft is only valid for the approval it was saved under.
const dropDraft = (q: FeatureQuestionItem) => {
  if (q.discord?.delivery?.status === DiscordDeliveryStatus.DRAFT)
    delete q.discord;
};
// Once delivery leaves draft, its history is preserved and frozen.
const wasSent = (q: FeatureQuestionItem) =>
  !!q.discord?.delivery &&
  q.discord.delivery.status !== DiscordDeliveryStatus.DRAFT;

function assertNoDuplicates(data: FeatureData, texts: string[]) {
  const seen = new Set(
    getFeatureQuestions(data)
      .filter((q) => q.suggestion.status !== QuestionSuggestionStatus.DISMISSED)
      .map((q) => normalize(q.text)),
  );
  for (const text of texts) {
    const key = normalize(text);
    if (seen.has(key))
      throw invalid("A question with this text already exists on the feature.");
    seen.add(key);
  }
}

async function save(
  id: string,
  revision: number,
  data: FeatureData,
  event: string,
  detail: string,
) {
  const actor = requireActor();
  if (data.activity.length >= 100)
    throw featureErrors.noWrite(
      "This feature reached its activity limit.",
      "activity_limit",
    );
  data.activity.push({
    id: crypto.randomUUID(),
    event,
    actor,
    at: new Date().toISOString(),
    detail,
  });
  const [saved] = await getDb()
    .update(schema.features)
    .set({ data, revision: revision + 1 })
    .where(
      and(eq(schema.features.id, id), eq(schema.features.revision, revision)),
    )
    .returning({ id: schema.features.id });
  if (!saved)
    throw featureErrors.noWrite(
      "Another edit won the race. Refresh and review before retrying.",
      "stale_revision",
      { statusCode: 409 },
    );
  return getFeature(id);
}

async function load(
  id: string,
  revision: number,
  role: "editor" | "owner" = "editor",
) {
  requireActor();
  await assertAccess(FeatureResource.TYPE, id, role);
  const current = await getFeature(id);
  if (current.revision !== revision)
    throw featureErrors.noWrite(
      "This feature changed. Review the latest version before saving.",
      "stale_revision",
      { statusCode: 409 },
    );
  return { current, data: structuredClone(current.data) };
}

type Skipped = {
  text: string;
  duplicateOf: string;
  duplicateText: string;
  reason: string;
};

// Never creates or overwrites on a match: existing (including approved, sent
// and dismissed) questions win, and the match is reported to the caller.
type KnownQuestion = { id: string; text: string; state: string };
function findDuplicate(
  known: KnownQuestion[],
  text: string,
): Skipped | undefined {
  for (const q of known) {
    const exact = normalize(q.text) === normalize(text);
    const similarity = exact ? 1 : questionSimilarity(q.text, text);
    if (!exact && similarity < DuplicateSimilarityThreshold) continue;
    return {
      text,
      duplicateOf: q.id,
      duplicateText: q.text,
      reason: `${exact ? "Same wording as" : `Similar to (${Math.round(similarity * 100)}% word overlap)`} ${q.state}. Nothing was changed.`,
    };
  }
  return undefined;
}

function buildQuestion(
  input: Pick<
    FeatureQuestionItem,
    "text" | "owner" | "ownerReason" | "origin" | "evidence"
  >,
): FeatureQuestionItem {
  return {
    id: crypto.randomUUID(),
    text: input.text,
    owner: input.owner,
    ownerReason: input.ownerReason,
    origin: input.origin,
    evidence: input.evidence,
    suggestion: {
      status: QuestionSuggestionStatus.SUGGESTED,
      dismissedBy: null,
      dismissedAt: null,
      reason: null,
    },
    recipient: { status: QuestionRecipientState.UNSELECTED },
    status: QuestionStatus.OPEN,
    askApproval: pendingAsk(),
    reply: null,
    replyBy: null,
    proposal: null,
    rationale: null,
    approvedBy: null,
    approvedAt: null,
  };
}

export async function createSuggestedQuestions(
  id: string,
  revision: number,
  inputs: SuggestedQuestionInput[],
) {
  const { current, data } = await load(id, revision);
  const existing = data.questions ?? [];
  const known: KnownQuestion[] = getFeatureQuestions(data).map((q) => ({
    id: q.id,
    text: q.text,
    state: `${q.id === PrimaryQuestionId ? "the primary" : "an existing"} ${
      wasSent(q)
        ? "sent"
        : q.suggestion.status === QuestionSuggestionStatus.DISMISSED
          ? "dismissed"
          : q.askApproval.status
    } question`,
  }));
  const skipped: Skipped[] = [];
  const accepted: SuggestedQuestionInput[] = [];
  for (const input of inputs) {
    const duplicate = findDuplicate(known, input.text);
    if (duplicate) {
      skipped.push(duplicate);
      continue;
    }
    accepted.push(input);
    known.push({
      id: `batch:${accepted.length}`,
      text: input.text,
      state: "another question in this batch",
    });
  }
  const limitations = sourceCaptureLimitations(data);
  if (!accepted.length)
    return { feature: current, created: [], skipped, limitations };
  if (existing.length + accepted.length > MaxSuggestedQuestions)
    throw invalid(
      `A feature can hold at most ${MaxSuggestedQuestions} suggested questions, including dismissed ones.`,
    );
  const created = accepted.map((input) =>
    buildQuestion({
      ...input,
      evidence: resolveEvidence(data, input.evidence),
    }),
  );
  data.questions = [...existing, ...created];
  const agent = created.filter(
    (q) => q.origin === QuestionOrigin.AGENT_FINDING,
  ).length;
  const feature = await save(
    id,
    revision,
    data,
    SuggestionChange.CREATE,
    `${created.length} suggested question(s) added (${agent} agent finding), ${skipped.length} skipped as possible duplicates. Nothing was approved or sent.`,
  );
  return { feature, created: created.map((q) => q.id), skipped, limitations };
}

export async function changeSuggestedQuestion(
  id: string,
  revision: number,
  questionId: string,
  change: SuggestedQuestionChange,
) {
  const { data } = await load(id, revision);
  const question = data.questions?.find((q) => q.id === questionId);
  if (!question)
    throw featureErrors.noWrite(
      "Suggested question not found. The primary question is changed with update-feature-question.",
      "suggestion_not_found",
      { statusCode: 404 },
    );
  const actor = requireActor();
  if (wasSent(question))
    throw invalid(
      "This question was already sent. Its history is preserved and it cannot be changed or reopened.",
    );
  const dismissed =
    question.suggestion.status === QuestionSuggestionStatus.DISMISSED;
  let detail: string;
  switch (change.event) {
    case SuggestionChange.EDIT: {
      if (dismissed)
        throw invalid("Restore a dismissed suggestion before editing it.");
      if (question.askApproval.status === QuestionAskApproval.REJECTED)
        throw invalid(
          "Ask approval for this question was rejected. The owner must reopen it before it can be edited.",
        );
      if (
        change.text === undefined &&
        change.owner === undefined &&
        change.ownerReason === undefined &&
        change.evidence === undefined &&
        change.recipient === undefined
      )
        throw invalid("Provide at least one field to change.");
      let invalidated = false;
      if (change.text !== undefined) {
        invalidated ||= normalize(change.text) !== normalize(question.text);
        assertNoDuplicates(
          {
            ...data,
            questions: data.questions?.filter((q) => q.id !== questionId),
          },
          [change.text],
        );
        question.text = change.text;
      }
      if (change.owner !== undefined) {
        invalidated ||= change.owner !== question.owner;
        question.owner = change.owner;
        question.ownerReason = change.ownerReason ?? null;
      } else if (change.ownerReason !== undefined)
        question.ownerReason = change.ownerReason;
      if (question.owner !== null && !question.ownerReason)
        throw invalid("Provide ownerReason when a responsible role is set.");
      if (change.evidence !== undefined) {
        const next = resolveEvidence(data, change.evidence);
        // The reviewed Discord draft quotes the evidence, so it goes stale.
        if (JSON.stringify(next) !== JSON.stringify(question.evidence))
          dropDraft(question);
        question.evidence = next;
      }
      if (change.recipient !== undefined) {
        const next =
          change.recipient === null
            ? { status: QuestionRecipientState.UNSELECTED }
            : await resolveRecipient(id, data, change.recipient);
        invalidated ||= recipientKey(next) !== recipientKey(question.recipient);
        question.recipient = next;
      }
      // Approval covers the exact text and recipient the owner reviewed.
      const revoked =
        invalidated &&
        question.askApproval.status === QuestionAskApproval.APPROVED;
      if (revoked) {
        question.askApproval = pendingAsk();
        dropDraft(question);
      }
      detail = revoked
        ? "Suggested question edited. Ask approval was invalidated and must be given again."
        : "Suggested question edited. Nothing was approved or sent.";
      break;
    }
    case SuggestionChange.DISMISS:
      if (dismissed) throw invalid("This suggestion is already dismissed.");
      if (question.askApproval.status === QuestionAskApproval.APPROVED)
        question.askApproval = pendingAsk();
      dropDraft(question);
      question.suggestion = {
        status: QuestionSuggestionStatus.DISMISSED,
        dismissedBy: actor,
        dismissedAt: new Date().toISOString(),
        reason: change.reason ?? null,
      };
      detail = "Suggested question dismissed. It can be restored.";
      break;
    case SuggestionChange.RESTORE:
      if (!dismissed) throw invalid("This suggestion is not dismissed.");
      assertNoDuplicates(
        {
          ...data,
          questions: data.questions?.filter((q) => q.id !== questionId),
        },
        [question.text],
      );
      question.suggestion = {
        status: QuestionSuggestionStatus.SUGGESTED,
        dismissedBy: null,
        dismissedAt: null,
        reason: null,
      };
      detail = "Dismissed suggestion restored.";
      break;
  }
  return save(id, revision, data, change.event, detail);
}

// Owner-only. Approval is permission to ask the saved text of this question in
// the saved recipient role; it is never approval of a business decision.
export async function reviewSuggestedQuestionAsk(
  id: string,
  revision: number,
  questionId: string,
  change: AskReviewChangeInput,
) {
  const { data } = await load(id, revision, "owner");
  const question = data.questions?.find((q) => q.id === questionId);
  if (!question)
    throw featureErrors.noWrite(
      "Suggested question not found.",
      "suggestion_not_found",
      { statusCode: 404 },
    );
  if (wasSent(question))
    throw invalid(
      "This question was already sent. Its history is preserved and it cannot be reopened.",
    );
  if (question.suggestion.status === QuestionSuggestionStatus.DISMISSED)
    throw invalid("Restore a dismissed suggestion before reviewing it.");
  const actor = requireActor();
  const status = question.askApproval.status;
  const decided = (
    next: QuestionAskApproval,
    reason?: string,
  ): FeatureQuestionItem["askApproval"] => ({
    status: next,
    by: actor,
    at: new Date().toISOString(),
    provenance: QuestionAskProvenance.OWNER_CONFIRMED,
    ...(reason ? { reason } : {}),
  });
  let detail: string;
  switch (change.event) {
    case AskReviewChange.APPROVE:
      if (status !== QuestionAskApproval.PENDING)
        throw invalid("Only a pending question can be approved for asking.");
      if (question.recipient.status !== QuestionRecipientState.SELECTED)
        throw invalid("Select a recipient before approving this question.");
      question.askApproval = decided(QuestionAskApproval.APPROVED);
      detail =
        "The owner approved asking this question. It was not sent and no business decision was approved.";
      break;
    case AskReviewChange.REJECT:
      if (status === QuestionAskApproval.REJECTED)
        throw invalid("This question was already rejected.");
      question.askApproval = decided(
        QuestionAskApproval.REJECTED,
        change.reason,
      );
      dropDraft(question);
      detail = "The owner rejected asking this question.";
      break;
    case AskReviewChange.RESTORE:
      if (status !== QuestionAskApproval.REJECTED)
        throw invalid("Only a rejected question can be reopened.");
      question.askApproval = pendingAsk();
      detail =
        "The owner reopened a rejected question. It is pending approval.";
      break;
  }
  return save(id, revision, data, change.event, detail);
}

// Agent output lands here, never in the question pool. Only a proposal that
// still waits for review blocks a repeat; the pool is compared on acceptance.
export async function proposeQuestions(
  id: string,
  revision: number,
  inputs: SuggestedQuestionInput[],
) {
  const { current, data } = await load(id, revision);
  const proposals = data.proposals ?? [];
  const waiting = proposals.filter((p) => p.status === ProposalStatus.PENDING);
  const skipped: Skipped[] = [];
  const added: QuestionProposal[] = [];
  for (const input of inputs) {
    const match = findSimilarQuestion([...waiting, ...added], input.text);
    if (match) {
      skipped.push({
        text: input.text,
        duplicateOf: match.question.id,
        duplicateText: match.question.text,
        reason: "Already proposed and waiting for the user's review.",
      });
      continue;
    }
    added.push({
      id: crypto.randomUUID(),
      text: input.text,
      owner: input.owner,
      ownerReason: input.ownerReason,
      origin: input.origin,
      evidence: resolveEvidence(data, input.evidence),
      status: ProposalStatus.PENDING,
      decidedBy: null,
      decidedAt: null,
      questionId: null,
    });
  }
  const limitations = sourceCaptureLimitations(data);
  if (!added.length)
    return { feature: current, created: [], skipped, limitations };
  if (proposals.length + added.length > MaxQuestionProposals)
    throw invalid(
      `A feature can hold at most ${MaxQuestionProposals} proposals. Ask the user to review the pending ones first.`,
    );
  data.proposals = [...proposals, ...added];
  const feature = await save(
    id,
    revision,
    data,
    "propose_questions",
    `${added.length} question proposal(s) added for the user's review, ${skipped.length} skipped. The question pool was not changed.`,
  );
  return { feature, created: added.map((p) => p.id), skipped, limitations };
}

// Owner-only. Accepting adds a new pool question (unresolved recipient, ask
// approval pending). A similar pool question blocks it unless the owner
// explicitly allows the duplicate. Rejecting only closes the proposal.
export async function reviewQuestionProposal(
  id: string,
  revision: number,
  proposalId: string,
  decision: ProposalDecision,
  allowDuplicate: boolean,
) {
  const { data } = await load(id, revision, "owner");
  const proposal = data.proposals?.find((p) => p.id === proposalId);
  if (!proposal)
    throw featureErrors.noWrite(
      "Question proposal not found.",
      "proposal_not_found",
      { statusCode: 404 },
    );
  if (proposal.status !== ProposalStatus.PENDING)
    throw invalid("This proposal was already reviewed.");
  const actor = requireActor();
  proposal.decidedBy = actor;
  proposal.decidedAt = new Date().toISOString();
  if (decision === ProposalDecision.REJECT) {
    proposal.status = ProposalStatus.REJECTED;
    return save(
      id,
      revision,
      data,
      "reject_proposal",
      "The user rejected a question proposal. The question pool was not changed.",
    );
  }
  const pool = getFeatureQuestions(data).filter(
    (q) => q.suggestion.status !== QuestionSuggestionStatus.DISMISSED,
  );
  const match = findSimilarQuestion(pool, proposal.text);
  if (match && !allowDuplicate)
    throw featureErrors.noWrite(
      "A similar question is already in the pool. Add it anyway or reject the proposal.",
      "possible_duplicate",
      { statusCode: 409 },
    );
  if ((data.questions?.length ?? 0) >= MaxSuggestedQuestions)
    throw invalid(
      `The pool can hold at most ${MaxSuggestedQuestions} suggested questions, including dismissed ones.`,
    );
  const question = buildQuestion(proposal);
  data.questions = [...(data.questions ?? []), question];
  proposal.status = ProposalStatus.ACCEPTED;
  proposal.questionId = question.id;
  return save(
    id,
    revision,
    data,
    "accept_proposal",
    `The user accepted a question proposal into the pool${match ? " despite a similar question" : ""}. Nothing was approved or sent.`,
  );
}
