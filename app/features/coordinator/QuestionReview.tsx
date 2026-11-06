import { useT } from "@agent-native/core/client/i18n";
import {
  FeatureParticipant,
  QuestionEvent,
  QuestionStatus,
  type Feature,
  type QuestionChange,
} from "@shared/features/types";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  feature: Feature;
  pending: boolean;
  onChange: (change: QuestionChange) => Promise<void>;
  onApprove: () => Promise<void>;
  onAskProposal: () => void;
}
export function QuestionReview({
  feature,
  pending,
  onChange,
  onApprove,
  onAskProposal,
}: Props) {
  const t = useT();
  const q = feature.data.question;
  const [owner, setOwner] = useState(q.owner);
  const [reply, setReply] = useState(q.reply ?? "");
  const [respondent, setRespondent] = useState(
    q.replyBy ?? FeatureParticipant.PO,
  );
  const [proposal, setProposal] = useState(q.proposal ?? "");
  const [rationale, setRationale] = useState(q.rationale ?? "");
  const [correctReply, setCorrectReply] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const locked = pending || !feature.canEdit;
  const showReply = feature.status === QuestionStatus.OPEN || correctReply;
  return (
    <section
      className="rounded-xl border border-border bg-card p-5"
      aria-labelledby="question-heading"
    >
      <h2 id="question-heading" className="text-lg font-semibold">
        {t("coordinator.question")}
      </h2>
      <p className="mt-2 max-w-3xl text-sm leading-6">{q.text}</p>
      {!feature.canEdit && (
        <p className="mt-3 text-sm text-muted-foreground">
          {t("coordinator.readonly")}
        </p>
      )}
      {feature.status === QuestionStatus.OPEN && (
        <form
          className="mt-5 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void onChange({ event: QuestionEvent.ASSIGN, owner }).catch(
              () => {},
            );
          }}
        >
          <div className="w-60 space-y-2">
            <Label htmlFor="question-owner">{t("coordinator.owner")}</Label>
            <Select
              value={owner}
              onValueChange={(v) => setOwner(v as FeatureParticipant)}
              disabled={locked}
            >
              <SelectTrigger id="question-owner">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(FeatureParticipant).map((role) => (
                  <SelectItem key={role} value={role}>
                    {role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="submit"
            variant="outline"
            disabled={locked || owner === q.owner}
          >
            {t("coordinator.assign")}
          </Button>
        </form>
      )}
      <details className="mt-5 rounded-lg bg-muted/40 p-3">
        <summary className="cursor-pointer text-sm font-medium">
          {t("coordinator.draft")}{" "}
          <span className="ms-2 text-xs font-normal text-muted-foreground">
            {t("coordinator.delivery")}
          </span>
        </summary>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6">
          {q.owner}: {q.text}
        </p>
      </details>
      {showReply && (
        <form
          className="mt-5 space-y-4 border-t border-border pt-5"
          onSubmit={(e) => {
            e.preventDefault();
            void onChange({
              event: QuestionEvent.REPLY,
              text: reply,
              respondent,
            })
              .then(() => setCorrectReply(false))
              .catch(() => {});
          }}
        >
          <h3 className="font-medium">{t("coordinator.reply")}</h3>
          <p className="text-xs text-muted-foreground">
            {t(
              feature.data.sample
                ? "coordinator.replyHint"
                : "coordinator.liveReplyHint",
            )}
          </p>
          {feature.data.sample && (
            <p className="select-text rounded-lg border border-dashed border-border p-3 text-sm">
              {t("coordinator.sampleReply")}
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="reply-by">{t("coordinator.respondent")}</Label>
            <Input
              id="reply-by"
              value={respondent}
              onChange={(e) => setRespondent(e.target.value)}
              maxLength={100}
              required
              disabled={locked}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reply-text">{t("coordinator.replyText")}</Label>
            <Textarea
              id="reply-text"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              maxLength={4000}
              rows={3}
              required
              disabled={locked}
            />
          </div>
          <Button disabled={locked || !reply.trim() || !respondent.trim()}>
            {pending ? t("coordinator.saving") : t("coordinator.saveReply")}
          </Button>
        </form>
      )}
      {q.reply && !showReply && (
        <div className="mt-5 border-t border-border pt-5">
          <h3 className="text-xs font-medium text-muted-foreground">
            {t("coordinator.reply")} · {q.replyBy}
          </h3>
          <blockquote className="mt-2 whitespace-pre-wrap text-sm leading-6">
            {q.reply}
          </blockquote>
          {q.replySourceUrl && (
            <a
              className="mt-2 block text-sm underline"
              href={q.replySourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              {t("coordinator.discord.openReply")}
            </a>
          )}
          {feature.status !== QuestionStatus.APPROVED && feature.canEdit && (
            <Button
              variant="link"
              className="mt-1 px-0"
              onClick={() => setCorrectReply(true)}
            >
              {t("coordinator.editReply")}
            </Button>
          )}
        </div>
      )}
      {(feature.status === QuestionStatus.ANSWERED ||
        feature.status === QuestionStatus.PROPOSED) &&
        !showReply && (
          <form
            className="mt-5 space-y-4 border-t border-border pt-5"
            onSubmit={(e) => {
              e.preventDefault();
              void onChange({
                event: QuestionEvent.PROPOSE,
                text: proposal,
                rationale,
              }).catch(() => {});
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium">{t("coordinator.proposal")}</h3>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onAskProposal}
                disabled={locked}
              >
                {t("coordinator.askProposal")}
              </Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="proposal-text">{t("coordinator.rule")}</Label>
              <Textarea
                id="proposal-text"
                value={proposal}
                onChange={(e) => setProposal(e.target.value)}
                rows={3}
                maxLength={4000}
                required
                disabled={locked}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="proposal-reason">
                {t("coordinator.rationale")}
              </Label>
              <Textarea
                id="proposal-reason"
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                rows={2}
                maxLength={4000}
                required
                disabled={locked}
              />
            </div>
            <Button disabled={locked || !proposal.trim() || !rationale.trim()}>
              {pending
                ? t("coordinator.saving")
                : t("coordinator.saveProposal")}
            </Button>
          </form>
        )}
      {feature.status === QuestionStatus.PROPOSED && !showReply && (
        <div className="mt-5 border-t border-border pt-5">
          <Button
            onClick={() => setConfirm(true)}
            disabled={pending || !feature.canApprove}
          >
            {t("coordinator.review")}
          </Button>
          {!feature.canApprove && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("coordinator.approvalOwner")}
            </p>
          )}
        </div>
      )}
      {feature.status === QuestionStatus.APPROVED && (
        <div className="mt-5 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <h3 className="font-semibold">{t("coordinator.approved")}</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
            {q.proposal}
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            {t("coordinator.approvedBy")} {q.approvedBy} ·{" "}
            {q.approvedAt && new Date(q.approvedAt).toLocaleString()}
          </p>
        </div>
      )}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("coordinator.approvalTitle")}</DialogTitle>
            <DialogDescription>
              {t("coordinator.approvalHelp")}
            </DialogDescription>
          </DialogHeader>
          <p className="whitespace-pre-wrap text-sm leading-6">{q.proposal}</p>
          <p className="text-sm text-muted-foreground">{q.rationale}</p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirm(false)}
              disabled={pending}
            >
              {t("coordinator.cancel")}
            </Button>
            <Button
              onClick={() =>
                void onApprove()
                  .then(() => setConfirm(false))
                  .catch(() => {})
              }
              disabled={pending}
            >
              {pending ? t("coordinator.approving") : t("coordinator.approve")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
