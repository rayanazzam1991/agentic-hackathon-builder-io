import { defineAction } from "@agent-native/core/action";
import { readAppState } from "@agent-native/core/application-state";
import { FeatureSchema } from "@shared/features/types";
import { z } from "zod";

import { featureErrors } from "../server/features/errors";
import { getFeature } from "../server/features/store";

export default defineAction({
  description:
    "Read current navigation and the selected feature's authoritative evidence, question and revision. Use before acting when the feature is unclear.",
  schema: z.object({}),
  outputSchema: z.object({
    navigation: z.unknown(),
    feature: FeatureSchema.optional(),
  }),
  errors: featureErrors,
  http: false,
  readOnly: true,
  deferLoading: false,
  run: async () => {
    const navigation = await readAppState("navigation");
    const selected = z
      .object({ featureId: z.string().optional() })
      .safeParse(navigation);
    return {
      navigation: navigation ?? null,
      ...(selected.success && selected.data.featureId
        ? { feature: await getFeature(selected.data.featureId) }
        : {}),
    };
  },
});
