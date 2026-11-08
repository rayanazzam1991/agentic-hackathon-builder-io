import { DiscordDeliveryStatus } from "@shared/features/discord";
import {
  PrimaryQuestionId,
  FeatureSource,
  QuestionAskApproval,
  QuestionAskProvenance,
  QuestionOrigin,
  QuestionRecipientState,
  QuestionStatus,
  QuestionSuggestionStatus,
  type FeatureData,
  type FeatureQuestionView,
} from "@shared/features/types";

export const ReviewInstruction = "Review the captured sources for conflicting or missing business rules. Identify evidence and questions; do not assume a mismatch or a PO decision.";

export function isReviewInstruction(data: FeatureData): boolean {
  return data.question.text === ReviewInstruction && !data.question.reply &&
    !data.question.proposal && !data.question.approvedAt && !data.question.approvedBy &&
    !data.discord?.delivery && !(data.discord?.replies?.length);
}

// Authority: `data.question`, `data.discord` and the feature row status are
// the only source of truth for the primary question. `data.questions` holds
// only additional suggested questions. Reading never rewrites stored data.
export function getFeatureQuestions(
  data: FeatureData,
  rowStatus?: QuestionStatus,
): FeatureQuestionView[] {
  return [projectPrimaryQuestion(data, rowStatus), ...(data.questions ?? [])];
}

export function projectPrimaryQuestion(
  data: FeatureData,
  rowStatus?: QuestionStatus,
): FeatureQuestionView {
  const { delivery, replies, checkedAt, partial } = data.discord ?? {};
  // The owner-only send flow requires reviewing the exact text before a draft
  // is reserved, so any non-draft delivery implies the owner approved asking.
  const asked = !!delivery && delivery.status !== DiscordDeliveryStatus.DRAFT;
  return {
    ...data.question,
    ownerReason: null,
    id: PrimaryQuestionId,
    origin: QuestionOrigin.SOURCE_QUESTION,
    evidence: [],
    suggestion: {
      status: QuestionSuggestionStatus.SUGGESTED,
      dismissedBy: null,
      dismissedAt: null,
      reason: null,
    },
    recipient: delivery?.recipientRole
      ? {
          status: QuestionRecipientState.SELECTED,
          role: delivery.recipientRole,
        }
      : { status: QuestionRecipientState.UNSELECTED },
    status: rowStatus ?? deriveDecisionStatus(data.question),
    askApproval: asked
      ? {
          status: QuestionAskApproval.APPROVED,
          by: null,
          at: null,
          provenance: QuestionAskProvenance.LEGACY_SEND_CONFIRMATION,
        }
      : { status: QuestionAskApproval.PENDING, by: null, at: null },
    ...(data.discord && delivery !== undefined
      ? {
          discord: {
            delivery,
            replies: replies ?? [],
            checkedAt: checkedAt ?? null,
            partial: partial ?? false,
          },
        }
      : {}),
  };
}

export function deriveDecisionStatus(
  q: Pick<
    FeatureData["question"],
    "reply" | "proposal" | "approvedBy" | "approvedAt"
  >,
): QuestionStatus {
  if (q.approvedAt || q.approvedBy) return QuestionStatus.APPROVED;
  if (q.proposal) return QuestionStatus.PROPOSED;
  if (q.reply) return QuestionStatus.ANSWERED;
  return QuestionStatus.OPEN;
}

const STOPWORDS = new Set(
  "a an and are as at be by can do does for from has have how in is it of on or should the this that to was we what when which will with".split(
    " ",
  ),
);
const tokens = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((t) => t && !STOPWORDS.has(t)),
  );
export const DuplicateSimilarityThreshold = 0.7;
export function questionSimilarity(a: string, b: string) {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const t of x) if (y.has(t)) shared++;
  return shared / (x.size + y.size - shared);
}

// First question whose wording matches or closely overlaps `text`.
export function findSimilarQuestion<T extends { text: string }>(
  questions: readonly T[],
  text: string,
): { question: T; exact: boolean; similarity: number } | undefined {
  const key = text.replace(/\s+/g, " ").trim().toLowerCase();
  for (const question of questions) {
    const exact =
      question.text.replace(/\s+/g, " ").trim().toLowerCase() === key;
    const similarity = exact ? 1 : questionSimilarity(question.text, text);
    if (exact || similarity >= DuplicateSimilarityThreshold)
      return { question, exact, similarity };
  }
  return undefined;
}

// Deterministic coverage notes returned with every suggestion review so the
// agent cannot overstate what the captured sources can establish.
export function sourceCaptureLimitations(data: FeatureData): string[] {
  const kinds = new Set(data.sources.map((s) => s.kind));
  const notes: string[] = [];
  notes.push(
    data.sample
      ? "Sources are synthetic sample excerpts, not company content."
      : "Sources are one-time captured provider text, not continuously monitored; they may be stale.",
  );
  if (!data.sample)
    notes.push(
      "Comments, attachments, macros and Jira custom-field acceptance criteria were not captured.",
    );
  const design =
    kinds.has(FeatureSource.FIGMA) || kinds.has(FeatureSource.STITCH);
  if (!design)
    notes.push(
      "No design source was captured; design contents are unverified.",
    );
  else
    notes.push(
      "Design evidence is extracted text only; it does not establish visibility, geometry, images or prototype behaviour.",
    );
  if (kinds.has(FeatureSource.CONFLUENCE) && design)
    notes.push(
      "Confluence statements about the design are reported claims until independently read from the design source.",
    );
  for (const s of data.sources)
    if (s.scope) notes.push(`${s.kind}: ${s.scope}`);
  return notes;
}

// Identifies the notified target; roles and users never share a key.
export const recipientKey = (r: FeatureQuestionView["recipient"]) =>
  r.status !== QuestionRecipientState.SELECTED
    ? null
    : r.person
      ? `user:${r.person.id}`
      : r.role
        ? `role:${r.role.id}`
        : null;
