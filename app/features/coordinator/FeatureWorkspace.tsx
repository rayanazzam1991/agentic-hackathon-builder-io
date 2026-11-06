import { sendToAgentChatAndConfirm } from "@agent-native/core/client/agent-chat";
import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { ShareButton } from "@agent-native/toolkit/app/sharing";
import {
  FeatureResource,
  QuestionStatus,
  type QuestionChange,
} from "@shared/features/types";
import { LocalCodex } from "@shared/local-codex";
import {
  IconArrowLeft,
  IconArrowRight,
  IconMessages,
  IconGitCompare,
} from "@tabler/icons-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { DiscordReview } from "@/features/coordinator/DiscordReview";
import { FeatureStatus } from "@/features/coordinator/FeatureStatus";
import { LiveSourceImport } from "@/features/coordinator/LiveSourceImport";
import { QuestionReview } from "@/features/coordinator/QuestionReview";
import { SourceEvidence } from "@/features/coordinator/SourceEvidence";
import { SpecPreview } from "@/features/coordinator/SpecPreview";
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
        <Button onClick={() => void start()} disabled={create.isPending}>
          <IconGitCompare className="size-4" aria-hidden="true" />
          {create.isPending
            ? t("coordinator.creating")
            : t("coordinator.create")}
        </Button>
      </header>
      <LiveSourceImport />
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
              <span className="min-w-0 flex-1 font-medium">
                {feature.title}
                <span className="mt-1 block text-xs font-normal text-muted-foreground">
                  {t("coordinator.revision")} {feature.revision}
                </span>
              </span>
              <FeatureStatus status={feature.status} />
              <IconArrowRight
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
            </Link>
          ))}
        </div>
      )}
      <details className="text-sm text-muted-foreground">
        <summary className="cursor-pointer font-medium">
          {t("coordinator.guide")}
        </summary>
        <p className="mt-3 max-w-2xl leading-6">{t("coordinator.guideText")}</p>
      </details>
    </>
  );
}
function FeatureDetail({ id }: { id: string }) {
  const t = useT();
  const query = useActionQuery("get-feature", { id });
  const update = useActionMutation("update-feature-question");
  const approve = useActionMutation("approve-feature-decision");
  const [error, setError] = useState<string>();
  if (query.isPending) return <p role="status">{t("coordinator.loading")}</p>;
  if (query.isError || !query.data)
    return (
      <ErrorState error={query.error} retry={() => void query.refetch()} />
    );
  const feature = query.data;
  const pending = update.isPending || approve.isPending;
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
    const delivery = await sendToAgentChatAndConfirm({
      chatTarget: "local",
      submit: true,
      // A review starts its own conversation instead of reusing a previously
      // selected feature's panel. Proposal follow-ups keep the current thread.
      newTab: !propose,
      reuseEmptyTab: true,
      ...(LOCAL_CODEX_ENABLED
        ? { engine: LocalCodex.ENGINE, model: LocalCodex.MODEL }
        : {}),
      message: `${t(propose ? "coordinator.draftProposalPrompt" : "coordinator.askPrompt")}\nFeature ID: ${id}`,
      context: `Feature review: ${id}. Use get-feature for fresh evidence and revision.`,
      openSidebar: true,
    });
    if (!delivery.delivered) {
      console.warn("Feature agent handoff rejected", delivery.reason);
      setError(t("coordinator.agentDeliveryFailed"));
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
            <FeatureStatus status={feature.status} />
            <span className="text-xs text-muted-foreground">
              {t("coordinator.revision")} {feature.revision}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ShareButton
            resourceType={FeatureResource.TYPE}
            resourceId={id}
            resourceTitle={feature.title}
          />
          <Button variant="outline" onClick={() => void ask()}>
            <IconMessages className="size-4" />
            {t("coordinator.ask")}
          </Button>
        </div>
      </header>
      <SourceEvidence feature={feature} />
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <QuestionReview
        key={`${id}:${feature.revision}`}
        feature={feature}
        pending={pending}
        onChange={change}
        onApprove={accept}
        onAskProposal={() => void ask(true)}
      />
      {!feature.data.sample && (
        <DiscordReview feature={feature} refresh={() => query.refetch()} />
      )}
      <SpecPreview feature={feature} />
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
