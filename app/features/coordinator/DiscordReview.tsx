import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { DiscordChange, DiscordDeliveryStatus } from "@shared/features/discord";
import { QuestionStatus, type Feature } from "@shared/features/types";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DiscordPeopleRoles } from "@/features/coordinator/DiscordPeopleRoles";

export function DiscordReview({
  feature,
  refresh,
}: {
  feature: Feature;
  refresh: () => Promise<unknown>;
}) {
  const t = useT();
  const update = useActionMutation("update-feature-discord");
  const send = useActionMutation("send-feature-discord-question");
  const check = useActionMutation("check-feature-discord-replies");
  const apply = useActionMutation("apply-discord-setup");
  const [error, setError] = useState<string>();
  const [confirm, setConfirm] = useState(false);
  const binding = feature.data.discord;
  const delivery = binding?.delivery;
  const [text, setText] = useState(
    delivery?.status === DiscordDeliveryStatus.DRAFT
      ? (delivery.questionText ??
          delivery.content.split("\n\nFeature Coordinator reference:")[0] ??
          "")
      : "",
  );
  const pending = update.isPending || send.isPending || check.isPending || apply.isPending;
  const draftable =
    feature.canApprove &&
    feature.status === QuestionStatus.OPEN &&
    (!delivery || delivery.status === DiscordDeliveryStatus.DRAFT);
  async function run(work: () => Promise<unknown>) {
    setError(undefined);
    try {
      await work();
      setConfirm(false);
    } catch (error) {
      setConfirm(false);
      setError(actionErrorMessage(error) ?? t("coordinator.error"));
    } finally {
      await refresh();
    }
  }
  const channelUrl = binding
    ? `https://discord.com/channels/${binding.guildId}/${binding.channelId}`
    : undefined;
  return (
    <section
      className="space-y-4 rounded-xl border border-border bg-card p-5"
      aria-labelledby="discord-heading"
    >
      <h2 id="discord-heading" className="text-lg font-semibold">
        {t("coordinator.discord.title")}
      </h2>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!binding ? (
        <>
          <div className="flex flex-wrap gap-3">
            {feature.canApprove && <Button variant="outline" disabled={pending} onClick={() => void run(() => apply.mutateAsync({ id: feature.id, revision: feature.revision }))}>{t("coordinator.discordSettings.apply")}</Button>}
            <a className="self-center text-sm underline" href="/settings/app/discord">{t("coordinator.discordSettings.link")}</a>
          </div>
          <p className="text-sm text-muted-foreground">
            {t("coordinator.discord.setup")}{" "}
            <a className="underline" href="/settings/api-keys">
              {t("coordinator.discord.keys")}
            </a>
          </p>
          {feature.canApprove && (
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void run(() =>
                  update.mutateAsync({
                    id: feature.id,
                    revision: feature.revision,
                    change: {
                      event: DiscordChange.CONNECT,
                      channelUrl: String(form.get("channelUrl")),
                    },
                  }),
                );
              }}
            >
              <div className="min-w-0 flex-1 space-y-2">
                <Label htmlFor="discord-channel">
                  {t("coordinator.discord.channel")}
                </Label>
                <Input
                  id="discord-channel"
                  name="channelUrl"
                  type="url"
                  placeholder="https://discord.com/channels/…/…"
                  required
                  disabled={pending}
                />
              </div>
              <Button variant="outline" disabled={pending}>
                {pending
                  ? t("coordinator.saving")
                  : t("coordinator.discord.connect")}
              </Button>
            </form>
          )}
        </>
      ) : (
        <>
          <a
            className="break-all text-sm underline"
            href={channelUrl}
            target="_blank"
            rel="noreferrer"
          >
            #{binding.channelName}
          </a>
          <DiscordPeopleRoles
            feature={feature}
            disabled={pending}
            refresh={refresh}
          />
          {draftable && (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void run(() =>
                  update.mutateAsync({
                    id: feature.id,
                    revision: feature.revision,
                    change: { event: DiscordChange.DRAFT, text },
                  }),
                );
              }}
            >
              <Label htmlFor="discord-question">
                {t("coordinator.discord.question")}
              </Label>
              <Textarea
                id="discord-question"
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={1600}
                rows={4}
                required
                disabled={pending}
              />
              <Button variant="outline" disabled={pending || !text?.trim()}>
                {pending
                  ? t("coordinator.saving")
                  : t("coordinator.discord.saveDraft")}
              </Button>
            </form>
          )}
          {delivery && (
            <div className="space-y-3 border-t border-border pt-4">
              <p role="status" className="text-sm font-medium">
                {t(`coordinator.discord.status.${delivery.status}`)}
              </p>
              {delivery.recipientRole && (
                <p className="text-sm">
                  {t("coordinator.discord.recipient")}{" "}
                  <strong>@{delivery.recipientRole.name}</strong>
                </p>
              )}
              <pre className="whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 font-sans text-sm leading-6">
                {delivery.content}
              </pre>
              {delivery.messageId && (
                <a
                  className="inline-block text-sm underline"
                  href={`${channelUrl}/${delivery.messageId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("coordinator.discord.openMessage")}
                </a>
              )}
              <div className="flex flex-wrap gap-3">
                {draftable &&
                  delivery.status === DiscordDeliveryStatus.DRAFT && (
                    <Button disabled={pending} onClick={() => setConfirm(true)}>
                      {t("coordinator.discord.reviewSend")}
                    </Button>
                  )}
                {feature.canEdit &&
                  delivery.status !== DiscordDeliveryStatus.DRAFT && (
                    <Button
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        void run(() =>
                          check.mutateAsync({
                            id: feature.id,
                            revision: feature.revision,
                          }),
                        )
                      }
                    >
                      {check.isPending
                        ? t("coordinator.discord.checking")
                        : t("coordinator.discord.check")}
                    </Button>
                  )}
              </div>
            </div>
          )}
          {binding.checkedAt && (
            <div className="space-y-3 border-t border-border pt-4">
              <p className="text-xs text-muted-foreground">
                {t("coordinator.discord.coverage")}{" "}
                {new Date(binding.checkedAt).toLocaleString()}
              </p>
              {binding.partial && (
                <p role="status" className="text-sm">
                  {t("coordinator.discord.partial")}
                </p>
              )}
              {!binding.replies.length && (
                <p className="text-sm text-muted-foreground">
                  {t("coordinator.discord.empty")}
                </p>
              )}
              {binding.replies.map((reply) => (
                <article
                  key={reply.id}
                  className="space-y-2 border-s-2 border-border ps-4"
                >
                  <a
                    className="break-all text-sm underline"
                    href={reply.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {reply.author} · {reply.authorId}
                  </a>
                  <p className="whitespace-pre-wrap text-sm leading-6">
                    {reply.text}
                  </p>
                  {feature.canEdit &&
                    feature.status !== QuestionStatus.APPROVED && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() =>
                          void run(() =>
                            update.mutateAsync({
                              id: feature.id,
                              revision: feature.revision,
                              change: {
                                event: DiscordChange.RECORD,
                                messageId: reply.id,
                              },
                            }),
                          )
                        }
                      >
                        {t("coordinator.discord.record")}
                      </Button>
                    )}
                </article>
              ))}
              <p className="text-xs text-muted-foreground">
                {t("coordinator.discord.identity")}
              </p>
            </div>
          )}
        </>
      )}
      <Dialog
        open={confirm}
        onOpenChange={(value) => {
          if (!pending) setConfirm(value);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("coordinator.discord.confirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("coordinator.discord.confirmHelp")}
            </DialogDescription>
          </DialogHeader>
          <a
            className="break-all text-sm underline"
            href={channelUrl}
            target="_blank"
            rel="noreferrer"
          >
            #{binding?.channelName} · {channelUrl}
          </a>
          {delivery?.recipientRole && (
            <p className="text-sm">
              {t("coordinator.discord.recipient")}{" "}
              <strong>@{delivery.recipientRole.name}</strong>
            </p>
          )}
          <p className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6">
            {delivery?.content}
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setConfirm(false)}
            >
              {t("coordinator.cancel")}
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                void run(() =>
                  send.mutateAsync({
                    id: feature.id,
                    revision: feature.revision,
                  }),
                )
              }
            >
              {send.isPending
                ? t("coordinator.discord.sending")
                : t("coordinator.discord.send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
