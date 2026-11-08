import {
  QuestionApprovalChat,
  FeatureProgressChangeSchema,
  SuggestedQuestionBatchSchema,
  SuggestedQuestionUpdateSchema,
} from "@shared/features/types";
import { z } from "zod";

export const FeatureAgentAction = {
  CREATE: "create-sample-feature",
  LIST: "list-features",
  GET: "get-feature",
  UPDATE: "update-feature-question",
  UPDATE_PROGRESS: "update-feature-progress",
  SUGGEST: "propose-feature-questions",
  UPDATE_SUGGESTION: "update-feature-suggested-question",
  SHOW_QUESTIONS: QuestionApprovalChat.ACTION,
} as const;
export type FeatureAgentAction =
  (typeof FeatureAgentAction)[keyof typeof FeatureAgentAction];
export const FeatureAgentReply = {
  MESSAGE: "message",
  ACTION: "action",
} as const;
export type FeatureAgentReply =
  (typeof FeatureAgentReply)[keyof typeof FeatureAgentReply];
const ResponseSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal(FeatureAgentReply.MESSAGE),
      text: z.string().min(1).max(16000),
    })
    .strict(),
  z
    .object({
      type: z.literal(FeatureAgentReply.ACTION),
      name: z.enum(FeatureAgentAction),
      args: z.record(z.string(), z.unknown()),
    })
    .strict(),
]);

export const FeatureAgentToolStatus = {
  COMPLETED: "completed",
  FAILED: "failed",
} as const;
export type FeatureAgentToolStatus =
  (typeof FeatureAgentToolStatus)[keyof typeof FeatureAgentToolStatus];

// Actions the agent may call with arguments that need strict, defaulted
// validation before they reach the domain layer.
const ArgsSchemas: Partial<Record<FeatureAgentAction, z.ZodType>> = {
  [FeatureAgentAction.UPDATE_PROGRESS]: FeatureProgressChangeSchema,
  [FeatureAgentAction.SUGGEST]: SuggestedQuestionBatchSchema,
  [FeatureAgentAction.UPDATE_SUGGESTION]: SuggestedQuestionUpdateSchema,
};

export function parseFeatureAgentResponse(text: string) {
  const reply = parseRawResponse(text);
  if (reply.type === FeatureAgentReply.ACTION) {
    const schema = ArgsSchemas[reply.name];
    if (schema)
      return {
        ...reply,
        args: schema.parse(reply.args) as Record<string, unknown>,
      };
  }
  return reply;
}

function parseRawResponse(text: string) {
  return ResponseSchema.parse(
    JSON.parse(
      text
        .trim()
        .replace(/^```(?:json)?\s*/, "")
        .replace(/\s*```$/, ""),
    ),
  );
}
