import { FeatureParticipant } from "@shared/features/participants";
export { FeatureParticipant } from "@shared/features/participants";
import {
  DiscordPersonSchema,
  DiscordRoleSchema,
  DiscordSnowflake,
  DiscordThreadStateSchema,
  FeatureDiscordSchema,
} from "@shared/features/discord";
import { z } from "zod";

export const FeatureProgress = {
  NOT_STARTED: "not_started",
  IN_PROGRESS: "in_progress",
  DONE: "done",
} as const;
export type FeatureProgress = (typeof FeatureProgress)[keyof typeof FeatureProgress];
export const FeatureProgressEvent = {
  START: "start",
  COMPLETE: "complete",
  REOPEN: "reopen",
  RESET: "reset",
} as const;
export type FeatureProgressEvent = (typeof FeatureProgressEvent)[keyof typeof FeatureProgressEvent];

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
// Owner-only review of permission to ask. RESTORE reopens a rejected
// suggestion to pending approval.
export const AskReviewChange = {
  APPROVE: "approve_ask",
  REJECT: "reject_ask",
  RESTORE: "reopen_ask",
} as const;
export type AskReviewChange =
  (typeof AskReviewChange)[keyof typeof AskReviewChange];
// Reserved id of the question stored in the legacy `question` field.
export const PrimaryQuestionId = "primary";
export const MaxSuggestedQuestions = 20;
export const MaxSuggestionBatch = 5;
export const MaxQuestionEvidence = 3;
export const MaxQuestionProposals = 50;
// A proposal is an agent-extracted candidate shown in chat. It is not a pool
// question: accepting it creates a new one, rejecting it leaves the pool alone.
export const ProposalStatus = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
} as const;
export type ProposalStatus =
  (typeof ProposalStatus)[keyof typeof ProposalStatus];
export const ProposalDecision = {
  ACCEPT: "accept",
  REJECT: "reject",
} as const;
export type ProposalDecision =
  (typeof ProposalDecision)[keyof typeof ProposalDecision];
export const MaxEvidenceExcerpt = 600;
export const MaxQuestionText = 1000;
export const MaxOwnerReason = 500;
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
export const QuestionApprovalChat = {
  ACTION: "show-feature-questions",
  RENDERER: "feature.question-approvals",
} as const;

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
  // Why that role was suggested, or why responsibility is unresolved.
  ownerReason: z.string().max(MaxOwnerReason).nullable().default(null),
  origin: z.enum(QuestionOrigin),
  evidence: z.array(QuestionEvidenceSchema).max(MaxQuestionEvidence),
  suggestion: z.object({
    // "accepted" was written by an abandoned earlier design; it means a
    // normal pool question.
    status: z.preprocess(
      (value) =>
        value === "accepted" ? QuestionSuggestionStatus.SUGGESTED : value,
      z.enum(QuestionSuggestionStatus),
    ),
    dismissedBy: z.string().nullable(),
    dismissedAt: z.string().nullable(),
    reason: z.string().nullable(),
  }),
  recipient: z.object({
    status: z.enum(QuestionRecipientState),
    participant: z.enum(FeatureParticipant).optional(),
    role: DiscordRoleSchema.optional(),
    // Verified individual; mutually exclusive with `role`.
    person: DiscordPersonSchema.optional(),
  }),
  status: z.enum(QuestionStatus),
  askApproval: z.object({
    status: z.enum(QuestionAskApproval),
    by: z.string().nullable(),
    at: z.string().nullable(),
    provenance: z.enum(QuestionAskProvenance).optional(),
    reason: z.string().nullable().optional(),
  }),
  discord: DiscordThreadStateSchema.optional(),
});
export type FeatureQuestionItem = z.infer<typeof FeatureQuestionItemSchema>;
export const QuestionProposalSchema = z.object({
  id: z.string().min(1).max(100),
  text: z.string().min(1),
  owner: z.enum(FeatureParticipant).nullable(),
  ownerReason: z.string().max(MaxOwnerReason).nullable().default(null),
  origin: z.enum(QuestionOrigin),
  evidence: z.array(QuestionEvidenceSchema).max(MaxQuestionEvidence),
  status: z.enum(ProposalStatus),
  decidedBy: z.string().nullable().default(null),
  decidedAt: z.string().nullable().default(null),
  // Pool question created by accepting this proposal.
  questionId: z.string().nullable().default(null),
});
export type QuestionProposal = z.infer<typeof QuestionProposalSchema>;
export type FeatureQuestionView = Omit<FeatureQuestionItem, "owner"> & {
  owner: FeatureParticipant | null;
};

// Import-time screenshot of the selected Stitch screen. Only the opaque storage
// handle and descriptive metadata are persisted; image bytes live in private
// application blob storage and are read through feature access checks.
export const MaxScreenshotBytes = 1024 * 1024;
export const ScreenshotMediaTypes = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;
export const FeatureScreenshotSchema = z.object({
  storage: z.object({
    // Opaque provider handle. The encrypted fallback handle can be long.
    id: z.string().min(1).max(6000),
    provider: z.string().min(1).max(200),
    encrypted: z.boolean(),
    mimeType: z.enum(ScreenshotMediaTypes),
    size: z.number().int().positive().max(MaxScreenshotBytes),
    createdAt: z.string().optional(),
  }),
  capturedAt: z.string(),
  label: z.string().min(1).max(200),
  projectId: z.string().max(100).optional(),
  screenId: z.string().max(100).optional(),
  scope: z.string().min(1).max(600),
});
export type FeatureScreenshot = z.infer<typeof FeatureScreenshotSchema>;

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
        screenshot: FeatureScreenshotSchema.optional(),
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
  proposals: z
    .array(QuestionProposalSchema)
    .max(MaxQuestionProposals)
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
  featureStatus: z.enum(FeatureProgress),
  data: FeatureDataSchema,
  ownerEmail: z.string(),
  canEdit: z.boolean(),
  canApprove: z.boolean(),
});
export type Feature = z.infer<typeof FeatureSchema>;
// get-feature attaches the stored Stitch screenshot as a vision image. The
// framework lifts `_agentImages` out of the tool result before the model reads
// the JSON, so it must stay declared here or output validation strips it.
export const AgentImageSchema = z.object({
  data: z.string().min(1),
  mediaType: z.enum(ScreenshotMediaTypes),
  label: z.string().min(1).max(200).optional(),
});
export const FeatureWithImagesSchema = FeatureSchema.extend({
  _agentImages: z.array(AgentImageSchema).max(1).optional(),
});
export type FeatureWithImages = z.infer<typeof FeatureWithImagesSchema>;
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
export const FeatureProgressChangeSchema = RevisionInput.extend({
  event: z.enum(FeatureProgressEvent),
});
// Discord delivery and reply checks target the primary question unless a
// suggested question id is given.
export const DiscordQuestionInput = RevisionInput.extend({
  questionId: z
    .string()
    .min(1)
    .max(100)
    .optional()
    .describe(
      "Suggested question id. Omit for the primary question's Discord thread.",
    ),
});
// Optional one-time follow-up, enabled by the owner in the send dialog.
export const DiscordSendInput = DiscordQuestionInput.extend({
  followUpHours: z
    .number()
    .int()
    .min(1)
    .max(24)
    .optional()
    .describe("Opt-in delay in hours for one automatic follow-up."),
});
export const DiscordFollowUpInput = DiscordQuestionInput.extend({
  hours: z.number().int().min(1).max(24),
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
const OwnerReasonInput = z
  .string()
  .trim()
  .min(1)
  .max(MaxOwnerReason)
  .nullable()
  .describe(
    "Evidence-based reason for the suggested role; required when owner is set. When owner is null, say what evidence is missing.",
  );
export const SuggestedQuestionInput = z
  .object({
    text: z.string().trim().min(1).max(MaxQuestionText),
    origin: z
      .enum(QuestionOrigin)
      .describe(
        'Use "source_question" only when a source explicitly poses the question; use "agent_finding" for a mismatch or gap you identified.',
      ),
    owner: OwnerInput.default(null),
    ownerReason: OwnerReasonInput.default(null),
    evidence: z.array(EvidenceInput).min(1).max(MaxQuestionEvidence),
  })
  .refine((q) => q.owner === null || !!q.ownerReason, {
    message: "ownerReason is required when a responsible role is suggested.",
    path: ["ownerReason"],
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
    ownerReason: OwnerReasonInput.optional(),
    evidence: z.array(EvidenceInput).min(1).max(MaxQuestionEvidence).optional(),
    recipient: z
      .union([
        z.enum(FeatureParticipant),
        z.strictObject({ discordRoleId: DiscordSnowflake }),
        z.strictObject({ discordUserId: DiscordSnowflake }),
      ])
      .nullable()
      .optional()
      .describe(
        "Select the Discord recipient: a responsibility already mapped to a server role, or (owner only) an existing server role by discordRoleId, or a verified individual who can view the linked channel by discordUserId. Never substituted if verification fails. Null clears the selection.",
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
export const AskReviewChangeSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal(AskReviewChange.APPROVE) }),
  z.object({
    event: z.literal(AskReviewChange.REJECT),
    reason: z.string().trim().min(1).max(500).optional(),
  }),
  z.object({ event: z.literal(AskReviewChange.RESTORE) }),
]);
export type AskReviewChangeInput = z.infer<typeof AskReviewChangeSchema>;

export const ProposalReviewSchema = RevisionInput.extend({
  proposalId: z.string().min(1).max(100),
  decision: z.enum(ProposalDecision),
  allowDuplicate: z
    .boolean()
    .default(false)
    .describe(
      "Add the question even though the pool already has a similar one.",
    ),
});

export const SuggestedQuestionUpdateSchema = RevisionInput.extend({
  questionId: z
    .string()
    .min(1)
    .max(100)
    .describe("Suggested question id from get-feature data.questions."),
  change: SuggestedQuestionChangeSchema,
});
export const SuggestionReviewSchema = z.object({
  created: z.array(z.string()),
  skipped: z.array(
    z.object({
      text: z.string(),
      duplicateOf: z.string(),
      duplicateText: z.string(),
      reason: z.string(),
    }),
  ),
  limitations: z.array(z.string()),
});
export const SuggestedQuestionWriteSchema = FeatureWriteSchema.extend({
  suggestionReview: SuggestionReviewSchema,
});
