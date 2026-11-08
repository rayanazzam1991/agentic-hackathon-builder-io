import { FeatureParticipant } from "@shared/features/participants";
import { z } from "zod";
export const DiscordDeliveryStatus = {
  DRAFT: "draft",
  SENDING: "sending",
  SENT: "sent",
  UNCERTAIN: "uncertain",
} as const;
export type DiscordDeliveryStatus =
  (typeof DiscordDeliveryStatus)[keyof typeof DiscordDeliveryStatus];
export const DiscordChange = {
  CONNECT: "connect",
  DRAFT: "draft",
  RECORD: "record",
  ROLES: "roles",
  QUESTION_DRAFT: "question_draft",
} as const;
export type DiscordChange = (typeof DiscordChange)[keyof typeof DiscordChange];
export const DiscordSnowflake = z.string().regex(/^\d{17,20}$/);
export const DiscordRoleChoice = { NONE: "unassigned" } as const;
export const DiscordMentionPermission = {
  ALLOWED: "allowed",
  DENIED: "denied",
  UNKNOWN: "unknown",
} as const;
export type DiscordMentionPermission =
  (typeof DiscordMentionPermission)[keyof typeof DiscordMentionPermission];
export const DiscordRoleSchema = z.object({
  id: DiscordSnowflake,
  name: z.string().min(1).max(100),
  mentionable: z.boolean(),
  mentionPermission: z.enum(DiscordMentionPermission).optional(),
});
export type DiscordRole = z.infer<typeof DiscordRoleSchema>;
export const DiscordPersonVisibility = {
  VISIBLE: "visible",
  HIDDEN: "hidden",
  UNKNOWN: "unknown",
} as const;
export type DiscordPersonVisibility =
  (typeof DiscordPersonVisibility)[keyof typeof DiscordPersonVisibility];
// Display-only association: roles never grant approval authority.
export const DiscordPersonSchema = z.object({
  id: DiscordSnowflake,
  username: z.string().min(1).max(100),
  displayName: z.string().min(1).max(100),
  roles: z
    .array(z.object({ id: DiscordSnowflake, name: z.string().max(100) }))
    .max(50),
});
export type DiscordPerson = z.infer<typeof DiscordPersonSchema>;
export const DiscordDirectoryPersonSchema = DiscordPersonSchema.extend({
  visibility: z.enum(DiscordPersonVisibility),
});
export type DiscordDirectoryPerson = z.infer<
  typeof DiscordDirectoryPersonSchema
>;
export const DiscordMemberCoverage = {
  COMPLETE: "complete",
  PARTIAL: "partial",
  UNAVAILABLE: "unavailable",
} as const;
export const DiscordDirectorySchema = z.object({
  people: z.array(DiscordDirectoryPersonSchema).max(2000),
  roles: z.array(DiscordRoleSchema).max(1000),
  coverage: z.object({
    members: z.enum(DiscordMemberCoverage),
    listed: z.number().int(),
    visible: z.number().int(),
    hidden: z.number().int(),
    unknown: z.number().int(),
    limitations: z.array(z.string().max(400)).max(10),
  }),
});
export type DiscordDirectory = z.infer<typeof DiscordDirectorySchema>;
export const DiscordRoleMappingsSchema = z.partialRecord(
  z.enum(FeatureParticipant),
  DiscordRoleSchema,
);
export type DiscordRoleMappings = z.infer<typeof DiscordRoleMappingsSchema>;
export const DiscordReplySchema = z.object({
  id: DiscordSnowflake,
  authorId: DiscordSnowflake,
  author: z.string(),
  text: z.string().max(4000),
  at: z.string(),
  url: z.string().url(),
});
export const DiscordDeliverySchema = z.object({
  recipientRole: DiscordRoleSchema.optional(),
  recipientPerson: DiscordPersonSchema.optional(),
  // Channel the reviewed draft was snapshotted for; per-question drafts only.
  channelId: DiscordSnowflake.optional(),
  questionText: z.string().max(1600).optional(),
  status: z.enum(DiscordDeliveryStatus),
  nonce: z.string(),
  content: z.string().max(2000),
  requestedAt: z.string().nullable(),
  messageId: DiscordSnowflake.nullable(),
});
// Message-level state shared by the legacy feature thread and each question.
export const DiscordThreadStateSchema = z.object({
  delivery: DiscordDeliverySchema.nullable(),
  replies: z.array(DiscordReplySchema).max(100),
  checkedAt: z.string().nullable(),
  partial: z.boolean(),
});
export type DiscordThreadState = z.infer<typeof DiscordThreadStateSchema>;
export const FeatureDiscordSchema = DiscordThreadStateSchema.extend({
  roleMappings: DiscordRoleMappingsSchema.optional(),
  guildId: DiscordSnowflake,
  channelId: DiscordSnowflake,
  channelName: z.string(),
  botId: DiscordSnowflake,
});
export type FeatureDiscord = z.infer<typeof FeatureDiscordSchema>;
export const DiscordChangeSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal(DiscordChange.ROLES),
    mappings: z.partialRecord(z.enum(FeatureParticipant), DiscordSnowflake),
  }),
  z.object({
    event: z.literal(DiscordChange.CONNECT),
    channelUrl: z.string().url().max(500),
  }),
  z.object({
    event: z.literal(DiscordChange.DRAFT),
    text: z.string().trim().min(1).max(1600),
  }),
  z.object({
    event: z.literal(DiscordChange.QUESTION_DRAFT),
    questionId: z.string().min(1).max(100),
  }),
  z.object({
    event: z.literal(DiscordChange.RECORD),
    messageId: DiscordSnowflake,
  }),
]);
