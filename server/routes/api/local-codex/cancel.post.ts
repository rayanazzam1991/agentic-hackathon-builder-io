import { LocalCodexCancelStatus } from "@shared/local-codex";
import { defineEventHandler, readBody } from "h3";
import { z } from "zod";

import { requireLocalCodexSession } from "../../../lib/local-codex/access";
import { cancelLocalCodexRun } from "../../../lib/local-codex/runs";

export default defineEventHandler(async (event) => {
  const session = await requireLocalCodexSession(event);
  const body = z
    .object({ sessionId: z.string().min(1).max(200) })
    .passthrough()
    .parse(await readBody(event));
  return {
    status: cancelLocalCodexRun(session.email, body.sessionId)
      ? LocalCodexCancelStatus.CANCELLED
      : LocalCodexCancelStatus.NOT_FOUND,
  };
});
