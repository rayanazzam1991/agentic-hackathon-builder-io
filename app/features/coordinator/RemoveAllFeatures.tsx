import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconTrash } from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function RemoveAllFeatures({ onRemoved }: { onRemoved: () => void }) {
  const t = useT();
  const remove = useActionMutation("delete-all-features");
  const [preview, setPreview] = useState<{
    count: number;
    withDiscord: number;
  }>();
  const [error, setError] = useState<string>();
  async function open() {
    setError(undefined);
    try {
      const result = await remove.mutateAsync({ dryRun: true });
      setPreview({
        count: result.reviews.length,
        withDiscord: result.reviews.filter((r) => r.hasDiscordHistory).length,
      });
    } catch (e) {
      setError(actionErrorMessage(e) ?? t("coordinator.error"));
    }
  }
  async function confirm() {
    if (!preview) return;
    setError(undefined);
    try {
      await remove.mutateAsync({ dryRun: false, expectedCount: preview.count });
      setPreview(undefined);
      onRemoved();
    } catch (e) {
      setError(actionErrorMessage(e) ?? t("coordinator.error"));
    }
  }
  return (
    <>
      <Button
        variant="outline"
        disabled={remove.isPending}
        onClick={() => void open()}
      >
        <IconTrash className="size-4" aria-hidden="true" />
        {t("coordinator.removeAll")}
      </Button>
      {error && !preview && (
        <p role="alert" className="w-full text-sm text-destructive">
          {error}
        </p>
      )}
      <Dialog
        open={!!preview}
        onOpenChange={(value) => {
          if (!value && !remove.isPending) setPreview(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("coordinator.removeAllTitle")}</DialogTitle>
            <DialogDescription>
              {t("coordinator.removeAllHelp", {
                count: String(preview?.count ?? 0),
              })}
            </DialogDescription>
          </DialogHeader>
          {!!preview?.withDiscord && (
            <p className="text-sm">
              {t("coordinator.removeAllDiscord", {
                count: String(preview.withDiscord),
              })}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={remove.isPending}
              onClick={() => setPreview(undefined)}
            >
              {t("coordinator.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending || !preview?.count}
              onClick={() => void confirm()}
            >
              {remove.isPending
                ? t("coordinator.removing")
                : t("coordinator.removeAllConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
