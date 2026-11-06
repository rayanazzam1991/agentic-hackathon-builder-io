import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import {
  FeatureDataSchema,
  FeatureResource,
  FeatureSchema,
  QuestionEvent,
  type FeatureData,
  type QuestionChange,
} from "@shared/features/types";
import { and, eq, inArray } from "drizzle-orm";

import { getDb, schema } from "../db";
import { featureErrors } from "./errors";
import { questionMachine } from "./lifecycle";

export function requireActor() {
  const actor = getRequestUserEmail();
  if (!actor)
    throw featureErrors.noWrite(
      "Sign in to use the feature workspace.",
      "not_authenticated",
      { statusCode: 401 },
    );
  return actor;
}
export async function getFeature(id: string) {
  requireActor();
  const access = await assertAccess(FeatureResource.TYPE, id, "viewer");
  const [row] = await getDb()
    .select()
    .from(schema.features)
    .where(eq(schema.features.id, id));
  if (!row)
    throw featureErrors.noWrite("Feature not found.", "feature_not_found", {
      statusCode: 404,
    });
  return FeatureSchema.parse({
    ...row,
    status: questionMachine.parseState(row.status),
    data: FeatureDataSchema.parse(row.data),
    canEdit:
      access.role === "owner" ||
      access.role === "admin" ||
      access.role === "editor",
    canApprove: access.role === "owner",
  });
}

export async function changeQuestion(
  id: string,
  revision: number,
  change: QuestionChange | { event: typeof QuestionEvent.APPROVE },
  replySourceUrl?: string,
) {
  const actor = requireActor();
  await assertAccess(
    FeatureResource.TYPE,
    id,
    change.event === QuestionEvent.APPROVE ? "owner" : "editor",
  );
  const current = await getFeature(id);
  if (current.revision !== revision)
    featureErrors.noWrite(
      "This feature changed. Review the latest version before saving.",
      "stale_revision",
      { statusCode: 409 },
    );
  if (!questionMachine.can(current.status, change.event))
    featureErrors.noWrite(
      "This step is not available in the current state.",
      "invalid_transition",
      { statusCode: 409 },
    );
  if (current.data.activity.length >= 100)
    featureErrors.noWrite(
      "This sample reached its activity limit. Start a fresh sample.",
      "activity_limit",
    );
  const data: FeatureData = structuredClone(current.data);
  let detail: string;
  switch (change.event) {
    case QuestionEvent.ASSIGN:
      data.question.owner = change.owner;
      detail = `Question assigned to ${change.owner}. No message was sent.`;
      break;
    case QuestionEvent.REPLY:
      data.question = {
        ...data.question,
        reply: change.text,
        replyBy: change.respondent,
        proposal: null,
        rationale: null,
        approvedBy: null,
        approvedAt: null,
      };
      delete data.question.replySourceUrl;
      if (replySourceUrl) data.question.replySourceUrl = replySourceUrl;
      detail = `Reply recorded from ${change.respondent}. Approval is still required.`;
      break;
    case QuestionEvent.PROPOSE:
      data.question.proposal = change.text;
      data.question.rationale = change.rationale;
      detail =
        "A decision was proposed for human review. The specification is unchanged.";
      break;
    case QuestionEvent.APPROVE:
      data.question.approvedBy = actor;
      data.question.approvedAt = new Date().toISOString();
      detail =
        "The owner approved this decision. The specification update is a preview; nothing was published.";
      break;
  }
  data.activity.push({
    id: crypto.randomUUID(),
    event: change.event,
    actor,
    at: new Date().toISOString(),
    detail,
  });
  // Revision AND source-state predicates prevent stale edits and lifecycle races.
  const [saved] = await getDb()
    .update(schema.features)
    .set({
      data,
      status: questionMachine.transition(current.status, change.event),
      revision: revision + 1,
    })
    .where(
      and(
        eq(schema.features.id, id),
        eq(schema.features.revision, revision),
        inArray(schema.features.status, [
          ...questionMachine.fromStates(change.event),
        ]),
      ),
    )
    .returning({ id: schema.features.id });
  if (!saved)
    featureErrors.noWrite(
      "Another edit won the race. Refresh and review before retrying.",
      "stale_revision",
      { statusCode: 409 },
    );
  return getFeature(id);
}
