import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { featureErrors } from "../server/features/errors";
import { listStitchDesigns, StitchId } from "../server/features/stitch";
import { requireActor } from "../server/features/store";
export default defineAction({
  description:
    "List existing Stitch projects, or screens when projectId is supplied. Read only; never generates or edits designs.",
  schema: z.object({
    projectId: StitchId.optional().describe(
      "Existing project ID; omit to list owned projects.",
    ),
  }),
  outputSchema: z.array(z.object({ id: z.string(), title: z.string() })),
  errors: featureErrors,
  http: { method: "GET" },
  run: async ({ projectId }, context) => {
    requireActor();
    try {
      return await listStitchDesigns(projectId, context);
    } catch {
      throw featureErrors.noWrite(
        "Stitch could not list designs. Check the connected account and project access.",
        "source_unavailable",
        { statusCode: 503 },
      );
    }
  },
});
