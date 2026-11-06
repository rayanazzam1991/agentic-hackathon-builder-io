import { DiscordDeliveryStatus } from "@shared/features/discord";
import {
  PrimaryQuestionId,
  QuestionAskApproval,
  QuestionAskProvenance,
  QuestionOrigin,
  QuestionRecipientState,
  QuestionStatus,
  QuestionSuggestionStatus,
  type FeatureData,
  type FeatureQuestionView,
} from "@shared/features/types";

// Authority: `data.question`, `data.discord` and the feature row status are
// the only source of truth for the primary question. `data.questions` holds
// only additional suggested questions. Reading never rewrites stored data.
export function getFeatureQuestions(
  data: FeatureData,
  rowStatus?: QuestionStatus,
): FeatureQuestionView[] {
  return [projectPrimaryQuestion(data, rowStatus), ...(data.questions ?? [])];
}

export function projectPrimaryQuestion(
  data: FeatureData,
  rowStatus?: QuestionStatus,
): FeatureQuestionView {
  const { delivery, replies, checkedAt, partial } = data.discord ?? {};
  // The owner-only send flow requires reviewing the exact text before a draft
  // is reserved, so any non-draft delivery implies the owner approved asking.
  const asked = !!delivery && delivery.status !== DiscordDeliveryStatus.DRAFT;
  return {
    ...data.question,
    id: PrimaryQuestionId,
    origin: QuestionOrigin.SOURCE_QUESTION,
    evidence: [],
    suggestion: {
      status: QuestionSuggestionStatus.SUGGESTED,
      dismissedBy: null,
      dismissedAt: null,
      reason: null,
    },
    recipient: delivery?.recipientRole
      ? {
          status: QuestionRecipientState.SELECTED,
          role: delivery.recipientRole,
        }
      : { status: QuestionRecipientState.UNSELECTED },
    status: rowStatus ?? deriveDecisionStatus(data.question),
    askApproval: asked
      ? {
          status: QuestionAskApproval.APPROVED,
          by: null,
          at: null,
          provenance: QuestionAskProvenance.LEGACY_SEND_CONFIRMATION,
        }
      : { status: QuestionAskApproval.PENDING, by: null, at: null },
    ...(data.discord && delivery !== undefined
      ? {
          discord: {
            delivery,
            replies: replies ?? [],
            checkedAt: checkedAt ?? null,
            partial: partial ?? false,
          },
        }
      : {}),
  };
}

export function deriveDecisionStatus(
  q: Pick<
    FeatureData["question"],
    "reply" | "proposal" | "approvedBy" | "approvedAt"
  >,
): QuestionStatus {
  if (q.approvedAt || q.approvedBy) return QuestionStatus.APPROVED;
  if (q.proposal) return QuestionStatus.PROPOSED;
  if (q.reply) return QuestionStatus.ANSWERED;
  return QuestionStatus.OPEN;
}
