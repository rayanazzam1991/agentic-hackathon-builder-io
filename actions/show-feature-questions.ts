import { defineAction } from "@agent-native/core/action";
import {
  FeatureSchema,
  QuestionApprovalChat,
  RevisionInput,
} from "@shared/features/types";

import { featureErrors } from "../server/features/errors";
import { featureLink } from "../server/features/links";
import { getFeature } from "../server/features/store";

// Read-only: it only selects the chat card. Approval, edit and restore run from
// the card as the signed-in user through the same actions as the feature page.
export default defineAction({
  description:
    "Show a feature's pending question proposals in chat as a card where the signed-in user accepts or rejects each one. Read-only; it cannot accept or reject for the user.",
  schema: RevisionInput.pick({ id: true }),
  outputSchema: FeatureSchema,
  readOnly: true,
  errors: featureErrors,
  http: { method: "GET" },
  deferLoading: false,
  link: featureLink,
  chatUI: { renderer: QuestionApprovalChat.RENDERER, title: "Questions" },
  run: ({ id }) => getFeature(id),
});
