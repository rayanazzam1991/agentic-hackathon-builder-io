import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { DiscordChange } from "@shared/features/discord";
import {
  type AskReviewChangeInput,
  type ProposalDecision,
  type SuggestedQuestionChange,
} from "@shared/features/types";
import { useState } from "react";

/**
 * Question edit/review mutations shared by the feature page and the chat card.
 * Both run the same frontend actions, so the owner check and revision guard
 * apply identically on either surface.
 */
export function useQuestionActions(
  id: string,
  revision: number,
  refetch: () => Promise<unknown>,
) {
  const t = useT();
  const edit = useActionMutation("update-feature-suggested-question");
  const review = useActionMutation("review-feature-suggested-question-ask");
  const proposal = useActionMutation("review-feature-question-proposal");
  const discord = useActionMutation("update-feature-discord");
  const send = useActionMutation("send-feature-discord-question");
  const check = useActionMutation("check-feature-discord-replies");
  const sync = useActionMutation("sync-feature-discord-replies");
  const scheduleFollowUp = useActionMutation("schedule-discord-followup");
  const cancelFollowUp = useActionMutation("cancel-discord-followup");
  const recheckFollowUp = useActionMutation("check-discord-followup");
  const [error, setError] = useState<string>();

  async function guarded(write: () => Promise<unknown>) {
    setError(undefined);
    try {
      await write();
    } catch (e) {
      setError(actionErrorMessage(e) ?? t("coordinator.questions.error"));
      await refetch();
      throw e;
    }
  }
  return {
    error,
    clearError: () => setError(undefined),
    pending:
      edit.isPending ||
      review.isPending ||
      proposal.isPending ||
      discord.isPending ||
      send.isPending ||
      check.isPending,
    sending: send.isPending,
    draftQuestion: (questionId: string) =>
      guarded(() =>
        discord.mutateAsync({
          id,
          revision,
          change: { event: DiscordChange.QUESTION_DRAFT, questionId },
        }),
      ),
    sendQuestion: (questionId: string, followUpHours?: number) =>
      guarded(() =>
        send.mutateAsync({
          id,
          revision,
          questionId,
          ...(followUpHours ? { followUpHours } : {}),
        }),
      ),
    checkQuestion: (questionId: string) =>
      guarded(() => check.mutateAsync({ id, revision, questionId })),
    syncReplies: () => guarded(() => sync.mutateAsync({ id })),
    scheduleQuestionFollowUp: (questionId: string, hours: number) =>
      guarded(() =>
        scheduleFollowUp.mutateAsync({ id, revision, questionId, hours }),
      ),
    cancelQuestionFollowUp: (questionId: string) =>
      guarded(() => cancelFollowUp.mutateAsync({ id, revision, questionId })),
    recheckQuestionFollowUp: (questionId: string) =>
      guarded(() => recheckFollowUp.mutateAsync({ id, revision, questionId })),
    editQuestion: (questionId: string, change: SuggestedQuestionChange) =>
      guarded(() => edit.mutateAsync({ id, revision, questionId, change })),
    reviewProposal: (
      proposalId: string,
      decision: ProposalDecision,
      allowDuplicate = false,
    ) =>
      guarded(() =>
        proposal.mutateAsync({
          id,
          revision,
          proposalId,
          decision,
          allowDuplicate,
        }),
      ),
    reviewQuestion: (questionId: string, change: AskReviewChangeInput) =>
      guarded(() => review.mutateAsync({ id, revision, questionId, change })),
  };
}
