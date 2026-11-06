import { assertAccess } from "@agent-native/core/sharing";
import { getFeatureQuestions } from "@shared/features/questions";
import {
  FeatureResource,
  MaxSuggestedQuestions,
  QuestionAskApproval,
  QuestionOrigin,
  QuestionRecipientState,
  QuestionStatus,
  QuestionSuggestionStatus,
  SuggestionChange,
  type FeatureData,
  type FeatureQuestionItem,
  type SuggestedQuestionChange,
  type SuggestedQuestionInput,
} from "@shared/features/types";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../db";
import { featureErrors } from "./errors";
import { getFeature, requireActor } from "./store";

type Evidence = FeatureQuestionItem["evidence"];

const normalize = (text: string) =>
  text.replace(/\s+/g, " ").trim().toLowerCase();
const invalid = (message: string) =>
  featureErrors.noWrite(message, "invalid_suggestion", { statusCode: 422 });

// Evidence must cite a source already captured on this feature and quote it.
function resolveEvidence(
  data: FeatureData,
  evidence: SuggestedQuestionInput["evidence"],
): Evidence {
  return evidence.map(({ source, excerpt }) => {
    const captured = data.sources.find((s) => s.kind === source);
    if (!captured)
      throw invalid(`This feature has no captured ${source} source to cite.`);
    if (!normalize(captured.excerpt).includes(normalize(excerpt)))
      throw invalid(
        `The excerpt was not found in the captured ${source} source. Quote it exactly.`,
      );
    return {
      source,
      excerpt: excerpt.trim(),
      version: captured.version,
      ...(captured.url ? { url: captured.url } : {}),
    };
  });
}

function selectRecipient(
  data: FeatureData,
  participant: NonNullable<
    Extract<SuggestedQuestionChange, { event: "edit" }>["recipient"]
  >,
): FeatureQuestionItem["recipient"] {
  const role = data.discord?.roleMappings?.[participant];
  if (!role)
    throw invalid(
      `${participant} is not mapped to a Discord role. Map it in People and roles first.`,
    );
  return { status: QuestionRecipientState.SELECTED, participant, role };
}

function assertNoDuplicates(data: FeatureData, texts: string[]) {
  const seen = new Set(
    getFeatureQuestions(data)
      .filter((q) => q.suggestion.status !== QuestionSuggestionStatus.DISMISSED)
      .map((q) => normalize(q.text)),
  );
  for (const text of texts) {
    const key = normalize(text);
    if (seen.has(key))
      throw invalid("A question with this text already exists on the feature.");
    seen.add(key);
  }
}

async function save(
  id: string,
  revision: number,
  data: FeatureData,
  event: string,
  detail: string,
) {
  const actor = requireActor();
  if (data.activity.length >= 100)
    throw featureErrors.noWrite(
      "This feature reached its activity limit.",
      "activity_limit",
    );
  data.activity.push({
    id: crypto.randomUUID(),
    event,
    actor,
    at: new Date().toISOString(),
    detail,
  });
  const [saved] = await getDb()
    .update(schema.features)
    .set({ data, revision: revision + 1 })
    .where(
      and(eq(schema.features.id, id), eq(schema.features.revision, revision)),
    )
    .returning({ id: schema.features.id });
  if (!saved)
    throw featureErrors.noWrite(
      "Another edit won the race. Refresh and review before retrying.",
      "stale_revision",
      { statusCode: 409 },
    );
  return getFeature(id);
}

async function load(id: string, revision: number) {
  requireActor();
  await assertAccess(FeatureResource.TYPE, id, "editor");
  const current = await getFeature(id);
  if (current.revision !== revision)
    throw featureErrors.noWrite(
      "This feature changed. Review the latest version before saving.",
      "stale_revision",
      { statusCode: 409 },
    );
  return { current, data: structuredClone(current.data) };
}

export async function createSuggestedQuestions(
  id: string,
  revision: number,
  inputs: SuggestedQuestionInput[],
) {
  const { data } = await load(id, revision);
  const existing = data.questions ?? [];
  if (existing.length + inputs.length > MaxSuggestedQuestions)
    throw invalid(
      `A feature can hold at most ${MaxSuggestedQuestions} suggested questions, including dismissed ones.`,
    );
  assertNoDuplicates(
    data,
    inputs.map((q) => q.text),
  );
  const created: FeatureQuestionItem[] = inputs.map((input) => ({
    id: crypto.randomUUID(),
    text: input.text,
    owner: input.owner,
    origin: input.origin,
    evidence: resolveEvidence(data, input.evidence),
    suggestion: {
      status: QuestionSuggestionStatus.SUGGESTED,
      dismissedBy: null,
      dismissedAt: null,
      reason: null,
    },
    recipient: { status: QuestionRecipientState.UNSELECTED },
    status: QuestionStatus.OPEN,
    askApproval: { status: QuestionAskApproval.PENDING, by: null, at: null },
    reply: null,
    replyBy: null,
    proposal: null,
    rationale: null,
    approvedBy: null,
    approvedAt: null,
  }));
  data.questions = [...existing, ...created];
  const agent = created.filter(
    (q) => q.origin === QuestionOrigin.AGENT_FINDING,
  ).length;
  return save(
    id,
    revision,
    data,
    SuggestionChange.CREATE,
    `${created.length} suggested question(s) added (${agent} agent finding). Nothing was approved or sent.`,
  );
}

export async function changeSuggestedQuestion(
  id: string,
  revision: number,
  questionId: string,
  change: SuggestedQuestionChange,
) {
  const { data } = await load(id, revision);
  const question = data.questions?.find((q) => q.id === questionId);
  if (!question)
    throw featureErrors.noWrite(
      "Suggested question not found. The primary question is changed with update-feature-question.",
      "suggestion_not_found",
      { statusCode: 404 },
    );
  const actor = requireActor();
  const dismissed =
    question.suggestion.status === QuestionSuggestionStatus.DISMISSED;
  let detail: string;
  switch (change.event) {
    case SuggestionChange.EDIT: {
      if (dismissed)
        throw invalid("Restore a dismissed suggestion before editing it.");
      if (question.askApproval.status !== QuestionAskApproval.PENDING)
        throw invalid(
          "A question already reviewed for asking cannot be edited.",
        );
      if (
        change.text === undefined &&
        change.owner === undefined &&
        change.evidence === undefined &&
        change.recipient === undefined
      )
        throw invalid("Provide at least one field to change.");
      if (change.text !== undefined) {
        assertNoDuplicates(
          {
            ...data,
            questions: data.questions?.filter((q) => q.id !== questionId),
          },
          [change.text],
        );
        question.text = change.text;
      }
      if (change.owner !== undefined) question.owner = change.owner;
      if (change.evidence !== undefined)
        question.evidence = resolveEvidence(data, change.evidence);
      if (change.recipient !== undefined)
        question.recipient =
          change.recipient === null
            ? { status: QuestionRecipientState.UNSELECTED }
            : selectRecipient(data, change.recipient);
      detail = "Suggested question edited. Nothing was approved or sent.";
      break;
    }
    case SuggestionChange.DISMISS:
      if (dismissed) throw invalid("This suggestion is already dismissed.");
      if (question.askApproval.status !== QuestionAskApproval.PENDING)
        throw invalid(
          "A question already reviewed for asking cannot be dismissed.",
        );
      question.suggestion = {
        status: QuestionSuggestionStatus.DISMISSED,
        dismissedBy: actor,
        dismissedAt: new Date().toISOString(),
        reason: change.reason ?? null,
      };
      detail = "Suggested question dismissed. It can be restored.";
      break;
    case SuggestionChange.RESTORE:
      if (!dismissed) throw invalid("This suggestion is not dismissed.");
      assertNoDuplicates(
        {
          ...data,
          questions: data.questions?.filter((q) => q.id !== questionId),
        },
        [question.text],
      );
      question.suggestion = {
        status: QuestionSuggestionStatus.SUGGESTED,
        dismissedBy: null,
        dismissedAt: null,
        reason: null,
      };
      detail = "Dismissed suggestion restored.";
      break;
  }
  return save(id, revision, data, change.event, detail);
}
