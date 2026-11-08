import {
  hideChatThread,
  notifyChatThreadsUpdated,
  requestAgentChatThreadOpen,
} from "@agent-native/core/client/agent-chat";
import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { FeatureResource } from "@shared/features/types";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function FeatureReviewSessions({ id }: { id: string }) {
  const t = useT();
  const sessions = useActionQuery("list-feature-review-sessions", { id });
  const open = useActionMutation("open-feature-review-session");
  const archive = useActionMutation("archive-feature-review-session");
  const [error, setError] = useState<string>();
  const [hiddenSession, setHiddenSession] = useState<{
    threadId: string;
    isOwner: boolean;
  }>();
  const [changingVisibility, setChangingVisibility] = useState(false);
  const [sessionToRemove, setSessionToRemove] = useState<{
    threadId: string;
    title: string;
    isOwner: boolean;
  }>();
  const currentId = useRef(id);
  currentId.current = id;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const refreshRef = useRef(sessions.refetch);
  refreshRef.current = sessions.refetch;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refreshRef.current(), 300);
    };
    window.addEventListener("agent-chat:threads-updated", refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("agent-chat:threads-updated", refresh);
    };
  }, [id]);
  async function openSession(threadId: string) {
    setError(undefined);
    try {
      const result = await open.mutateAsync({ id, threadId });
      if (mounted.current && currentId.current === id)
        requestAgentChatThreadOpen({ threadId: result.threadId });
    } catch (e) {
      if (mounted.current && currentId.current === id)
        setError(actionErrorMessage(e) ?? t("coordinator.error"));
    }
  }
  async function changeVisibility(
    session: { threadId: string; isOwner: boolean },
    hidden: boolean,
  ) {
    setError(undefined);
    setChangingVisibility(true);
    try {
      if (session.isOwner) {
        await archive.mutateAsync({
          id,
          threadId: session.threadId,
          archived: hidden,
        });
        notifyChatThreadsUpdated();
      } else {
        await open.mutateAsync({ id, threadId: session.threadId });
        await hideChatThread(session.threadId, hidden, {
          scope: { type: FeatureResource.TYPE, id },
        });
      }
      if (mounted.current && currentId.current === id) {
        setHiddenSession(hidden ? session : undefined);
        if (hidden) setSessionToRemove(undefined);
        await sessions.refetch();
      }
    } catch (e) {
      if (mounted.current && currentId.current === id)
        setError(
          actionErrorMessage(e) ?? t("coordinator.sessions.removeFailed"),
        );
    } finally {
      if (mounted.current && currentId.current === id)
        setChangingVisibility(false);
    }
  }
  return (
    <section
      className="space-y-3 rounded-xl border border-border p-5"
      aria-labelledby="feature-sessions-heading"
    >
      <h2 id="feature-sessions-heading" className="text-lg font-semibold">
        {t("coordinator.sessions.title")}
      </h2>
      {sessions.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("coordinator.sessions.loading")}
        </p>
      ) : sessions.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          <span>{t("coordinator.sessions.failed")}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void sessions.refetch()}
          >
            {t("coordinator.retry")}
          </Button>
        </div>
      ) : !sessions.data?.length ? (
        <p className="text-sm text-muted-foreground">
          {t("coordinator.sessions.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {sessions.data.map((session) => (
            <li key={session.threadId} className="flex items-center gap-3">
              <button
                type="button"
                disabled={open.isPending || changingVisibility}
                onClick={() => void openSession(session.threadId)}
                className="min-w-0 flex-1 rounded-md py-3 text-start text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                {session.title || t("coordinator.sessions.untitled")}
              </button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={open.isPending || changingVisibility}
                onClick={() => {
                  setError(undefined);
                  setSessionToRemove({
                    threadId: session.threadId,
                    title: session.title || t("coordinator.sessions.untitled"),
                    isOwner: session.isOwner,
                  });
                }}
                aria-label={t("coordinator.sessions.removeLabel", {
                  title: session.title || t("coordinator.sessions.untitled"),
                })}
              >
                {t("coordinator.sessions.remove")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {sessions.data?.length === 50 && (
        <p className="text-xs text-muted-foreground">
          {t("coordinator.sessions.limit")}
        </p>
      )}
      {hiddenSession && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground"
        >
          <span>{t("coordinator.sessions.removed")}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={open.isPending || changingVisibility}
            onClick={() => void changeVisibility(hiddenSession, false)}
          >
            {t("coordinator.sessions.undo")}
          </Button>
        </div>
      )}
      <Dialog
        open={!!sessionToRemove}
        onOpenChange={(isOpen) => {
          if (!isOpen && !changingVisibility) {
            setSessionToRemove(undefined);
            setError(undefined);
          }
        }}
      >
        <DialogContent
          onEscapeKeyDown={(event) => {
            if (changingVisibility) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (changingVisibility) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("coordinator.sessions.removeTitle")}</DialogTitle>
            <DialogDescription>
              {t(
                sessionToRemove?.isOwner
                  ? "coordinator.sessions.removeOwnedHelp"
                  : "coordinator.sessions.removeHelp",
                {
                  title: sessionToRemove?.title ?? "",
                },
              )}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={changingVisibility}
              onClick={() => setSessionToRemove(undefined)}
            >
              {t("coordinator.cancelImport")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={changingVisibility}
              onClick={() => {
                if (sessionToRemove)
                  void changeVisibility(sessionToRemove, true);
              }}
            >
              {changingVisibility
                ? t("coordinator.sessions.removing")
                : t("coordinator.sessions.remove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {error && !sessionToRemove && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
