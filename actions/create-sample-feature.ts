import { defineAction } from "@agent-native/core/action";
import { getRequestOrgId } from "@agent-native/core/server/request-context";
import { FeatureWriteSchema, QuestionStatus } from "@shared/features/types";
import { z } from "zod";

import { getDb, schema } from "../server/db";
import { featureErrors } from "../server/features/errors";
import { featureLink } from "../server/features/links";
import { featureWriteReceipt } from "../server/features/receipt";
import { createSampleData } from "../server/features/sample";
import { getFeature, requireActor } from "../server/features/store";

export default defineAction({
  description:
    "Create a private synthetic cancellation feature with Confluence, Jira and Figma excerpts and one known mismatch. No live sources or messages.",
  schema: z.object({}),
  outputSchema: FeatureWriteSchema,
  errors: featureErrors,
  deferLoading: false,
  link: featureLink,
  run: async () => {
    const actor = requireActor();
    const id = crypto.randomUUID();
    await getDb()
      .insert(schema.features)
      .values({
        id,
        title: "Order cancellation window",
        status: QuestionStatus.OPEN,
        data: createSampleData(actor),
        ownerEmail: actor,
        orgId: getRequestOrgId(),
      });
    return featureWriteReceipt(
      await getFeature(id),
      "Created and verified the sample feature.",
    );
  },
});
