import { defineAction } from "@agent-native/core/action";
import { FeatureSchema, RevisionInput } from "@shared/features/types";

import { featureErrors } from "../server/features/errors";
import { featureLink } from "../server/features/links";
import { getFeature } from "../server/features/store";
export default defineAction({
  description:
    "Read an accessible feature's source evidence, question, revision, proposed decision and activity. Read before changing a question.",
  schema: RevisionInput.pick({ id: true }),
  outputSchema: FeatureSchema,
  errors: featureErrors,
  http: { method: "GET" },
  deferLoading: false,
  link: featureLink,
  run: ({ id }) => getFeature(id),
});
