import {
  actionErrorMessage,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  registerActionChatRenderer as registerSidebarActionChatRenderer,
  registerToolRenderer as registerSidebarToolRenderer,
} from "@agent-native/toolkit/app/chat";
import {
  registerActionChatRenderer,
  registerToolRenderer,
  type ToolRendererProps,
} from "@agent-native/toolkit/app/chat/chat";
import {
  findSimilarQuestion,
  getFeatureQuestions,
} from "@shared/features/questions";
import {
  FeatureResource,
  ProposalDecision,
  ProposalStatus,
  QuestionApprovalChat,
  QuestionSuggestionStatus,
  type Feature,
  type QuestionProposal,
} from "@shared/features/types";
import { useState } from "react";
import { Link } from "react-router";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { useQuestionActions } from "@/features/coordinator/useQuestionActions";

const FeatureIdSchema = z.object({ id: z.string().min(1) });

/**
 * Chat card for saved questions. It reads the persisted feature itself and
 * writes through the signed-in user's frontend actions, so the agent's tool
 * output never carries or grants approval.
 */
export function QuestionChatCard({ context }: ToolRendererProps) {
  const id =
    FeatureIdSchema.safeParse(context.resultJson).data?.id ??
    FeatureIdSchema.safeParse(context.args).data?.id;
  if (!id) return <Unavailable />;
  return <LiveQuestions id={id} />;
}

function LiveQuestions({ id }: { id: string }) {
  const t = useT();
  const query = useActionQuery("get-feature", { id });
  const actions = useQuestionActions(
    id,
    query.data?.revision ?? 0,
    query.refetch,
  );
  if (query.isPending)
    return <p role="status">{t("coordinator.questions.chat.loading")}</p>;
  if (query.isError || !query.data)
    return (
      <Unavailable message={actionErrorMessage(query.error) ?? undefined} />
    );
  return (
    <Proposals
      feature={query.data}
      actions={actions}
      openFeatureHref={`${FeatureResource.PATH}/${id}`}
    />
  );
}

export function Proposals({
  feature,
  actions,
  openFeatureHref,
}: {
  feature: Feature;
  actions: ReturnType<typeof useQuestionActions>;
  openFeatureHref?: string;
}) {
  const t = useT();
  // Proposal ids whose possible duplicate the user has been shown.
  const [warned, setWarned] = useState<Record<string, string>>({});
  const waiting = (feature.data.proposals ?? []).filter(
    (p) => p.status === ProposalStatus.PENDING,
  );
  const pool = getFeatureQuestions(feature.data, feature.status).filter(
    (q) => q.suggestion.status !== QuestionSuggestionStatus.DISMISSED,
  );
  const disabled = !feature.canApprove || actions.pending;
  const decide = (
    proposalId: string,
    decision: ProposalDecision,
    allowDuplicate = false,
  ) =>
    void actions
      .reviewProposal(proposalId, decision, allowDuplicate)
      .catch(() => undefined);
  function accept(proposal: QuestionProposal) {
    const match = findSimilarQuestion(pool, proposal.text);
    if (match && !warned[proposal.id]) {
      setWarned((current) => ({
        ...current,
        [proposal.id]: match.question.text,
      }));
      return;
    }
    decide(proposal.id, ProposalDecision.ACCEPT, !!match);
  }
  return (
    <div className="space-y-2">
      {actions.error && (
        <p role="alert" className="text-sm text-destructive">
          {actions.error}
        </p>
      )}
      {waiting.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("coordinator.questions.chat.none")}
        </p>
      ) : (
        <ul className="space-y-2">
          {waiting.map((proposal) => (
            <li
              key={proposal.id}
              className="space-y-2 rounded-lg border border-border bg-card p-3"
            >
              <p className="text-sm">{proposal.text}</p>
              <p className="text-xs text-muted-foreground">
                {t(`coordinator.questions.origin.${proposal.origin}`)} ·{" "}
                {t("coordinator.questions.responsibility")}:{" "}
                {proposal.owner ?? t("coordinator.questions.unresolvedOwner")}
              </p>
              {proposal.ownerReason && (
                <p className="text-xs text-muted-foreground">
                  {t("coordinator.questions.reason")}: {proposal.ownerReason}
                </p>
              )}
              {proposal.evidence.length > 0 && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer font-medium">
                    {t("coordinator.questions.evidence")}
                  </summary>
                  <ul className="mt-2 space-y-2">
                    {proposal.evidence.map((evidence, index) => (
                      <li key={`${evidence.source}-${index}`}>
                        <span className="font-medium uppercase">
                          {evidence.source}
                        </span>{" "}
                        · {evidence.version}
                        <blockquote className="mt-1 whitespace-pre-wrap break-words border-s-2 border-border ps-2">
                          {evidence.excerpt}
                        </blockquote>
                        {evidence.url && (
                          <a
                            className="underline"
                            href={evidence.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t("coordinator.questions.sourceLink")}
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {warned[proposal.id] && (
                <p
                  role="status"
                  className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs"
                >
                  {t("coordinator.questions.chat.possibleDuplicate", {
                    question: warned[proposal.id] ?? "",
                  })}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  disabled={disabled}
                  onClick={() => accept(proposal)}
                >
                  {warned[proposal.id]
                    ? t("coordinator.questions.chat.addAnyway")
                    : t("coordinator.questions.chat.approve")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => decide(proposal.id, ProposalDecision.REJECT)}
                >
                  {t("coordinator.questions.chat.reject")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {!feature.canApprove && waiting.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("coordinator.questions.chat.ownerOnly")}
        </p>
      )}
      {openFeatureHref && (
        <Link
          className="inline-block text-xs text-muted-foreground underline"
          to={openFeatureHref}
        >
          {t("coordinator.questions.chat.openFeature")}
        </Link>
      )}
    </div>
  );
}

function Unavailable({ message }: { message?: string | undefined }) {
  const t = useT();
  return (
    <p role="alert" className="text-sm text-destructive">
      {message ?? t("coordinator.questions.chat.unavailable")}
    </p>
  );
}

let registered = false;
export function registerQuestionChatRenderers() {
  if (registered) return;
  registered = true;
  const action = {
    id: QuestionApprovalChat.RENDERER,
    renderer: QuestionApprovalChat.RENDERER,
    Component: QuestionChatCard,
  };
  // The local Codex runtime reports tool names without action metadata.
  const tool = {
    id: QuestionApprovalChat.RENDERER,
    match: QuestionApprovalChat.ACTION,
    Component: QuestionChatCard,
  };
  // The toolkit bundles one registry per entry point: the sidebar reads the
  // root entry's copy and the full chat route reads the chat entry's copy.
  for (const register of [
    registerActionChatRenderer,
    registerSidebarActionChatRenderer,
  ])
    register(action);
  for (const register of [registerToolRenderer, registerSidebarToolRenderer])
    register(tool);
}
