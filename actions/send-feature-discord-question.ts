import { defineAction, isActionContractError } from "@agent-native/core/action";
import { DiscordDeliveryStatus } from "@shared/features/discord";
import { FeatureWriteSchema, RevisionInput } from "@shared/features/types";

import {
  discordFailure,
  sendDiscordQuestion,
} from "../server/features/discord-workflow";
import { featureErrors } from "../server/features/errors";
import { featureLink } from "../server/features/links";
import { featureWriteReceipt } from "../server/features/receipt";
export default defineAction({
  description:
    "Post the exact saved question to its verified Discord channel only after human owner approval in the feature UI. Pending/uncertain deliveries cannot be reposted.",
  schema: RevisionInput,
  outputSchema: FeatureWriteSchema,
  errors: featureErrors,
  link: featureLink,
  needsApproval: true,
  run: async ({ id, revision }, context) => {
    if (context?.caller !== "frontend")
      throw featureErrors.noWrite(
        "Review and send this question from the feature screen.",
        "human_approval_required",
        { statusCode: 403 },
      );
    try {
      const { feature, changed } = await sendDiscordQuestion(id, revision);
      const confirmed =
        feature.data.discord?.delivery?.status === DiscordDeliveryStatus.SENT;
      return {
        ...featureWriteReceipt(
          feature,
          confirmed
            ? "Confirmed the sent Discord question by readback."
            : "Delivery is unconfirmed. Check replies; do not resend.",
        ),
        _receipt: {
          changed,
          verified: confirmed,
          subject: feature.id,
          summary: confirmed
            ? "Discord question confirmed by readback."
            : "Discord delivery unconfirmed. No automatic retry.",
        },
      };
    } catch (error) {
      if (isActionContractError(error)) throw error;
      return discordFailure(error);
    }
  },
});
