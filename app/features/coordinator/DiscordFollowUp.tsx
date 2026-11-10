import { useT } from "@agent-native/core/client/i18n";
import {
  DiscordFollowUpDelayHours,
  DiscordFollowUpStatus,
  discordFollowUpContent,
  type DiscordFollowUp,
  type DiscordPerson,
  type DiscordRole,
} from "@shared/features/discord";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function followUpRecipientLabel(
  recipient: {
    recipientRole?: DiscordRole | undefined;
    recipientPerson?: DiscordPerson | undefined;
  },
) {
  return recipient.recipientPerson
    ? recipient.recipientPerson.displayName
    : `@${recipient.recipientRole?.name ?? ""}`;
}

function followUpMention(recipient: {
  recipientRole?: DiscordRole | undefined;
  recipientPerson?: DiscordPerson | undefined;
}) {
  return recipient.recipientPerson
    ? `<@${recipient.recipientPerson.id}>`
    : `<@&${recipient.recipientRole?.id ?? ""}>`;
}

export function followUpPreview(
  featureId: string,
  questionId: string,
  recipient: {
    recipientRole?: DiscordRole | undefined;
    recipientPerson?: DiscordPerson | undefined;
  },
) {
  return discordFollowUpContent(
    followUpMention(recipient),
    featureId,
    questionId,
  );
}

/** Owner opt-in shown in the send confirmation, before anything is posted. */
export function DiscordFollowUpOptIn({
  enabled,
  onEnabledChange,
  hours,
  onHoursChange,
  recipientLabel,
  channelName,
  content,
}: {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  hours: number;
  onHoursChange: (hours: number) => void;
  recipientLabel: string;
  channelName: string;
  content: string;
}) {
  const t = useT();
  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
      <label className="flex items-start gap-2 text-sm font-medium">
        <input
          type="checkbox"
          className="mt-1 size-4"
          checked={enabled}
          onChange={(event) => onEnabledChange(event.target.checked)}
        />
        <span>{t("coordinator.discord.followUp.enable")}</span>
      </label>
      {enabled && (
        <>
          <p className="text-xs leading-5 text-muted-foreground">
            {t("coordinator.discord.followUp.help", {
              channel: channelName,
              recipient: recipientLabel,
              hours: String(hours),
            })}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium">
              {t("coordinator.discord.followUp.delay")}
            </span>
            <Select
              value={String(hours)}
              onValueChange={(value) => onHoursChange(Number(value))}
            >
              <SelectTrigger size="sm" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DiscordFollowUpDelayHours.map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {t("coordinator.discord.followUp.hours", {
                      count: String(value),
                    })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="text-xs font-medium">
              {t("coordinator.discord.followUp.exactText")}
            </p>
            <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-background p-2 font-sans text-xs leading-5">
              {content}
            </pre>
          </div>
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {t("coordinator.discord.followUp.warning")}
          </p>
        </>
      )}
    </div>
  );
}

function statusLabel(
  t: ReturnType<typeof useT>,
  followUp: DiscordFollowUp,
) {
  switch (followUp.status) {
    case DiscordFollowUpStatus.SCHEDULED:
      return t("coordinator.discord.followUp.scheduled", {
        time: new Date(followUp.dueAt).toLocaleString(),
      });
    case DiscordFollowUpStatus.SENDING:
      return t("coordinator.discord.followUp.sending");
    case DiscordFollowUpStatus.SENT:
      return t("coordinator.discord.followUp.sent", {
        time: followUp.sentAt
          ? new Date(followUp.sentAt).toLocaleString()
          : "",
      });
    case DiscordFollowUpStatus.ANSWERED:
      return t("coordinator.discord.followUp.answered");
    case DiscordFollowUpStatus.CANCELLED:
      return t("coordinator.discord.followUp.cancelled");
    case DiscordFollowUpStatus.FAILED:
      return t("coordinator.discord.followUp.failed");
    case DiscordFollowUpStatus.UNCERTAIN:
      return t("coordinator.discord.followUp.uncertain");
    case DiscordFollowUpStatus.UNVERIFIED:
      return t("coordinator.discord.followUp.unverified");
  }
}

/** Persistent state shown on a sent question, with owner cancel/recheck. */
export function DiscordFollowUpState({
  followUp,
  channelUrl,
  pending,
  onCancel,
  onRecheck,
}: {
  followUp: DiscordFollowUp;
  channelUrl?: string | undefined;
  pending?: boolean;
  onCancel?: () => Promise<unknown>;
  onRecheck?: () => Promise<unknown>;
}) {
  const t = useT();
  const [busy, setBusy] = useState<"cancel" | "recheck" | null>(null);
  const [error, setError] = useState<string>();
  const recipient = followUpRecipientLabel(followUp);
  const messageUrl =
    channelUrl && followUp.followUpMessageId
      ? `${channelUrl}/${followUp.followUpMessageId}`
      : undefined;
  async function run(kind: "cancel" | "recheck", action?: () => Promise<unknown>) {
    if (!action) return;
    setError(undefined);
    setBusy(kind);
    try {
      await action();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not update this follow-up.",
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3 text-sm">
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <p role="status" className="font-medium">
        {statusLabel(t, followUp)}
      </p>
      <p className="text-xs text-muted-foreground">
        {t("coordinator.discord.followUp.recipient", { recipient })}
        {" · "}
        {t("coordinator.discord.followUp.window", {
          hours: String(followUp.hours),
        })}
      </p>
      {followUp.status === DiscordFollowUpStatus.SCHEDULED && (
        <p className="text-xs text-muted-foreground">
          {t("coordinator.discord.followUp.scheduledHelp", { recipient })}
        </p>
      )}
      {followUp.status === DiscordFollowUpStatus.ANSWERED && (
        <p className="text-xs text-muted-foreground">
          {t("coordinator.discord.followUp.answeredHelp", {
            author: followUp.answeredBy ?? "A participant",
            time: followUp.answeredAt
              ? new Date(followUp.answeredAt).toLocaleString()
              : "",
          })}
        </p>
      )}
      {followUp.status === DiscordFollowUpStatus.CANCELLED && (
        <p className="text-xs text-muted-foreground">
          {t("coordinator.discord.followUp.cancelledHelp")}
        </p>
      )}
      {followUp.status === DiscordFollowUpStatus.SENT && (
        <p className="text-xs text-muted-foreground">
          {t("coordinator.discord.followUp.sentHelp")}
        </p>
      )}
      {followUp.status === DiscordFollowUpStatus.FAILED && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {followUp.lastError ??
            t("coordinator.discord.followUp.failedHelp")}
        </p>
      )}
      {followUp.status === DiscordFollowUpStatus.UNCERTAIN && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t("coordinator.discord.followUp.uncertainHelp")}
          {followUp.lastError ? ` ${followUp.lastError}` : ""}
        </p>
      )}
      {followUp.status === DiscordFollowUpStatus.UNVERIFIED && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {followUp.lastError ?? t("coordinator.discord.followUp.unverifiedHelp")}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {(followUp.status === DiscordFollowUpStatus.SCHEDULED ||
          followUp.status === DiscordFollowUpStatus.UNVERIFIED) &&
          onCancel && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending || busy !== null}
              onClick={() => void run("cancel", onCancel)}
            >
              {busy === "cancel"
                ? t("coordinator.discord.followUp.cancelling")
                : t("coordinator.discord.followUp.cancel")}
            </Button>
          )}
        {(followUp.status === DiscordFollowUpStatus.UNVERIFIED ||
          followUp.status === DiscordFollowUpStatus.UNCERTAIN) &&
          onRecheck && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending || busy !== null}
              onClick={() => void run("recheck", onRecheck)}
            >
              {busy === "recheck"
                ? t("coordinator.discord.followUp.rechecking")
                : t("coordinator.discord.followUp.recheck")}
            </Button>
          )}
        {messageUrl && (
          <a
            className="text-xs underline"
            href={messageUrl}
            target="_blank"
            rel="noreferrer"
          >
            {t("coordinator.discord.followUp.open")}
          </a>
        )}
        {followUp.messageId && channelUrl && (
          <a
            className="text-xs underline"
            href={`${channelUrl}/${followUp.messageId}`}
            target="_blank"
            rel="noreferrer"
          >
            {t("coordinator.discord.followUp.original")}
          </a>
        )}
      </div>
    </div>
  );
}

/** Post-send owner control for a question that has no follow-up yet. */
export function DiscordFollowUpAddDialog({
  open,
  onOpenChange,
  onSchedule,
  pending,
  featureId,
  questionId,
  recipient,
  channelName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSchedule: (hours: number) => Promise<unknown>;
  pending?: boolean;
  featureId: string;
  questionId: string;
  recipient: {
    recipientRole?: DiscordRole | undefined;
    recipientPerson?: DiscordPerson | undefined;
  };
  channelName: string;
}) {
  const t = useT();
  const [enabled, setEnabled] = useState(true);
  const [hours, setHours] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (open) {
      setEnabled(true);
      setHours(1);
      setError(undefined);
    }
  }, [open]);
  async function schedule() {
    if (!enabled) return;
    setError(undefined);
    setBusy(true);
    try {
      await onSchedule(hours);
      onOpenChange(false);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not schedule this follow-up.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) onOpenChange(value);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("coordinator.discord.followUp.addTitle")}</DialogTitle>
          <DialogDescription>
            {t("coordinator.discord.followUp.addHelp")}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DiscordFollowUpOptIn
          enabled={enabled}
          onEnabledChange={setEnabled}
          hours={hours}
          onHoursChange={setHours}
          recipientLabel={followUpRecipientLabel(recipient)}
          channelName={channelName}
          content={followUpPreview(featureId, questionId, recipient)}
        />
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy || pending}
            onClick={() => onOpenChange(false)}
          >
            {t("coordinator.cancelImport")}
          </Button>
          <Button
            disabled={!enabled || busy || pending}
            onClick={() => void schedule()}
          >
            {busy || pending
              ? t("coordinator.discord.followUp.scheduling")
              : t("coordinator.discord.followUp.schedule")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
