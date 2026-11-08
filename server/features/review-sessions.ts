import {
  createThread,
  getThread,
  listThreads,
  setThreadArchived,
} from "@agent-native/core/server";
import { getRequestOrgId } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { FeatureResource } from "@shared/features/types";

import { getFeature, requireActor } from "./store";

// A review session is private to its creator; feature sharing does not grant
// access to its chat. Never claim existing unscoped conversations.
export async function createFeatureReviewSession(id: string) {
  const actor = requireActor();
  const feature = await getFeature(id); // Enforces feature viewer access.
  const orgId = getRequestOrgId() ?? null;
  const thread = await createThread(actor, {
    title: `Review: ${feature.title}`,
    scope: { type: FeatureResource.TYPE, id: feature.id, label: feature.title },
    orgId,
  });
  const saved = await getThread(thread.id);
  if (
    !saved ||
    saved.ownerEmail.toLowerCase() !== actor.toLowerCase() ||
    saved.orgId !== orgId ||
    saved.scope?.type !== FeatureResource.TYPE ||
    saved.scope.id !== feature.id
  )
    throw new Error("Could not verify the feature review session.");
  return { threadId: saved.id };
}

export async function listFeatureReviewSessions(id: string) {
  const actor = requireActor();
  await getFeature(id);
  const sessions = await listThreads(actor, {
    scope: { type: FeatureResource.TYPE, id },
    orgId: getRequestOrgId() ?? null,
    limit: 50,
  });
  return sessions.map(({ id: threadId, title, accessBasis }) => ({
    threadId,
    title,
    isOwner: accessBasis === "owner",
  }));
}

export async function archiveFeatureReviewSession(
  id: string,
  threadId: string,
  archived: boolean,
) {
  const actor = requireActor();
  await getFeature(id);
  await assertAccess("chat_thread", threadId, "owner");
  const thread = await getThread(threadId);
  if (
    !thread ||
    thread.ownerEmail.toLowerCase() !== actor.toLowerCase() ||
    thread.orgId !== (getRequestOrgId() ?? null) ||
    thread.scope?.type !== FeatureResource.TYPE ||
    thread.scope.id !== id
  )
    throw new Error("This review session is unavailable for this feature.");
  const updated = await setThreadArchived(threadId, archived, {
    ownerEmail: actor,
  });
  const saved = await getThread(threadId);
  if (
    !updated ||
    !saved ||
    Boolean(saved.archivedAt) !== archived ||
    saved.scope?.type !== FeatureResource.TYPE ||
    saved.scope.id !== id
  )
    throw new Error(
      "Could not verify the review session update. Refresh and try again.",
    );
  return { threadId, archived };
}

export async function openFeatureReviewSession(id: string, threadId: string) {
  requireActor();
  await getFeature(id);
  await assertAccess("chat_thread", threadId, "viewer");
  const thread = await getThread(threadId);
  if (
    !thread ||
    thread.archivedAt ||
    thread.orgId !== (getRequestOrgId() ?? null) ||
    thread.scope?.type !== FeatureResource.TYPE ||
    thread.scope.id !== id
  )
    throw new Error("This review session is unavailable for this feature.");
  return { threadId: thread.id };
}
