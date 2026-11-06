import { defineAction } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { QuestionStatus } from "@shared/features/types";
import { desc } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db";
import { featureErrors } from "../server/features/errors";
import { questionMachine } from "../server/features/lifecycle";
import { featureListLink } from "../server/features/links";
import { requireActor } from "../server/features/store";
export default defineAction({
  description:
    "List up to 30 accessible feature review workspaces without source bodies.",
  schema: z.object({}),
  outputSchema: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.enum(QuestionStatus),
      revision: z.number(),
    }),
  ),
  link: featureListLink,
  errors: featureErrors,
  http: { method: "GET" },
  deferLoading: false,
  run: async () => {
    requireActor();
    const rows = await getDb()
      .select({
        id: schema.features.id,
        title: schema.features.title,
        status: schema.features.status,
        revision: schema.features.revision,
      })
      .from(schema.features)
      .where(accessFilter(schema.features, schema.featureShares))
      .orderBy(desc(schema.features.id))
      .limit(30);
    return rows.map((row) => ({
      ...row,
      status: questionMachine.parseState(row.status),
    }));
  },
});
