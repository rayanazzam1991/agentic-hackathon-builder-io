import { useT } from "@agent-native/core/client/i18n";
import { DiscordDeliveryStatus } from "@shared/features/discord";
import { getFeatureQuestions, isReviewInstruction } from "@shared/features/questions";
import {
  AskReviewChange,
  FeatureParticipant,
  PrimaryQuestionId,
  QuestionAskApproval,
  QuestionAskProvenance,
  QuestionRecipientState,
  QuestionSuggestionStatus,
  SuggestionChange,
  type AskReviewChangeInput,
  type Feature,
  type FeatureQuestionView,
  type SuggestedQuestionChange,
} from "@shared/features/types";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  DiscordDirectory,
  type DirectoryChoice,
} from "@/features/coordinator/DiscordDirectory";

const UNRESOLVED = "unresolved";
const DIRECT = "direct";
const askTone = {
  [QuestionAskApproval.PENDING]: "border-amber-500/40 bg-amber-500/10",
  [QuestionAskApproval.APPROVED]: "border-primary/40 bg-primary/10",
  [QuestionAskApproval.REJECTED]: "border-destructive/40 bg-destructive/10",
};

interface Props {
  feature: Feature;
  pending: boolean;
  onEdit: (id: string, change: SuggestedQuestionChange) => Promise<void>;
  onReview: (id: string, change: AskReviewChangeInput) => Promise<void>;
  onDraft: (id: string) => Promise<unknown>;
  onSend: (id: string) => Promise<unknown>;
  onCheck: (id: string) => Promise<unknown>;
  sending: boolean;
}
export function QuestionList({
  feature,
  pending,
  onEdit,
  onReview,
  onDraft,
  onSend,
  onCheck,
  sending,
}: Props) {
  const t = useT();
  const headingId = useId();
  const questions = getFeatureQuestions(feature.data, feature.status).filter(
    (question) => question.id !== PrimaryQuestionId || !isReviewInstruction(feature.data),
  );
  const suggested = feature.data.questions?.length ?? 0;
  return (
    <section
      className="space-y-4 rounded-xl border border-border bg-card p-5"
      aria-labelledby={headingId}
    >
      <div>
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 id={headingId} className="text-lg font-semibold">
            {t("coordinator.questions.title")}
          </h2>
          <span className="text-xs text-muted-foreground">
            {t("coordinator.questions.count", { count: String(suggested) })}
          </span>
        </div>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          {t("coordinator.questions.help")}
        </p>
        {!feature.canEdit && (
          <p role="status" className="mt-2 text-sm text-muted-foreground">
            {t("coordinator.questions.readonly")}
          </p>
        )}
        {feature.canEdit && !feature.canApprove && (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("coordinator.questions.ownerOnly")}
          </p>
        )}
      </div>
      <ul className="space-y-3">
        {questions.map((question) => (
          <QuestionCard
            key={question.id}
            feature={feature}
            question={question}
            pending={pending}
            onEdit={onEdit}
            onReview={onReview}
            onDraft={onDraft}
            onSend={onSend}
            onCheck={onCheck}
            sending={sending}
          />
        ))}
      </ul>
      {!suggested && (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          {t("coordinator.questions.empty")}
        </p>
      )}
    </section>
  );
}

function QuestionCard({
  feature,
  question,
  pending,
  onEdit,
  onReview,
  onDraft,
  onSend,
  onCheck,
  sending,
}: Props & { question: FeatureQuestionView }) {
  const t = useT();
  const primary = question.id === PrimaryQuestionId;
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [choose, setChoose] = useState(false);
  const binding = feature.data.discord;
  const dismissed =
    question.suggestion.status === QuestionSuggestionStatus.DISMISSED;
  const delivery = question.discord?.delivery ?? null;
  const frozen = !!delivery && delivery.status !== DiscordDeliveryStatus.DRAFT;
  const ask = question.askApproval;
  const rejected = ask.status === QuestionAskApproval.REJECTED;
  const recipient = question.recipient;
  const mapped = recipient.participant
    ? binding?.roleMappings?.[recipient.participant]
    : undefined;
  const directLabel = recipient.person
    ? t("coordinator.questions.recipientPerson", {
        name: recipient.person.displayName,
      })
    : !recipient.participant && recipient.role
      ? t("coordinator.questions.recipientDirectRole", {
          role: recipient.role.name,
        })
      : undefined;
  const mappingChanged =
    !!recipient.participant && mapped?.id !== recipient.role?.id;
  const messageUrl =
    delivery?.messageId && binding
      ? `https://discord.com/channels/${binding.guildId}/${binding.channelId}/${delivery.messageId}`
      : undefined;
  const canChange = feature.canEdit && !pending && !primary && !frozen;
  const canReview = feature.canApprove && !pending && !dismissed && !frozen;

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
    } catch {
      // The workspace shows the error and reloads the latest revision.
    }
  }
  async function askOnDiscord() {
    try {
      await onDraft(question.id);
      setConfirm(true);
    } catch {
      // The workspace shows the error and reloads the latest revision.
    }
  }
  const inlineRecipient =
    !primary && !frozen && !dismissed && !rejected && !editing;
  async function changeRecipient(value: string) {
    const next = value === UNRESOLVED ? null : (value as FeatureParticipant);
    if (next === (recipient.participant ?? null)) return;
    const wasApproved = ask.status === QuestionAskApproval.APPROVED;
    await run(async () => {
      await onEdit(question.id, {
        event: SuggestionChange.EDIT,
        recipient: next,
      });
      setNotice(wasApproved);
    });
  }
  const channelUrl = binding
    ? `https://discord.com/channels/${binding.guildId}/${binding.channelId}`
    : undefined;
  const isDraft = delivery?.status === DiscordDeliveryStatus.DRAFT;
  const canDraft =
    !primary &&
    !frozen &&
    !dismissed &&
    !!binding &&
    feature.canApprove &&
    ask.status === QuestionAskApproval.APPROVED &&
    recipient.status === QuestionRecipientState.SELECTED &&
    !pending;
  async function dismissOrRestore() {
    await run(() =>
      onEdit(question.id, {
        event: dismissed ? SuggestionChange.RESTORE : SuggestionChange.DISMISS,
      }),
    );
  }

  return (
    <li
      className={`rounded-lg border p-4 ${dismissed ? "border-dashed opacity-75" : "border-border"}`}
      data-question-id={question.id}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {primary ? (
          <Pill>{t("coordinator.questions.primaryBadge")}</Pill>
        ) : (
          <Pill>
            {t(`coordinator.questions.origin.${question.origin}` as string)}
          </Pill>
        )}
        <span
          className={`rounded-full border px-2 py-0.5 ${askTone[ask.status]}`}
        >
          {t(`coordinator.questions.ask.${ask.status}` as string)}
          {ask.provenance === QuestionAskProvenance.LEGACY_SEND_CONFIRMATION
            ? ` · ${t("coordinator.questions.askLegacy")}`
            : ask.by
              ? ` · ${t("coordinator.questions.askBy", { by: ask.by })}`
              : ""}
        </span>
        {dismissed && <Pill>{t("coordinator.questions.dismissed")}</Pill>}
      </div>
      <p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm leading-6">
        {question.text}
      </p>
      {notice && ask.status === QuestionAskApproval.PENDING && (
        <p
          role="status"
          className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs"
        >
          {t("coordinator.questions.returnedPending")}
        </p>
      )}
      {rejected && ask.reason && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("coordinator.questions.askReason", { reason: ask.reason })}
        </p>
      )}
      {primary ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("coordinator.questions.primaryHelp")}
        </p>
      ) : null}
      <dl className="mt-3 grid gap-3 text-sm md:grid-cols-3">
        <div>
          <dt className="text-xs font-medium text-muted-foreground">
            {t("coordinator.questions.responsibility")}
          </dt>
          <dd className="mt-1">
            {question.owner ?? t("coordinator.questions.unresolvedOwner")}
            {question.ownerReason && (
              <span className="mt-1 block text-xs text-muted-foreground">
                {t("coordinator.questions.reason")}: {question.ownerReason}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">
            {t("coordinator.questions.recipient")}
          </dt>
          <dd className="mt-1">
            {inlineRecipient ? (
              <>
                <Select
                  value={
                    recipient.participant ?? (directLabel ? DIRECT : UNRESOLVED)
                  }
                  onValueChange={(value) => void changeRecipient(value)}
                  disabled={!canChange || !binding}
                >
                  <SelectTrigger
                    size="sm"
                    aria-label={t("coordinator.questions.recipientLabel")}
                    className="w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNRESOLVED}>
                      {t("coordinator.questions.recipientNone")}
                    </SelectItem>
                    {directLabel && (
                      <SelectItem value={DIRECT} disabled>
                        {directLabel}
                      </SelectItem>
                    )}
                    {Object.values(FeatureParticipant).map((role) => {
                      const mappedRole = binding?.roleMappings?.[role];
                      return (
                        <SelectItem
                          key={role}
                          value={role}
                          disabled={!mappedRole}
                        >
                          {mappedRole
                            ? t("coordinator.questions.recipientRole", {
                                participant: role,
                                role: mappedRole.name,
                              })
                            : t("coordinator.questions.recipientUnmapped", {
                                role,
                              })}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                {feature.canApprove && binding && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    disabled={!canChange}
                    onClick={() => setChoose(true)}
                  >
                    {t("coordinator.questions.chooseRecipient")}
                  </Button>
                )}
                {recipient.status !== QuestionRecipientState.SELECTED && (
                  <span className="mt-1 block text-xs text-amber-700 dark:text-amber-400">
                    {t("coordinator.questions.unresolvedRecipient")}
                  </span>
                )}
                {!binding && (
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {t("coordinator.questions.noChannel")}
                  </span>
                )}
              </>
            ) : (
              <>
                {recipient.status === QuestionRecipientState.SELECTED &&
                (recipient.role || recipient.person) ? (
                  directLabel ? (
                    directLabel
                  ) : recipient.participant && recipient.role ? (
                    t("coordinator.questions.recipientRole", {
                      participant: recipient.participant,
                      role: recipient.role.name,
                    })
                  ) : (
                    `@${recipient.role?.name}`
                  )
                ) : (
                  <span className="text-amber-700 dark:text-amber-400">
                    {t("coordinator.questions.unresolvedRecipient")}
                  </span>
                )}
              </>
            )}
            {mappingChanged && (
              <span className="mt-1 block text-xs text-muted-foreground">
                {t("coordinator.questions.recipientChanged")}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">
            {t("coordinator.questions.delivery")}
          </dt>
          <dd className="mt-1">
            {delivery
              ? t(`coordinator.discord.status.${delivery.status}` as string)
              : t("coordinator.questions.notSent")}
            {messageUrl && (
              <a
                className="mt-1 block text-xs underline"
                href={messageUrl}
                target="_blank"
                rel="noreferrer"
              >
                {t("coordinator.questions.openMessage")}
              </a>
            )}
            {!!question.discord?.replies.length && (
              <span className="mt-1 block text-xs text-muted-foreground">
                {t("coordinator.questions.replies", {
                  count: String(question.discord.replies.length),
                })}
              </span>
            )}
          </dd>
        </div>
      </dl>
      {!primary && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            {t("coordinator.questions.evidence")} ({question.evidence.length})
          </summary>
          {question.evidence.length ? (
            <ul className="mt-2 space-y-2">
              {question.evidence.map((item, index) => (
                <li
                  key={`${item.source}:${index}`}
                  className="border-s-2 border-border ps-3"
                >
                  <p className="text-xs font-medium capitalize">
                    {item.source} · {item.version}
                  </p>
                  <blockquote className="mt-1 whitespace-pre-wrap text-sm leading-6">
                    {item.excerpt}
                  </blockquote>
                  {item.url && (
                    <a
                      className="text-xs underline"
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("coordinator.questions.sourceLink")}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("coordinator.questions.noEvidence")}
            </p>
          )}
        </details>
      )}
      {!primary && frozen && (
        <p className="mt-3 text-xs text-muted-foreground">
          {t("coordinator.questions.frozen")}
        </p>
      )}
      {!primary && !frozen && rejected && !dismissed && (
        <p className="mt-3 text-xs text-muted-foreground">
          {t("coordinator.questions.rejectedLocked")}
        </p>
      )}
      {!primary && delivery && (
        <div className="mt-4 space-y-3 rounded-lg border border-border bg-muted/20 p-3">
          <p role="status" className="text-sm font-medium">
            {t(`coordinator.discord.status.${delivery.status}` as string)}
          </p>
          <dl className="grid gap-2 text-xs md:grid-cols-2">
            <div>
              <dt className="font-medium text-muted-foreground">
                {t("coordinator.questions.draftChannel")}
              </dt>
              <dd>#{binding?.channelName}</dd>
            </div>
            {(delivery.recipientRole || delivery.recipientPerson) && (
              <div>
                <dt className="font-medium text-muted-foreground">
                  {t("coordinator.questions.draftRecipient")}
                </dt>
                <dd>
                  {delivery.recipientPerson
                    ? t("coordinator.questions.recipientPerson", {
                        name: delivery.recipientPerson.displayName,
                      })
                    : `@${delivery.recipientRole?.name}`}
                </dd>
              </div>
            )}
          </dl>
          <pre className="whitespace-pre-wrap break-words rounded-md bg-background p-3 font-sans text-sm leading-6">
            {delivery.content}
          </pre>
          <div className="flex flex-wrap items-center gap-2">
            {isDraft && feature.canApprove && (
              <>
                <Button
                  size="sm"
                  disabled={pending || !canDraft}
                  onClick={() => setConfirm(true)}
                >
                  {t("coordinator.questions.reviewSend")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending || !canDraft}
                  onClick={() => void run(() => onDraft(question.id))}
                >
                  {t("coordinator.questions.refreshDraft")}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {t("coordinator.questions.draftNoSend")}
                </span>
              </>
            )}
            {!isDraft && feature.canEdit && (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => void run(() => onCheck(question.id))}
              >
                {pending
                  ? t("coordinator.questions.checking")
                  : t("coordinator.questions.checkReplies")}
              </Button>
            )}
          </div>
        </div>
      )}
      {canDraft && !delivery && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void askOnDiscord()}>
            {t("coordinator.questions.askOnDiscord")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void run(() => onDraft(question.id))}
          >
            {t("coordinator.questions.saveDraft")}
          </Button>
          <span className="text-xs text-muted-foreground">
            {t("coordinator.questions.draftNoSend")}
          </span>
        </div>
      )}
      <Dialog open={choose} onOpenChange={setChoose}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("coordinator.questions.chooseTitle")}</DialogTitle>
            <DialogDescription>
              {t("coordinator.questions.chooseHelp")}
            </DialogDescription>
          </DialogHeader>
          <DiscordDirectory
            feature={feature}
            disabled={pending}
            onSelect={async (choice: DirectoryChoice) => {
              await onEdit(question.id, {
                event: SuggestionChange.EDIT,
                recipient: choice,
              });
              setChoose(false);
            }}
          />
        </DialogContent>
      </Dialog>
      <Dialog
        open={confirm}
        onOpenChange={(value) => {
          if (!sending) setConfirm(value);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("coordinator.questions.sendTitle")}</DialogTitle>
            <DialogDescription>
              {t("coordinator.questions.sendHelp")}
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
          {(delivery?.recipientRole || delivery?.recipientPerson) && (
            <p className="text-sm">
              {t("coordinator.questions.draftRecipient")}{" "}
              <strong>
                {delivery.recipientPerson
                  ? t("coordinator.questions.recipientPerson", {
                      name: delivery.recipientPerson.displayName,
                    })
                  : `@${delivery.recipientRole?.name}`}
              </strong>
            </p>
          )}
          <p className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6">
            {delivery?.content}
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={sending}
              onClick={() => setConfirm(false)}
            >
              {t("coordinator.questions.cancel")}
            </Button>
            <Button
              disabled={sending}
              onClick={() =>
                void run(() => onSend(question.id)).then(() =>
                  setConfirm(false),
                )
              }
            >
              {sending
                ? t("coordinator.questions.sending")
                : t("coordinator.questions.send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {editing && !primary ? (
        <EditForm
          feature={feature}
          question={question}
          pending={pending}
          onCancel={() => setEditing(false)}
          onSave={async (change) => {
            const wasApproved = ask.status === QuestionAskApproval.APPROVED;
            await onEdit(question.id, change);
            setEditing(false);
            setNotice(wasApproved);
          }}
        />
      ) : (
        !primary &&
        !frozen && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {!dismissed && !rejected && (
              <Button
                size="sm"
                variant="outline"
                disabled={!canChange}
                onClick={() => setEditing(true)}
              >
                {t("coordinator.questions.edit")}
              </Button>
            )}
            {!dismissed && ask.status === QuestionAskApproval.PENDING && (
              <Button
                size="sm"
                disabled={
                  !canReview ||
                  recipient.status !== QuestionRecipientState.SELECTED
                }
                onClick={() =>
                  void run(() =>
                    onReview(question.id, { event: AskReviewChange.APPROVE }),
                  ).then(() => setNotice(false))
                }
              >
                {t("coordinator.questions.approve")}
              </Button>
            )}
            {!dismissed && !rejected && (
              <Button
                size="sm"
                variant="outline"
                disabled={!canReview}
                onClick={() =>
                  void run(() =>
                    onReview(question.id, { event: AskReviewChange.REJECT }),
                  )
                }
              >
                {t("coordinator.questions.reject")}
              </Button>
            )}
            {!dismissed && rejected && (
              <Button
                size="sm"
                variant="outline"
                disabled={!canReview}
                onClick={() =>
                  void run(() =>
                    onReview(question.id, { event: AskReviewChange.RESTORE }),
                  )
                }
              >
                {t("coordinator.questions.reopen")}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={!canChange}
              onClick={() => void dismissOrRestore()}
            >
              {dismissed
                ? t("coordinator.questions.restore")
                : t("coordinator.questions.dismiss")}
            </Button>
            {!dismissed &&
              ask.status === QuestionAskApproval.PENDING &&
              recipient.status !== QuestionRecipientState.SELECTED && (
                <span className="text-xs text-muted-foreground">
                  {t("coordinator.questions.approveNeedsRecipient")}
                </span>
              )}
          </div>
        )
      )}
    </li>
  );
}

function EditForm({
  feature,
  question,
  pending,
  onSave,
  onCancel,
}: {
  feature: Feature;
  question: FeatureQuestionView;
  pending: boolean;
  onSave: (change: SuggestedQuestionChange) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useT();
  const mappings = feature.data.discord?.roleMappings ?? {};
  const [text, setText] = useState(question.text);
  const [owner, setOwner] = useState<string>(question.owner ?? UNRESOLVED);
  const [reason, setReason] = useState(question.ownerReason ?? "");
  const direct = !question.recipient.participant
    ? (question.recipient.person ?? question.recipient.role)
    : undefined;
  const initialRecipient =
    question.recipient.participant ?? (direct ? DIRECT : UNRESOLVED);
  const [recipient, setRecipient] = useState<string>(initialRecipient);
  const ownerValue =
    owner === UNRESOLVED ? null : (owner as FeatureParticipant);
  const ownerChanged =
    ownerValue !== question.owner ||
    (reason.trim() || null) !== question.ownerReason;
  const recipientChanged = recipient !== initialRecipient;
  const textChanged = text.trim() !== question.text;
  const valid = !!text.trim() && (ownerValue === null || !!reason.trim());
  const dirty = textChanged || ownerChanged || recipientChanged;
  const approved = question.askApproval.status === QuestionAskApproval.APPROVED;
  const id = `${useId()}-${question.id}`;
  return (
    <form
      className="mt-4 space-y-4 border-t border-border pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        const change: SuggestedQuestionChange = {
          event: SuggestionChange.EDIT,
          ...(textChanged ? { text: text.trim() } : {}),
          ...(ownerChanged
            ? { owner: ownerValue, ownerReason: reason.trim() || null }
            : {}),
          ...(recipientChanged
            ? {
                recipient:
                  recipient === UNRESOLVED
                    ? null
                    : (recipient as FeatureParticipant),
              }
            : {}),
        };
        void onSave(change).catch(() => {});
      }}
    >
      {approved && (
        <p role="note" className="text-xs text-muted-foreground">
          {t("coordinator.questions.editWarning")}
        </p>
      )}
      <div className="space-y-2">
        <Label htmlFor={`${id}-text`}>{t("coordinator.questions.text")}</Label>
        <Textarea
          id={`${id}-text`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={1000}
          rows={3}
          disabled={pending}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${id}-owner`}>
            {t("coordinator.questions.ownerLabel")}
          </Label>
          <Select value={owner} onValueChange={setOwner} disabled={pending}>
            <SelectTrigger id={`${id}-owner`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNRESOLVED}>
                {t("coordinator.questions.ownerNone")}
              </SelectItem>
              {Object.values(FeatureParticipant).map((role) => (
                <SelectItem key={role} value={role}>
                  {role}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-recipient`}>
            {t("coordinator.questions.recipientLabel")}
          </Label>
          <Select
            value={recipient}
            onValueChange={setRecipient}
            disabled={pending || !feature.data.discord}
          >
            <SelectTrigger id={`${id}-recipient`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNRESOLVED}>
                {t("coordinator.questions.recipientNone")}
              </SelectItem>
              {direct && (
                <SelectItem value={DIRECT} disabled>
                  {t("coordinator.questions.recipientDirect")}
                </SelectItem>
              )}
              {Object.values(FeatureParticipant).map((role) => (
                <SelectItem key={role} value={role} disabled={!mappings[role]}>
                  {mappings[role]
                    ? t("coordinator.questions.recipientRole", {
                        participant: role,
                        role: mappings[role].name,
                      })
                    : t("coordinator.questions.recipientUnmapped", { role })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!feature.data.discord && (
            <p className="text-xs text-muted-foreground">
              {t("coordinator.questions.noChannel")}
            </p>
          )}
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-reason`}>
          {t("coordinator.questions.ownerReasonLabel")}
        </Label>
        <Textarea
          id={`${id}-reason`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          rows={2}
          disabled={pending}
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={pending || !valid || !dirty}>
          {pending
            ? t("coordinator.questions.saving")
            : t("coordinator.questions.save")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onCancel}
          disabled={pending}
        >
          {t("coordinator.questions.cancel")}
        </Button>
      </div>
    </form>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-border bg-muted/50 px-2 py-0.5">
      {children}
    </span>
  );
}
