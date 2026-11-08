import { getOrgContext } from "@agent-native/core/org";
import { REASONING_EFFORTS } from "@agent-native/core/shared";
import { QuestionApprovalChat } from "@shared/features/types";
import { LocalCodex } from "@shared/local-codex";
import { createError, defineEventHandler, readBody } from "h3";
import { z } from "zod";

import { runFeatureAgent } from "../../../features/local-agent";
import { requireLocalCodexSession } from "../../../lib/local-codex/access";
import { LocalCodexFailure } from "../../../lib/local-codex/failure";
import { claimLocalCodexRun } from "../../../lib/local-codex/runs";

const RequestSchema = z
  .object({
    model: z.literal(LocalCodex.MODEL).optional(),
    reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
    featureId: z.string().uuid().optional(),
    threadId: z.string().min(1).max(200),
    prompt: z.string().trim().min(1).max(12_000),
    turnId: z.string().min(1).max(200),
  })
  .strict();

export default defineEventHandler(async (event) => {
  const session = await requireLocalCodexSession(event);
  const parsed = RequestSchema.safeParse(await readBody(event));
  if (!parsed.success)
    throw createError({
      statusCode: 400,
      message: "A thread, turn ID, and non-empty message are required.",
    });
  const body = parsed.data;
  const org = await getOrgContext(event);
  const run = claimLocalCodexRun(session.email, body.threadId);
  const encoder = new TextEncoder();
  const messageId = crypto.randomUUID();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (value: unknown) =>
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(value)}\n\n`),
        );
      // The card shows persisted questions; its controls run as the signed-in
      // user in the browser, never through this agent run.
      const onTool = (value: unknown) => {
        const done = value as {
          type?: string;
          toolName?: string;
          toolCallId?: string;
          status?: string;
        };
        const card =
          done.type === "tool-done" &&
          done.toolName === QuestionApprovalChat.ACTION &&
          done.status === "completed" &&
          !!done.toolCallId;
        send(
          card
            ? {
                ...done,
                chatUI: {
                  renderer: QuestionApprovalChat.RENDERER,
                  title: "Questions",
                },
              }
            : value,
        );
        if (card)
          send({
            type: "widget",
            operation: "create",
            widget: {
              id: `${done.toolCallId}:chat-ui`,
              kind: QuestionApprovalChat.RENDERER,
              title: "Questions",
              state: "ready",
              data: { toolCallId: done.toolCallId, toolName: done.toolName },
            },
          });
      };
      try {
        send({
          type: "status",
          message: "Running Codex CLI with your local login.",
        });
        const text = await runFeatureAgent({
          onTool,
          ...(body.reasoningEffort
            ? { reasoningEffort: body.reasoningEffort }
            : {}),
          owner: session.email,
          orgId: org.orgId ?? null,
          threadId: body.threadId,
          prompt: body.featureId
            ? `${body.prompt}\nCurrent feature ID: ${body.featureId}. Use get-feature for authoritative evidence.`
            : body.prompt,
          signal: run.controller.signal,
        });
        const message = {
          id: messageId,
          role: "assistant",
          content: [{ type: "text", text, format: "markdown" }],
        };
        send({ type: "message-start", message: { ...message, content: [] } });
        send({
          type: "message-delta",
          messageId,
          delta: { type: "text", text, format: "markdown" },
        });
        send({ type: "message-done", message });
        send({ type: "done", reason: "complete" });
      } catch (error) {
        if (!run.controller.signal.aborted) {
          send({
            type: "error",
            error:
              error instanceof LocalCodexFailure
                ? error.message
                : "Local Codex did not complete the turn. Inspect the local run log and retry; no production provider was called.",
            recoverable: true,
          });
        }
        send({ type: "done", reason: "error" });
      } finally {
        run.release();
        try {
          controller.close();
        } catch {
          /* Reader already disconnected. */
        }
      }
    },
    cancel() {
      run.controller.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Run-Id": messageId,
      "X-Turn-Id": body.turnId,
    },
  });
});
