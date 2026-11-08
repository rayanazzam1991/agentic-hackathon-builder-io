import { defineAction } from "@agent-native/core/action";
import {
  FeatureWriteSchema,
  ProposalReviewSchema,
} from "@shared/features/types";

import { featureErrors } from "../server/features/errors";
import { featureLink } from "../server/features/links";
import { featureWriteReceipt } from "../server/features/receipt";
import { reviewQuestionProposal } from "../server/features/suggested-questions";
export default defineAction({
  description:
    "Owner-only: accept an agent question proposal into the question pool as a new question, or reject the proposal. Rejecting never changes the pool. A similar pool question blocks acceptance unless allowDuplicate is true. Sends nothing. Requires the current revision.",
  schema: ProposalReviewSchema,
  outputSchema: FeatureWriteSchema,
  link: featureLink,
  errors: featureErrors,
  needsApproval: true,
  deferLoading: false,
  run: async (
    { id, revision, proposalId, decision, allowDuplicate },
    context,
  ) => {
    // Agents and direct composition cannot decide; the owner uses the UI.
    if (context?.caller !== "frontend")
      throw featureErrors.noWrite(
        "Review question proposals from the feature chat or review screen.",
        "human_approval_required",
        { statusCode: 403 },
      );
    return featureWriteReceipt(
      await reviewQuestionProposal(
        id,
        revision,
        proposalId,
        decision,
        allowDuplicate,
      ),
      "Recorded and verified the proposal decision. Nothing was sent.",
    );
  },
});
