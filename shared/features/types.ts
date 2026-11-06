import { FeatureParticipant } from "@shared/features/participants";
export { FeatureParticipant } from "@shared/features/participants";
import {
  DiscordRoleSchema,
  DiscordThreadStateSchema,
  FeatureDiscordSchema,
} from "@shared/features/discord";
import { z } from "zod";

export const QuestionStatus = {
  OPEN: "open",
  ANSWERED: "answered",
  PROPOSED: "proposed",
  APPROVED: "approved",
} as const;
export type QuestionStatus =
  (typeof QuestionStatus)[keyof typeof QuestionStatus];
export const QuestionEvent = {
  ASSIGN: "assign",
  REPLY: "reply",
  PROPOSE: "propose",
  APPROVE: "approve",
} as const;
export type QuestionEvent = (typeof QuestionEvent)[keyof typeof QuestionEvent];
// Permission to ask a question in Discord, independent of approving the
// business decision that its answer may eventually produce. Rejection is an
// owner decision: only an owner-scoped action (not yet implemented) may reopen
// it. A dismissed suggestion (see QuestionSuggestionStatus) is a different,
// editor-reversible state.
export const QuestionAskApproval = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
} as const;
export type QuestionAskApproval =
  (typeof QuestionAskApproval)[keyof typeof QuestionAskApproval];
// How an ask approval is known. Legacy reviews never stored an explicit
// approval; the owner-only frontend send flow implied it once a draft left the
// draft state, so legacy approvals carry no actor or time.
export const QuestionAskProvenance = {
  LEGACY_SEND_CONFIRMATION: "legacy_send_confirmation",
  OWNER_CONFIRMED: "owner_confirmed",
} as const;
export type QuestionAskProvenance =
  (typeof QuestionAskProvenance)[keyof typeof QuestionAskProvenance];
export const QuestionOrigin = {
  SOURCE_QUESTION: "source_question",
  AGENT_FINDING: "agent_finding",
} as const;
export type QuestionOrigin =
  (typeof QuestionOrigin)[keyof typeof QuestionOrigin];
export const QuestionSuggestionStatus = {
  SUGGESTED: "suggested",
  DISMISSED: "dismissed",
} as const;
export type QuestionSuggestionStatus =
  (typeof QuestionSuggestionStatus)[keyof typeof QuestionSuggestionStatus];
export const QuestionRecipientState = {
  UNSELECTED: "unselected",
  SELECTED: "selected",
} as const;
export type QuestionRecipientState =
  (typeof QuestionRecipientState)[keyof typeof QuestionRecipientState];
export const SuggestionChange = {
  CREATE: "suggest",
  EDIT: "edit",
  DISMISS: "dismiss",
  RESTORE: "restore",
} as const;
export type SuggestionChange =
  (typeof SuggestionChange)[keyof typeof SuggestionChange];
// Reserved id of the question stored in the legacy `question` field.
export const PrimaryQuestionId = "primary";
export const MaxSuggestedQuestions = 20;
export const MaxSuggestionBatch = 5;
export const MaxQuestionEvidence = 3;
export const MaxEvidenceExcerpt = 600;
export const MaxQuestionText = 1000;
export const FeatureSource = {
  CONFLUENCE: "confluence",
  JIRA: "jira",
  FIGMA: "figma",
  STITCH: "stitch",
} as const;
export type FeatureSource = (typeof FeatureSource)[keyof typeof FeatureSource];
export const DesignProvider = {
  FIGMA: "figma",
  STITCH: "stitch",
  NONE: "none",
} as const;
export type DesignProvider =
  (typeof DesignProvider)[keyof typeof DesignProvider];
export const StitchTool = {
  LIST_PROJECTS: "list_projects",
  GET_PROJECT: "get_project",
  LIST_SCREENS: "list_screens",
  GET_SCREEN: "get_screen",
} as const;
export type StitchTool = (typeof StitchTool)[keyof typeof StitchTool];
export const FeatureResource = {
  TYPE: "coordination-feature",
  PATH: "/features",
} as const;

const QuestionDecisionSchema = z.object({
  text: z.string(),
  owner: z.enum(FeatureParticipant),
  reply: z.string().nullable(),
  replyBy: z.string().nullable(),
  replySourceUrl: z.string().url().optional(),
  proposal: z.string().nullable(),
  rationale: z.string().nullable(),
  approvedBy: z.string().nullable(),
  approvedAt: z.string().nullable(),
});
export const QuestionEvidenceSchema = z.object({
  source: z.enum(FeatureSource),
  excerpt: z.string().min(1).max(MaxEvidenceExcerpt),
  version: z.string(),
  url: z.string().url().optional(),
});
export const FeatureQuestionItemSchema = QuestionDecisionSchema.extend({
  id: z.string().min(1).max(100),
  // Suggested responsibility; null means unresolved, never a guessed owner.
  owner: z.enum(FeatureParticipant).nullable(),
  origin: z.enum(QuestionOrigin),
  evidence: z.array(QuestionEvidenceSchema).max(MaxQuestionEvidence),
  suggestion: z.object({
    status: z.enum(QuestionSuggestionStatus),
    dismissedBy: z.string().nullable(),
    dismissedAt: z.string().nullable(),
    reason: z.string().nullable(),
  }),
  recipient: z.object({
    status: z.enum(QuestionRecipientState),
    participant: z.enum(FeatureParticipant).optional(),
    role: DiscordRoleSchema.optional(),
  }),
  status: z.enum(QuestionStatus),
  askApproval: z.object({
    status: z.enum(QuestionAskApproval),
    by: z.string().nullable(),
    at: z.string().nullable(),
    provenance: z.enum(QuestionAskProvenance).optional(),
  }),
  discord: DiscordThreadStateSchema.optional(),
});
export type FeatureQuestionItem = z.infer<typeof FeatureQuestionItemSchema>;
export type FeatureQuestionView = Omit<FeatureQuestionItem, "owner"> & {
  owner: FeatureParticipant | null;
};

export const FeatureDataSchema = z.object({
  discord: FeatureDiscordSchema.optional(),
  sample: z.boolean(),
  sources: z
    .array(
      z.object({
        kind: z.enum(FeatureSource),
        version: z.string(),
        excerpt: z.string(),
        url: z.string().url().optional(),
        capturedAt: z.string().optional(),
        scope: z.string().optional(),
      }),
    )
    .min(2)
    .max(3),
  question: QuestionDecisionSchema,
  // Only additional (suggested) questions. The primary question is always
  // projected from `question` and `discord`, which stay authoritative for it.
  questions: z
    .array(
      FeatureQuestionItemSchema.refine((q) => q.id !== PrimaryQuestionId, {
        message: "The primary question id is reserved.",
      }),
    )
    .max(MaxSuggestedQuestions)
    .refine((items) => new Set(items.map((q) => q.id)).size === items.length, {
      message: "Question ids must be unique.",
    })
    .optional(),
  activity: z
    .array(
      z.object({
        id: z.string(),
        event: z.string(),
        actor: z.string(),
        at: z.string(),
        detail: z.string(),
      }),
    )
    .max(100),
});
export type FeatureData = z.infer<typeof FeatureDataSchema>;
export const FeatureSchema = z.object({
  id: z.string(),
  title: z.string(),
  revision: z.number().int(),
  status: z.enum(QuestionStatus),
  data: FeatureDataSchema,
  ownerEmail: z.string(),
  canEdit: z.boolean(),
  canApprove: z.boolean(),
});
export type Feature = z.infer<typeof FeatureSchema>;
export const RevisionInput = z.object({
  id: z.string().min(1).max(200).describe("Feature ID from get-feature."),
  revision: z
    .number()
    .int()
    .positive()
    .describe(
      "Observed feature revision. Read again after a stale_revision error.",
    ),
});
export const QuestionChangeSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal(QuestionEvent.ASSIGN),
    owner: z
      .enum(FeatureParticipant)
      .describe("Role responsible for answering the question."),
  }),
  z.object({
    event: z.literal(QuestionEvent.REPLY),
    text: z
      .string()
      .trim()
      .min(1)
      .max(4000)
      .describe("Actual reply supplied by the user, never an invented answer."),
    respondent: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .describe("Person or role whose reply is being recorded."),
  }),
  z.object({
    event: z.literal(QuestionEvent.PROPOSE),
    text: z
      .string()
      .trim()
      .min(1)
      .max(4000)
      .describe("Proposed specification paragraph. This does not approve it."),
    rationale: z
      .string()
      .trim()
      .min(1)
      .max(4000)
      .describe("How the proposal follows from the reply and source evidence."),
  }),
]);
export type QuestionChange = z.infer<typeof QuestionChangeSchema>;

export const FeatureWriteSchema = FeatureSchema.extend({
  _receipt: z.object({
    changed: z.boolean(),
    verified: z.boolean(),
    subject: z.string(),
    summary: z.string(),
  }),
});

const EvidenceInput = z.object({
  source: z
    .enum(FeatureSource)
    .describe("Kind of a source already captured on this feature."),
  excerpt: z
    .string()
    .trim()
    .min(1)
    .max(MaxEvidenceExcerpt)
    .describe(
      "Verbatim text copied from that source's captured excerpt (whitespace and case are ignored).",
    ),
});
const OwnerInput = z
  .enum(FeatureParticipant)
  .nullable()
  .describe(
    "Suggested responsible role, or null when unresolved. Never guess.",
  );
export const SuggestedQuestionInput = z.object({
  text: z.string().trim().min(1).max(MaxQuestionText),
  origin: z
    .enum(QuestionOrigin)
    .describe(
      'Use "source_question" only when a source explicitly poses the question; use "agent_finding" for a mismatch or gap you identified.',
    ),
  owner: OwnerInput.default(null),
  evidence: z.array(EvidenceInput).min(1).max(MaxQuestionEvidence),
});
export type SuggestedQuestionInput = z.infer<typeof SuggestedQuestionInput>;
export const SuggestedQuestionBatchSchema = RevisionInput.extend({
  questions: z.array(SuggestedQuestionInput).min(1).max(MaxSuggestionBatch),
});
export const SuggestedQuestionChangeSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal(SuggestionChange.EDIT),
    text: z.string().trim().min(1).max(MaxQuestionText).optional(),
    owner: OwnerInput.optional(),
    evidence: z.array(EvidenceInput).min(1).max(MaxQuestionEvidence).optional(),
    recipient: z
      .enum(FeatureParticipant)
      .nullable()
      .optional()
      .describe(
        "Select the Discord recipient by responsibility; it must already be mapped to a server role. Null clears the selection.",
      ),
  }),
  z.object({
    event: z.literal(SuggestionChange.DISMISS),
    reason: z.string().trim().min(1).max(500).optional(),
  }),
  z.object({ event: z.literal(SuggestionChange.RESTORE) }),
]);
export type SuggestedQuestionChange = z.infer<
  typeof SuggestedQuestionChangeSchema
>;
