import { defineActionErrors } from "@agent-native/core/action";
export const featureErrors = defineActionErrors(
  "not_authenticated",
  "feature_not_found",
  "stale_revision",
  "invalid_transition",
  "human_approval_required",
  "activity_limit",
  "source_unavailable",
  "invalid_source",
  "discord_unavailable",
  "discord_delivery_pending",
  "invalid_suggestion",
  "suggestion_not_found",
  "proposal_not_found",
  "possible_duplicate",
  "screenshot_cleanup_failed",
);
