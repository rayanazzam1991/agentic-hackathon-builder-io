import { z } from "zod";

export const FeatureAgentAction = {
  CREATE: "create-sample-feature",
  LIST: "list-features",
  GET: "get-feature",
  UPDATE: "update-feature-question",
  SUGGEST: "create-feature-suggested-questions",
  UPDATE_SUGGESTION: "update-feature-suggested-question",
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

export function parseFeatureAgentResponse(text: string) {
  return ResponseSchema.parse(
    JSON.parse(
      text
        .trim()
        .replace(/^```(?:json)?\s*/, "")
        .replace(/\s*```$/, ""),
    ),
  );
}
