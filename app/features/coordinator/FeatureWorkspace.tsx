import { sendToAgentChatAndConfirm } from "@agent-native/core/client/agent-chat";
import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { isReviewInstruction } from "@shared/features/questions";
import { ShareButton } from "@agent-native/toolkit/app/sharing";
import {
  FeatureResource,
  FeatureProgress,
  FeatureProgressEvent,
  QuestionStatus,
  ProposalStatus,
  type QuestionChange,
} from "@shared/features/types";
import { LocalCodex } from "@shared/local-codex";
import {
  IconArrowLeft,
  IconArrowRight,
  IconMessages,
  IconGitCompare,
  IconPlus,
} from "@tabler/icons-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DiscordReview } from "@/features/coordinator/DiscordReview";
import { FeatureStatus } from "@/features/coordinator/FeatureStatus";
import { FeatureReviewSessions } from "@/features/coordinator/FeatureReviewSessions";
import { LiveSourceImport } from "@/features/coordinator/LiveSourceImport";
import { QuestionList } from "@/features/coordinator/QuestionList";
import { Proposals } from "@/features/coordinator/QuestionChatCard";
import { QuestionReview } from "@/features/coordinator/QuestionReview";
import { RemoveAllFeatures } from "@/features/coordinator/RemoveAllFeatures";
import { SourceEvidence } from "@/features/coordinator/SourceEvidence";
import { SpecPreview } from "@/features/coordinator/SpecPreview";
import { useQuestionActions } from "@/features/coordinator/useQuestionActions";
import { LOCAL_CODEX_ENABLED } from "@/lib/agent-transport";

export function FeatureWorkspace({ id }: { id?: string }) {
  const t = useT();
  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 p-5 pb-16 md:p-8">
      {id ? <FeatureDetail id={id} /> : <FeatureList />}
    </main>
  );
}
function FeatureList() {
  const t = useT();
  const navigate = useNavigate();
  const list = useActionQuery("list-features", {});
  const create = useActionMutation("create-sample-feature");
  const [error, setError] = useState<string>();
  const [investigating, setInvestigating] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  async function start() {
    setError(undefined);
    try {
      const feature = await create.mutateAsync({});
      navigate(`${FeatureResource.PATH}/${feature.id}`);
    } catch (e) {
      setError(actionErrorMessage(e) ?? t("coordinator.error"));
    }
  }
  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("coordinator.title")}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setInvestigating(true)}>
            <IconPlus className="size-4" aria-hidden="true" />
            {t("coordinator.investigate")}
          </Button>
        </div>
      </header>
      <Dialog
        open={investigating}
        onOpenChange={(open) => {
          if (!importBusy) setInvestigating(open);
        }}
      >
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"
          onEscapeKeyDown={(event) => { if (importBusy) event.preventDefault(); }}
          onPointerDownOutside={(event) => { if (importBusy) event.preventDefault(); }}
        >
          <DialogHeader>
            <DialogTitle>{t("coordinator.investigate")}</DialogTitle>
            <DialogDescription>{t("coordinator.importHelp")}</DialogDescription>
          </DialogHeader>
          <LiveSourceImport
            onBusyChange={setImportBusy}
            onCancel={() => setInvestigating(false)}
          />
        </DialogContent>
      </Dialog>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {list.isPending ? (
        <p role="status">{t("coordinator.loading")}</p>
      ) : list.isError ? (
        <ErrorState error={list.error} retry={() => void list.refetch()} />
      ) : !list.data?.length ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-14 text-center">
          <IconGitCompare
            className="mx-auto mb-4 size-8 text-muted-foreground"
            aria-hidden="true"
          />
          <h2 className="text-lg font-semibold">{t("coordinator.empty")}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            {t("coordinator.emptyHelp")}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border">
          {list.data.map((feature) => (
            <Link
              className="flex flex-wrap items-center gap-4 p-5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              key={feature.id}
              to={`${FeatureResource.PATH}/${feature.id}`}
            >
              <span className="min-w-0 flex-1 font-medium">{feature.title}</span>
              <span className="rounded-full border px-3 py-1 text-xs font-medium">
                {t(`coordinator.featureProgress.${feature.featureStatus}`)}
              </span>
              <IconArrowRight
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
            </Link>
          ))}
        </div>
      )}
      {list.data?.length === 30 && (
        <p className="text-sm text-muted-foreground">{t("coordinator.listLimit")}</p>
      )}
      <details className="text-sm text-muted-foreground">
        <summary className="cursor-pointer font-medium">{t("coordinator.moreOptions")}</summary>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => void start()} disabled={create.isPending}>
            <IconGitCompare className="size-4" aria-hidden="true" />
            {create.isPending ? t("coordinator.creating") : t("coordinator.create")}
          </Button>
          {!!list.data?.length && <RemoveAllFeatures onRemoved={() => void list.refetch()} />}
        </div>
      </details>
    </>
  );
}
function FeatureDetail({ id }: { id: string }) {
  const t = useT();
  const query = useActionQuery("get-feature", { id });
  const update = useActionMutation("update-feature-question");
  const approve = useActionMutation("approve-feature-decision");
  const progress = useActionMutation("update-feature-progress");
  const createReviewSession = useActionMutation("create-feature-review-session");
  const [startingReview, setStartingReview] = useState(false);
  const [pageError, setError] = useState<string>();
  const questions = useQuestionActions(
    id,
    query.data?.revision ?? 0,
    query.refetch,
  );
  const error = questions.error ?? pageError;
  if (query.isPending) return <p role="status">{t("coordinator.loading")}</p>;
  if (query.isError || !query.data)
    return (
      <ErrorState error={query.error} retry={() => void query.refetch()} />
    );
  const feature = query.data;
  const pending = update.isPending || approve.isPending || progress.isPending || startingReview || questions.pending;
  const progressEvents = feature.featureStatus === FeatureProgress.NOT_STARTED
    ? [FeatureProgressEvent.START]
    : feature.featureStatus === FeatureProgress.IN_PROGRESS
      ? [FeatureProgressEvent.COMPLETE, FeatureProgressEvent.RESET]
      : [FeatureProgressEvent.REOPEN];
  async function changeProgress(event: FeatureProgressEvent) {
    setError(undefined);
    try {
      await progress.mutateAsync({ id, revision: feature.revision, event });
    } catch (e) {
      setError(actionErrorMessage(e) ?? t("coordinator.error"));
      await query.refetch();
    }
  }
  async function change(change: QuestionChange) {
    setError(undefined);
    try {
      await update.mutateAsync({ id, revision: feature.revision, change });
    } catch (e) {
      setError(actionErrorMessage(e) ?? t("coordinator.error"));
      await query.refetch();
      throw e;
    }
  }
  async function accept() {
    setError(undefined);
    try {
      await approve.mutateAsync({ id, revision: feature.revision });
    } catch (e) {
      setError(actionErrorMessage(e) ?? t("coordinator.error"));
      await query.refetch();
      throw e;
    }
  }
  async function ask(propose = false) {
    setError(undefined);
    setStartingReview(true);
    try {
      const { threadId } = await createReviewSession.mutateAsync({ id });
      const delivery = await sendToAgentChatAndConfirm({
        chatTarget: "local",
        submit: true,
        targetTabId: threadId,
        ...(LOCAL_CODEX_ENABLED
          ? { engine: LocalCodex.ENGINE, model: LocalCodex.MODEL }
          : {}),
        message: propose
          ? t("coordinator.proposalMessage", { title: feature.title })
          : t("coordinator.reviewMessage", { title: feature.title }),
        context: `${t(propose ? "coordinator.draftProposalPrompt" : "coordinator.askPrompt")}\nFeature ID: ${id}. Use get-feature for fresh evidence and revision.`,
        openSidebar: true,
      });
      if (!delivery.delivered) {
        console.warn("Feature agent handoff rejected", delivery.reason);
        setError(t("coordinator.agentDeliveryFailed"));
      }
    } catch (e) {
      setError(actionErrorMessage(e) ?? t("coordinator.error"));
    } finally {
      setStartingReview(false);
    }
  }
  return (
    <>
      <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-xs leading-5">
        <strong className="me-2">
          {t(feature.data.sample ? "coordinator.sample" : "coordinator.live")}
        </strong>
        {t(
          feature.data.sample
            ? "coordinator.sampleNotice"
            : "coordinator.liveNotice",
        )}
      </div>
      <Link
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        to={FeatureResource.PATH}
      >
        <IconArrowLeft className="size-4" />
        {t("coordinator.back")}
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {feature.title}
          </h1>
          <div className="mt-3 flex items-center gap-3">
            <span className="text-sm font-medium">{t("coordinator.featureProgress.label")}: {t(`coordinator.featureProgress.${feature.featureStatus}`)}</span>
            <span className="text-xs text-muted-foreground">
              {t("coordinator.revision")} {feature.revision}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {feature.canEdit && progressEvents.map((event) => (
            <Button key={event} variant="outline" disabled={pending} onClick={() => void changeProgress(event)}>
              {t(`coordinator.featureProgress.${event}`)}
            </Button>
          ))}
          <ShareButton
            resourceType={FeatureResource.TYPE}
            resourceId={id}
            resourceTitle={feature.title}
          />
          <Button variant="outline" disabled={startingReview} onClick={() => void ask()}>
            <IconMessages className="size-4" />
            {t("coordinator.ask")}
          </Button>
        </div>
      </header>
      {!isReviewInstruction(feature.data) && <div className="flex items-center gap-2 text-sm"><span>{t("coordinator.questionStatus")}:</span> <FeatureStatus status={feature.status} /></div>}
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {feature.data.proposals?.some((proposal) => proposal.status === ProposalStatus.PENDING) && (
        <section className="space-y-3 rounded-xl border border-border bg-card p-5" aria-labelledby="proposals-heading">
          <div><h2 id="proposals-heading" className="text-lg font-semibold">{t("coordinator.questions.proposalsTitle")}</h2><p className="mt-1 text-sm text-muted-foreground">{t("coordinator.questions.proposalsHelp")}</p></div>
          <Proposals feature={feature} actions={questions} />
        </section>
      )}
      <QuestionList
        feature={feature}
        pending={pending}
        onEdit={questions.editQuestion}
        onReview={questions.reviewQuestion}
        onDraft={questions.draftQuestion}
        onSend={questions.sendQuestion}
        onCheck={questions.checkQuestion}
        sending={questions.sending}
      />
      {!isReviewInstruction(feature.data) && <QuestionReview
        key={`${id}:${feature.revision}`}
        feature={feature}
        pending={pending}
        onChange={change}
        onApprove={accept}
        onAskProposal={() => void ask(true)}
      />}
      {!feature.data.sample && (
        <DiscordReview feature={feature} refresh={() => query.refetch()} />
      )}
      <SpecPreview feature={feature} />
      <SourceEvidence feature={feature} />
      <FeatureReviewSessions key={id} id={id} />
      <details
        className="rounded-xl border border-border p-5"
        open={feature.status === QuestionStatus.APPROVED}
      >
        <summary className="cursor-pointer text-sm font-semibold">
          {t("coordinator.activity")}
        </summary>
        <ol className="mt-4 space-y-4">
          {[...feature.data.activity].reverse().map((item) => (
            <li key={item.id} className="border-s-2 border-border ps-4">
              <p className="text-sm leading-6">{item.detail}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {item.actor} · {new Date(item.at).toLocaleString()}
              </p>
            </li>
          ))}
        </ol>
      </details>
    </>
  );
}
function ErrorState({ error, retry }: { error: unknown; retry: () => void }) {
  const t = useT();
  return (
    <div role="alert" className="rounded-lg border border-destructive/30 p-5">
      <p className="text-sm">
        {actionErrorMessage(error) ?? t("coordinator.error")}
      </p>
      <Button className="mt-3" variant="outline" onClick={retry}>
        {t("coordinator.retry")}
      </Button>
    </div>
  );
}
